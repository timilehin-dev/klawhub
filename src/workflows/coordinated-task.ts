import { inngest } from "./client";
import { conductResearch } from "@/core/agents/researcher";
import { createSpec } from "@/core/agents/pm";
import { writeCodeFromLearnings, fixCode } from "@/core/agents/engineer";
import { testCode, persistLearning } from "@/core/agents/qa";
import { memoryRead, memoryWrite } from "@/core/tools/memory";
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
import { updateRun, trackSkillUsage } from "@/db";
import type { SandboxResponse } from "@/types";

interface CoordinatedEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  runId: string;
  teamId?: string;
}

/**
 * Coordinated Task Workflow — Phase 4 Coordinator Agent.
 *
 * Unlike the sequential build-squad (PM → Approval → Engineer → QA),
 * this workflow runs Research + PM spec generation in PARALLEL,
 * then feeds the combined context to the Engineer, followed by QA.
 *
 * Flow:
 *   [Research Agent]  ──┐
 *                       ├──→ PM Spec (enriched) → Approval → Engineer → QA → Deliver
 *   [User Preferences] ─┘
 */
export const coordinatedTaskWorkflow = inngest.createFunction(
  { id: "coordinated-task", name: "Coordinated Task", retries: 2 },
  { event: "slack/coordinated.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, slackUserId, messageText, runId, teamId } =
      event.data as CoordinatedEventData;

    try {
      // Step 1: Run Research + User Context in PARALLEL
      await postToThread(
        slackChannelId, slackThreadTs,
        `:zap: *Coordinator Agent* — Launching parallel execution:\n• Research Agent: Gathering real-time data\n• PM Agent: Preparing to draft specification`,
        undefined, teamId
      );

      const parallelResult = await step.run("parallel-research-context", async () => {
        const [researchResult, userContext] = await Promise.all([
          conductResearch(messageText, { taskId: runId, slackUserId }),
          memoryRead(slackUserId, "preference"),
        ]);

        await postToThread(
          slackChannelId, slackThreadTs,
          `*Research Agent* — Completed. Found ${researchResult.sources.length} sources.`,
          undefined, teamId
        );

        return { research: researchResult, userContext };
      });

      // Step 2: PM generates spec ENRICHED with research findings
      const specResult = await step.run("pm-spec-enriched", async () => {
        const enrichedRequest = `${messageText}\n\n--- RESEARCH FINDINGS (use these to inform the spec) ---\n${parallelResult.research.findings.slice(0, 4000)}`;

        const spec = await createSpec(enrichedRequest, parallelResult.userContext);

        await updateRun(runId, {
          status: "pm",
          pmSpec: spec.spec,
          codeLanguage: spec.language,
        });

        return spec;
      });

      // Step 3: Post spec for approval
      const approval = await step.run("wait-for-approval", async () => {
        const depsSection = specResult.dependencies
          ? `\n*Dependencies:* ${specResult.dependencies}`
          : "";

        const fullBody = `*Language:* ${specResult.language}${depsSection}\n\n${specResult.spec}`;
        const blocks = approvalBlocks(
          "Coordinator — Research-Enriched Specification Ready",
          fullBody,
          runId,
          "build_spec"
        );

        const msg = await postToThread(
          slackChannelId, slackThreadTs,
          "*Coordinator* — Specification ready for review (enriched with real-time research)",
          { blocks }, teamId
        );

        if (fullBody.length > 2900) {
          await uploadFile(
            slackChannelId, slackThreadTs,
            specResult.spec,
            `spec-${runId.slice(0, 8)}.md`,
            "Full Specification", teamId
          );
        }

        await updateRun(runId, { status: "pending_approval" });
        return { messageTs: (msg as any).ts, blocks };
      });

      // Step 4: Wait for approval (24h timeout)
      const decision = await step.waitForEvent("wait-for-coordinated-approval", {
        event: `app/build.approval/${runId}`,
        timeout: "24h",
      });

      if (!decision || decision.data.decision === "rejected") {
        await step.run("handle-rejection", async () => {
          const rejectorId = decision?.data.userId || "unknown";
          const updatedBlocks = replaceActionsWithDecision(approval.blocks, "rejected", rejectorId);

          if (approval.messageTs) {
            await updateMessage(
              slackChannelId, approval.messageTs,
              "*Coordinator* — Specification was *rejected*",
              { blocks: updatedBlocks }, teamId
            );
          }

          await updateRun(runId, { status: "error" });
          await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
        });
        return;
      }

      // Step 5: Engineer writes code (with research + spec context)
      const codeResult = await step.run("engineer-code", async () => {
        const approverId = decision.data.userId || "unknown";
        const updatedBlocks = replaceActionsWithDecision(approval.blocks, "approved", approverId);

        if (approval.messageTs) {
          await updateMessage(
            slackChannelId, approval.messageTs,
            "*Coordinator* — Specification *approved*",
            { blocks: updatedBlocks }, teamId
          );
        }

        await updateRun(runId, { status: "coding" });

        const result = await writeCodeFromLearnings(
          specResult.spec, specResult.language, messageText,
          { runId, slackUserId, dependencies: specResult.dependencies }
        );

        await updateRun(runId, { code: result.code });
        await postToThread(slackChannelId, slackThreadTs,
          `*Engineer Agent* — Code written (${specResult.language})`, undefined, teamId);

        const ext = specResult.language === "javascript" ? "js" : "py";
        await uploadFile(slackChannelId, slackThreadTs,
          result.code, `build-${runId.slice(0, 8)}.${ext}`, "Generated Code", teamId);

        return result;
      });

      // Step 6: QA Test
      const test1 = await step.run("qa-test-1", async () => {
        const result = await testCode(
          codeResult.code, specResult.language, specResult.spec, messageText,
          { runId, slackUserId }
        );

        await postToThread(slackChannelId, slackThreadTs,
          `*QA Agent* — Test 1\n${result.passed ? "PASS" : "FAIL"}\n\n${result.evaluation}`,
          undefined, teamId);

        persistLearning(specResult.language, specResult.spec, codeResult.code, result, runId)
          .catch(() => {});

        return result;
      });

      let finalCode = codeResult.code;
      let finalTest = test1;

      // Step 7: Fix if needed (once)
      if (!test1.passed) {
        const fixResult = await step.run("engineer-fix", async () => {
          const exec = test1.execution;
          const error = exec.stderr || exec.error || test1.evaluation;
          const fixed = await fixCode(codeResult.code, error, specResult.spec, { runId, slackUserId });

          await updateRun(runId, { code: fixed.code });
          await postToThread(slackChannelId, slackThreadTs, "*Engineer Agent* — Fixing issues...", undefined, teamId);

          const ext = specResult.language === "javascript" ? "js" : "py";
          await uploadFile(slackChannelId, slackThreadTs,
            fixed.code, `build-${runId.slice(0, 8)}-fixed.${ext}`, "Fixed Code", teamId);
          return fixed;
        });

        finalCode = fixResult.code;

        finalTest = await step.run("qa-test-2", async () => {
          const result = await testCode(
            finalCode, specResult.language, specResult.spec, messageText,
            { runId, slackUserId }
          );

          await postToThread(slackChannelId, slackThreadTs,
            `*QA Agent* — Test 2\n${result.passed ? "PASS" : "FAIL"}\n\n${result.evaluation}`,
            undefined, teamId);

          persistLearning(specResult.language, specResult.spec, finalCode, result, runId)
            .catch(() => {});

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

        try { await removeReaction(slackChannelId, slackThreadTs, "gear", teamId); } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs,
          finalTest.passed ? "white_check_mark" : "warning", teamId);

        const deliverBlocks = finalTest.passed
          ? []
          : retryBlocks(runId, slackChannelId, slackThreadTs, slackUserId, messageText);

        await postToThread(slackChannelId, slackThreadTs,
          finalTest.passed
            ? "*Coordinator — Delivered*\n\nYour tool is ready and tested (built with live research context). Check the files above.\n_Reply in this thread if you need changes._"
            : "*Coordinator — Delivered with Issues*\n\nQA flagged issues. Check the output above.",
          finalTest.passed ? undefined : { blocks: deliverBlocks }, teamId
        );

        // Save research to memory for future context
        memoryWrite(slackUserId, `Coordinated build: ${messageText.slice(0, 100)}`, "project").catch(() => {});

        await trackSkillUsage("build", slackUserId, slackChannelId, messageText,
          finalTest.passed ? "success" : "error");
      });
    } catch (workflowError) {
      console.error("[COORDINATED] Workflow error:", workflowError);
      try {
        await updateRun(runId, { status: "error" });
        await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
        await postToThread(slackChannelId, slackThreadTs,
          `*Coordinator — Error*\n\nAn error occurred: ${(workflowError as Error).message?.slice(0, 500) || "Unknown error"}.\n_Reply in this thread to retry._`,
          undefined, teamId);
        try { await addReaction(slackChannelId, slackThreadTs, "warning", teamId); } catch { /* ok */ }
      } catch (notifyError) {
        console.error("[COORDINATED] Failed to notify user of error:", notifyError);
      }
    }
  }
);
