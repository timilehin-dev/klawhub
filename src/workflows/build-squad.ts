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
function extractQABrief(evaluation: string): string {
  const verdictMatch = evaluation.match(/VERDICT:\s*(PASS|FAIL)/i);
  const reasonMatch = evaluation.match(/REASON:\s*([\s\S]*?)(?=DIAGNOSIS:|OUTPUT:|$)/i);
  const diagnosisMatch = evaluation.match(/DIAGNOSIS:\s*([\s\S]*?)(?=OUTPUT:|$)/i);

  const verdict = verdictMatch?.[1] || "UNKNOWN";
  const reason = reasonMatch?.[1]?.trim().split('\n')[0] || ""; // First line only
  const diagnosis = diagnosisMatch?.[1]?.trim().split('\n')[0] || ""; // First line only

  if (verdict === "PASS") return "All checks passed.";

  return `${reason || diagnosis || "Issues found"}`.slice(0, 200);
}

interface BuildEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  runId: string;
  teamId?: string;
}

export const buildSquadWorkflow = inngest.createFunction(
  { id: "build-squad", name: "Build Squad", retries: 2 },
  { event: "slack/build.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, slackUserId, messageText, runId, teamId } =
      event.data as BuildEventData;

    try {
      // Step 1: PM researches and writes spec
      const specResult = await step.run("pm-spec", async () => {
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
        await uploadFile(
          slackChannelId,
          slackThreadTs,
          result.code,
          `build-${runId.slice(0, 8)}.${ext}`,
          "Generated Code",
          teamId
        );

        return result;
      });

      // Step 5: QA Test 1
      const test1 = await step.run("qa-test-1", async () => {
        const runsList = await getRun(runId).catch((err) => { console.error("[DB] Error getting run by ID:", err); return null; });
        const actualRequest = runsList && runsList.length > 0 ? runsList[0].request : messageText;

        const result = await testCode(
          codeResult.code,
          specResult.language,
          specResult.spec,
          actualRequest,
          { runId, slackUserId, dependencies: specResult.dependencies }
        );

        const qaBrief = result.passed ? "All checks passed. Ready for delivery." : extractQABrief(result.evaluation);
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
          await postToThread(slackChannelId, slackThreadTs, "*Engineer Agent* -- Fixing issues...", undefined, teamId);

          const ext = specResult.language === "javascript" ? "js" : "py";
          await uploadFile(
            slackChannelId,
            slackThreadTs,
            fixed.code,
            `build-${runId.slice(0, 8)}-fixed.${ext}`,
            "Fixed Code",
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

          const qaBrief2 = result.passed ? "All checks passed. Ready for delivery." : extractQABrief(result.evaluation);
          await postToThread(
            slackChannelId,
            slackThreadTs,
            `*QA Agent* -- Test 2: ${result.passed ? "PASS" : "FAIL"}\n${qaBrief2}`,
            undefined,
            teamId
          );

          // Persist fix learnings
          persistLearning(
            specResult.language,
            specResult.spec,
            finalCode,
            result,
            runId
          ).catch(() => { });

          return result;
        });
      }

      // Step 8: Deliver
      await step.run("deliver", async () => {
        const status = finalTest.passed ? "done" : "error";
        const exec = finalTest.execution as SandboxResponse;

        await updateRun(runId, {
          status,
          testResult: {
            passed: finalTest.passed,
            output: exec.stdout,
            error: exec.error || exec.stderr,
          },
          finalOutput: finalTest.evaluation,
        });

        try {
          await removeReaction(slackChannelId, slackThreadTs, "gear", teamId);
        } catch { /* ok */ }
        await addReaction(
          slackChannelId,
          slackThreadTs,
          finalTest.passed ? "white_check_mark" : "warning",
          teamId
        );

        const deliverBlocks = finalTest.passed
          ? []
          : retryBlocks(runId, slackChannelId, slackThreadTs, slackUserId, messageText);

        await postToThread(
          slackChannelId,
          slackThreadTs,
          finalTest.passed
            ? "*Build Squad -- Delivered*\n\nYour tool is ready and tested. Check the files above.\n_Reply in this thread if you need changes._"
            : "*Build Squad -- Delivered with Issues*\n\nQA flagged issues. Check the output above.",
          finalTest.passed ? undefined : { blocks: deliverBlocks },
          teamId
        );

        await trackSkillUsage(
          "build",
          slackUserId,
          slackChannelId,
          messageText,
          finalTest.passed ? "success" : "error"
        );
      });
    } catch (workflowError) {
      console.error("[BUILD-SQUAD] Workflow error:", workflowError);
      try {
        await updateRun(runId, { status: "error" });
        await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Build Squad -- Error*\n\nAn error occurred during the build process: ${(workflowError as Error).message?.slice(0, 500) || "Unknown error"}.\n_Reply in this thread to retry._`,
          undefined,
          teamId
        );
        try { await addReaction(slackChannelId, slackThreadTs, "warning", teamId); } catch { /* ok */ }
      } catch (notifyError) {
        console.error("[BUILD-SQUAD] Failed to notify user of error:", notifyError);
      }
    }
  }
);
