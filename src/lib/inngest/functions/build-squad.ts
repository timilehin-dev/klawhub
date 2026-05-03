import { inngest } from "../client";
import { createSpec } from "@/lib/agents/pm";
import { writeCode, fixCode } from "@/lib/agents/engineer";
import { testCode } from "@/lib/agents/qa";
import { trackSkillUsage } from "@/lib/db";
import { memoryRead } from "@/lib/tools/memory";
import {
  postToThread,
  updateMessage,
  addReaction,
  removeReaction,
  uploadFile,
} from "@/lib/slack/client";
import {
  approvalBlocks,
  replaceActionsWithDecision,
  retryBlocks,
} from "@/lib/slack/blocks";
import { updateRun } from "@/lib/db";
import type { SandboxResponse } from "@/types";

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

    // Ensure skill usage is tracked even if intermediate steps fail
    try {
      // Step 1: PM writes spec
    const specResult = await step.run("pm-spec", async () => {
      const userContext = await memoryRead(slackUserId, "preference");
      const spec = await createSpec(messageText, userContext);

      await updateRun(runId, {
        status: "pm",
        pmSpec: spec.spec,
        codeLanguage: spec.language,
      });

      return spec;
    });

    // Step 2: Post spec for approval + wait for decision
    const approval = await step.run("wait-for-approval", async () => {
      const blocks = approvalBlocks(
        "PM Agent — Specification Ready",
        `*Language:* ${specResult.language}\n\n${specResult.spec}`,
        runId,
        "build_spec"
      );

      const msg = await postToThread(
        slackChannelId,
        slackThreadTs,
        `*PM Agent* — Specification ready for review`,
        { blocks },
        teamId
      );

      await updateRun(runId, { status: "pending_approval" });

      return { messageTs: (msg as any).ts, blocks };
    });

    // Step 3: Wait for approve/reject event (24h timeout)
    const decision = await step.waitForEvent("wait-for-build-approval", {
      event: "app/approval.decided",
      timeout: "24h",
      match: "data.referenceId",
    });

    if (!decision || decision.data.decision === "rejected") {
      await step.run("handle-rejection", async () => {
        const rejectorId = decision?.data.userId || "unknown";
        const updatedBlocks = replaceActionsWithDecision(
          approval.blocks,
          "rejected",
          rejectorId
        );

        // Update the spec message to show rejection
        if (approval.messageTs) {
          await updateMessage(
            slackChannelId,
            approval.messageTs,
            `*PM Agent* — Specification was *rejected*`,
            { blocks: updatedBlocks },
            teamId
          );
        }

        await updateRun(runId, { status: "error" });
        await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
      });
      return;
    }

    // Step 4: Engineer writes code
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
          `*PM Agent* — Specification *approved*`,
          { blocks: updatedBlocks },
          teamId
        );
      }

      await updateRun(runId, { status: "coding" });

      const result = await writeCode(specResult.spec, specResult.language, { runId, slackUserId });
      await updateRun(runId, { code: result.code });

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `*Engineer Agent* — Code written (${specResult.language})`,
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
      const result = await testCode(codeResult.code, specResult.language, specResult.spec, { runId, slackUserId });

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `*QA Agent* — Test 1\n${result.passed ? "PASS" : "FAIL"}\n\n${result.evaluation.slice(0, 2000)}`,
        undefined,
        teamId
      );
      return result;
    });

    let finalCode = codeResult.code;
    let finalTest = test1;

    // Step 6: Fix if needed (once)
    if (!test1.passed) {
      const fixResult = await step.run("engineer-fix", async () => {
        const exec = test1.execution as SandboxResponse;
        const error = exec.stderr || exec.error || test1.evaluation;
        const fixed = await fixCode(codeResult.code, error, specResult.spec, { runId, slackUserId });

        await updateRun(runId, { code: fixed.code });
        await postToThread(slackChannelId, slackThreadTs, `*Engineer Agent* — Fixing issues...`, undefined, teamId);

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
        const result = await testCode(finalCode, specResult.language, specResult.spec, { runId, slackUserId });

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*QA Agent* — Test 2\n${result.passed ? "PASS" : "FAIL"}\n\n${result.evaluation.slice(0, 2000)}`,
          undefined,
          teamId
        );
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
          ? `*Build Squad — Delivered*\n\nYour tool is ready and tested. Check the files above.\n_Reply in this thread if you need changes._`
          : `*Build Squad — Delivered with Issues*\n\nQA flagged issues. Check the output above.`,
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
      // Track the error and notify the user
      console.error("[BUILD-SQUAD] Workflow error:", workflowError);
      try {
        await updateRun(runId, { status: "error" });
        await trackSkillUsage("build", slackUserId, slackChannelId, messageText, "error");
        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Build Squad — Error*\n\nAn error occurred during the build process: ${(workflowError as Error).message?.slice(0, 500) || "Unknown error"}.\n_Reply in this thread to retry._`,
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
