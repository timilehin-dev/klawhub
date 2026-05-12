import { inngest } from "./client";
import { createSpec } from "@/core/agents/pm";
import { writeCodeFromLearnings, fixCode } from "@/core/agents/engineer";
import { testCode, persistLearning } from "@/core/agents/qa";
import { trackSkillUsage } from "@/db";
import { memoryRead } from "@/core/tools/memory";
import {
  postToThread,
  updateMessage,
  addReaction,
  removeReaction,
  uploadFile,
} from "@/integrations/slack/client";
import {
  approvalBlocks,
  replaceActionsWithDecision,
  retryBlocks,
} from "@/integrations/slack/blocks";
import { updateRun, getRun } from "@/db";
import type { SandboxResponse } from "@/types";

/**
 * Extract a brief summary from QA evaluation for Slack display.
 * Keeps detailed diagnosis in logs only.
 */
function extractQABrief(evaluation: string, passed: boolean): string {
  if (passed) return "All checks passed. Ready for delivery.";

  const verdictMatch = evaluation.match(/VERDICT:\s*(PASS|FAIL)/i);
  const reasonMatch = evaluation.match(/REASON:\s*([\s\S]*?)(?=DIAGNOSIS:|OUTPUT:|$)/i);
  const diagnosisMatch = evaluation.match(/DIAGNOSIS:\s*([\s\S]*?)(?=OUTPUT:|$)/i);

  const verdict = verdictMatch?.[1] || "UNKNOWN";
  const reason = reasonMatch?.[1]?.trim().split('\n')[0] || ""; // First line only
  const diagnosis = diagnosisMatch?.[1]?.trim().split('\n')[0] || ""; // First line only

  // If the LLM says PASS but passed is FALSE, it means a runtime/sandbox error occurred
  if (verdict === "PASS" && !passed) {
    return "Code passed logic verification but failed to execute in the sandbox. Checking logs...";
  }

  if (verdict === "PASS") return "All checks passed.";

  return `${reason || diagnosis || "Issues found"}`.slice(0, 200);
}

interface BuildEventData {
  slackChannelId: string;
  slackThreadTs: string;
  statusMessageTs?: string;
  slackUserId: string;
  messageText: string;
  runId: string;
  teamId?: string;
}

const LEDGER_TEMPLATE = (s1: string, s2: string, s3: string, s4: string, note?: string) =>
  `*Build Squad* — Active\n• ${s1} Strategy & Requirements
• ${s2} Implementation _(~2 min)_
• ${s3} QA Verification _(~1 min)_
• ${s4} Final Delivery${note ? `\n\n_${note}_` : ``}`;

export const buildSquadWorkflow = inngest.createFunction(
  { id: "build-squad", name: "Build Squad", retries: 2 },
  { event: "slack/build.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, statusMessageTs, slackUserId, messageText, runId, teamId } =
      event.data as BuildEventData;

    try {
      // 👀 Reaction lifecycle: signal we're reading the request
      await addReaction(slackChannelId, slackThreadTs, "eyes", teamId).catch(() => {});

      // Step 1: PM researches and writes spec
      const specResult = await step.run("pm-spec", async () => {
        if (statusMessageTs) {
          await updateMessage(slackChannelId, statusMessageTs, LEDGER_TEMPLATE(":large_blue_circle:", ":white_circle:", ":white_circle:", ":white_circle:"), undefined, teamId);
        }

        const runsList = await getRun(runId).catch((err) => { console.error("[DB] Error getting run by ID:", err); return null; });
        const actualRequest = runsList && runsList.length > 0 ? runsList[0].request : messageText;

        const userContext = await memoryRead(slackUserId, "preference");
        const spec = await createSpec(actualRequest, userContext);

        await updateRun(runId, {
          status: "pm",
          pmSpec: spec.spec,
          codeLanguage: spec.language,
        });

        return spec;
      });

      // Step 2: Post spec for approval + wait for decision
      const approval = await step.run("wait-for-approval", async () => {
        const depsSection = specResult.dependencies
          ? `\n*Dependencies:* ${specResult.dependencies}`
          : "";

        const fullBody = `*Language:* ${specResult.language}${depsSection}\n\n${specResult.spec}`;
        const blocks = approvalBlocks(
          "PM Agent -- Specification Ready",
          fullBody,
          runId,
          "build_spec"
        );

        const msg = await postToThread(
          slackChannelId,
          slackThreadTs,
          "*PM Agent* -- Specification ready for review",
          { blocks },
          teamId
        );

        if (fullBody.length > 2900) {
          await uploadFile(
            slackChannelId,
            slackThreadTs,
            specResult.spec,
            `spec-${runId.slice(0, 8)}.md`,
            "Full Specification",
            teamId
          );
        }

        await updateRun(runId, { status: "pending_approval" });

        return { messageTs: (msg as any).ts, blocks };
      });

      // Step 3: Wait for approve/reject event (24h timeout)
      const decision = await step.waitForEvent("wait-for-build-approval", {
        event: `app/build.approval/${runId}`,
        timeout: "24h",
      });

      if (!decision || decision.data.decision === "rejected") {
        await step.run("handle-rejection", async () => {
          const rejectorId = decision?.data.userId || "unknown";
          const updatedBlocks = replaceActionsWithDecision(
            approval.blocks,
            "rejected",
            rejectorId
          );

          if (approval.messageTs) {
            await updateMessage(
              slackChannelId,
              approval.messageTs,
              "*PM Agent* -- Specification was *rejected*",
              { blocks: updatedBlocks },
              teamId
            );
          }

          await updateRun(runId, { status: "error" });
          await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
        });
        return;
      }

      // Step 4: Engineer writes code (with learnings context)
      const codeResult = await step.run("engineer-code", async () => {
        if (statusMessageTs) {
          await updateMessage(slackChannelId, statusMessageTs, LEDGER_TEMPLATE(":white_check_mark:", ":large_blue_circle:", ":white_circle:", ":white_circle:", "Engineer is writing code..."), undefined, teamId);
        }
        // 🧠→✍️ Reaction lifecycle: shift from reading to implementing
        await removeReaction(slackChannelId, slackThreadTs, "eyes", teamId).catch(() => {});
        await addReaction(slackChannelId, slackThreadTs, "writing_hand", teamId).catch(() => {});

        const approverId = decision.data.userId || "unknown";
        const updatedBlocks = replaceActionsWithDecision(
          approval.blocks,
          "approved",
          approverId
        );

        if (approval.messageTs) {
          await updateMessage(
            slackChannelId,
            approval.messageTs,
            "*PM Agent* -- Specification *approved*",
            { blocks: updatedBlocks },
            teamId
          );
        }

        await updateRun(runId, { status: "coding" });

        const runsList = await getRun(runId).catch((err) => { console.error("[DB] Error getting run by ID:", err); return null; });
        const actualRequest = runsList && runsList.length > 0 ? runsList[0].request : messageText;

        const result = await writeCodeFromLearnings(
          specResult.spec,
          specResult.language,
          actualRequest,
          {
            runId,
            slackUserId,
            dependencies: specResult.dependencies,
          }
        );

        await updateRun(runId, { code: result.code });

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Engineer Agent* -- Code written (${specResult.language})`,
          undefined,
          teamId
        );

        const ext = specResult.language === "javascript" ? "js" : "py";
        // Use a meaningful filename derived from the spec rather than a random ID hash
        const specTitle = specResult.spec
          ?.split("\n").find((l: string) => l.trim().length > 5)
          ?.replace(/[^a-z0-9\s]/gi, "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_")
          .slice(0, 40) || `build_${runId.slice(0, 8)}`;
        await uploadFile(
          slackChannelId,
          slackThreadTs,
          result.code,
          `${specTitle}.${ext}`,
          "Generated Code",
          teamId
        );

        return result;
      });

      // Step 5: QA Test 1
      const test1 = await step.run("qa-test-1", async () => {
        if (statusMessageTs) {
          await updateMessage(slackChannelId, statusMessageTs, LEDGER_TEMPLATE(":white_check_mark:", ":white_check_mark:", ":large_blue_circle:", ":white_circle:", "QA running verification..."), undefined, teamId);
        }
        // ⚡ Reaction lifecycle: shift to testing
        await removeReaction(slackChannelId, slackThreadTs, "writing_hand", teamId).catch(() => {});
        await addReaction(slackChannelId, slackThreadTs, "microscope", teamId).catch(() => {});

        const runsList = await getRun(runId).catch((err) => { console.error("[DB] Error getting run by ID:", err); return null; });
        const actualRequest = runsList && runsList.length > 0 ? runsList[0].request : messageText;

        const result = await testCode(
          codeResult.code,
          specResult.language,
          specResult.spec,
          actualRequest,
          { runId, slackUserId, dependencies: specResult.dependencies }
        );

        const qaBrief = extractQABrief(result.evaluation, result.passed);
        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*QA Agent* -- Test 1: ${result.passed ? "PASS" : "FAIL"}\n${qaBrief}${result.passed ? "\n_Checking for deployment targets..._" : ""}`,
          undefined,
          teamId
        );

        // Persist learnings in background (non-blocking)
        persistLearning(
          specResult.language,
          specResult.spec,
          codeResult.code,
          result,
          runId
        ).catch(() => { });

        return result;
      });

      let finalCode = codeResult.code;
      let finalTest = test1;

      // Step 6: Fix if needed (once)
      if (!test1.passed) {
        const fixResult = await step.run("engineer-fix", async () => {
          const exec = test1.execution;
          const error = exec.stderr || exec.error || test1.evaluation;
          const fixed = await fixCode(codeResult.code, error, specResult.spec, { runId, slackUserId });

          await updateRun(runId, { code: fixed.code });
          await postToThread(slackChannelId, slackThreadTs, "*Engineer Agent* — Taking a different angle on the fix...", undefined, teamId);

          const ext = specResult.language === "javascript" ? "js" : "py";
          await uploadFile(
            slackChannelId,
            slackThreadTs,
            fixed.code,
            `build-${runId.slice(0, 8)}-v2.${ext}`,
            "Revised Code",
            teamId
          );
          return fixed;
        });

        finalCode = fixResult.code;

        // Step 7: QA Test 2
        finalTest = await step.run("qa-test-2", async () => {
          const runsList = await getRun(runId).catch((err) => { console.error("[DB] Error getting run by ID:", err); return null; });
          const actualRequest = runsList && runsList.length > 0 ? runsList[0].request : messageText;

          const result = await testCode(
            finalCode,
            specResult.language,
            specResult.spec,
            actualRequest,
            { runId, slackUserId, dependencies: specResult.dependencies }
          );

          const qaBrief2 = extractQABrief(result.evaluation, result.passed);
          await postToThread(
            slackChannelId,
            slackThreadTs,
            `*QA Agent* — Test 2: ${result.passed ? "PASS" : "FAIL"}\n${qaBrief2}`,
            undefined,
            teamId
          );

          persistLearning(specResult.language, specResult.spec, finalCode, result, runId).catch(() => {});
          return result;
        });

        // Step 7b: AUTONOMOUS ROOT CAUSE ANALYSIS on double-fail
        // Instead of silently delivering broken code, diagnose and present recovery options.
        if (!finalTest.passed) {
          await step.run("double-fail-rca", async () => {
            const { agentChat } = await import("@/core/llm");

            const rcaPrompt = `You are a senior engineer diagnosing a persistent build failure.

Original Request: ${messageText}

Spec:
${specResult.spec}

Test 1 failure:
${test1.evaluation?.slice(0, 1500)}

Test 2 failure (after fix attempt):
${finalTest.evaluation?.slice(0, 1500)}

Analyze the PATTERN across both failures. What is the ROOT CAUSE? Then propose exactly 3 recovery options.

Respond in this format (use Slack mrkdwn, *bold* not **bold**):
*Root Cause:* [one clear sentence]

*Recovery Options:*
1. [Option A — most likely fix]
2. [Option B — alternative approach]
3. [Option C — simplified version or different library]`;

            const rca = await agentChat("general", [
              { role: "system", content: "You are a senior engineer diagnosing a build failure. Be surgical and direct." },
              { role: "user", content: rcaPrompt }
            ], { temperature: 0.2, maxTokens: 1000 }, { workspaceId: undefined });

            const retryBtn = retryBlocks(runId, slackChannelId, slackThreadTs, slackUserId, messageText);

            await postToThread(
              slackChannelId,
              slackThreadTs,
              `*Build Squad — Two attempts, still failing.*\n\nI've tried this twice. Here's my analysis:\n\n${rca}\n\n_Reply with which option you want, or click Retry to go again with the same spec._`,
              { blocks: retryBtn },
              teamId
            );
          });

          // Update ledger to reflect double-fail state
          if (statusMessageTs) {
            await updateMessage(
              slackChannelId, statusMessageTs,
              LEDGER_TEMPLATE(":white_check_mark:", ":white_check_mark:", ":x:", ":x:", "Needs your input — see diagnosis below"),
              undefined, teamId
            );
          }

          await removeReaction(slackChannelId, slackThreadTs, "microscope", teamId).catch(() => {});
          await addReaction(slackChannelId, slackThreadTs, "red_circle", teamId).catch(() => {});
          await updateRun(runId, { status: "error" });
          await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
          return; // Exit early — we've given the user actionable recovery options
        }
      }

      // Step 8: Deliver
      await step.run("deliver", async () => {
        const exec = finalTest.execution as SandboxResponse;

        await updateRun(runId, {
          status: "done",
          testResult: {
            passed: finalTest.passed,
            output: exec.stdout,
            error: exec.error || exec.stderr,
          },
          finalOutput: finalTest.evaluation,
        });

        // ✅ Reaction lifecycle: clear microscope, set final state
        await removeReaction(slackChannelId, slackThreadTs, "microscope", teamId).catch(() => {});
        await addReaction(slackChannelId, slackThreadTs, "white_check_mark", teamId).catch(() => {});

        if (statusMessageTs) {
          await updateMessage(
            slackChannelId, statusMessageTs,
            LEDGER_TEMPLATE(":white_check_mark:", ":white_check_mark:", ":white_check_mark:", ":white_check_mark:"),
            undefined, teamId
          );
        }

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Build Squad — Done.* Ready and tested. Check the files above.\n_Reply here if you need changes._`,
          undefined,
          teamId
        );

        await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "success");
      });
    } catch (workflowError) {
      console.error("[BUILD-SQUAD] Workflow error:", workflowError);
      try {
        await updateRun(runId, { status: "error" });
        await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
        // 🔴 Reaction lifecycle: clear any in-progress reaction, set error state
        await removeReaction(slackChannelId, slackThreadTs, "eyes", teamId).catch(() => {});
        await removeReaction(slackChannelId, slackThreadTs, "writing_hand", teamId).catch(() => {});
        await removeReaction(slackChannelId, slackThreadTs, "microscope", teamId).catch(() => {});
        await addReaction(slackChannelId, slackThreadTs, "red_circle", teamId).catch(() => {});
        if (statusMessageTs) {
          await updateMessage(
            slackChannelId, statusMessageTs,
            LEDGER_TEMPLATE(":x:", ":x:", ":x:", ":x:", "Unexpected error — see thread"),
            undefined, teamId
          ).catch(() => {});
        }
        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Build Squad — Something went wrong.*\n\n${(workflowError as Error).message?.slice(0, 400) || "Unknown error"}\n_Reply here to retry._`,
          undefined,
          teamId
        );
      } catch (notifyError) {
        console.error("[BUILD-SQUAD] Failed to notify user of error:", notifyError);
      }
    }
  }
);
