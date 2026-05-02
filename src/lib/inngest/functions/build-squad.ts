import { inngest } from "../client";
import { createSpec } from "@/lib/agents/pm";
import { writeCode, fixCode } from "@/lib/agents/engineer";
import { testCode } from "@/lib/agents/qa";
import { memoryRead } from "@/lib/tools/memory";
import { postToThread, addReaction, removeReaction, uploadFile } from "@/lib/slack/client";
import { updateRun } from "@/lib/db";
import type { SandboxResponse } from "@/types";

interface BuildEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  runId: string;
}

export const buildSquadWorkflow = inngest.createFunction(
  { id: "build-squad", name: "Build Squad", retries: 2 },
  { event: "slack/build.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, slackUserId, messageText, runId } =
      event.data as BuildEventData;

    // Step 1: PM writes spec
    const specResult = await step.run("pm-spec", async () => {
      const userContext = await memoryRead(slackUserId, "preference");
      const spec = await createSpec(messageText, userContext);

      await updateRun(runId, { status: "pm", pmSpec: spec.spec, codeLanguage: spec.language });

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `📋 *PM Agent* — Specification ready\n_Language: ${spec.language}_\n\n${spec.spec}`
      );
      return spec;
    });

    // Step 2: Engineer writes code
    const codeResult = await step.run("engineer-code", async () => {
      const result = await writeCode(specResult.spec, specResult.language);

      await updateRun(runId, { status: "coding", code: result.code });

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `👨‍💻 *Engineer Agent* — Code written (${specResult.language})`
      );

      const ext = specResult.language === "javascript" ? "js" : "py";
      await uploadFile(
        slackChannelId,
        slackThreadTs,
        result.code,
        `build-${runId.slice(0, 8)}.${ext}`,
        "Generated Code"
      );

      return result;
    });

    // Step 3: QA Test 1
    const test1 = await step.run("qa-test-1", async () => {
      const result = await testCode(codeResult.code, specResult.language, specResult.spec);

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `🧪 *QA Agent* — Test 1\n${result.passed ? "✅ PASS" : "❌ FAIL"}\n\n${result.evaluation.slice(0, 2000)}`
      );
      return result;
    });

    let finalCode = codeResult.code;
    let finalTest = test1;

    // Step 4: Fix if needed (once)
    if (!test1.passed) {
      const fixResult = await step.run("engineer-fix", async () => {
        const exec = test1.execution as SandboxResponse;
        const error = exec.stderr || exec.error || test1.evaluation;
        const fixed = await fixCode(codeResult.code, error, specResult.spec);

        await updateRun(runId, { code: fixed.code });

        await postToThread(slackChannelId, slackThreadTs, `👨‍💻 *Engineer Agent* — Fixing issues...`);

        const ext = specResult.language === "javascript" ? "js" : "py";
        await uploadFile(
          slackChannelId,
          slackThreadTs,
          fixed.code,
          `build-${runId.slice(0, 8)}-fixed.${ext}`,
          "Fixed Code"
        );
        return fixed;
      });

      finalCode = fixResult.code;

      // Step 5: QA Test 2
      finalTest = await step.run("qa-test-2", async () => {
        const result = await testCode(finalCode, specResult.language, specResult.spec);

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `🧪 *QA Agent* — Test 2\n${result.passed ? "✅ PASS" : "❌ FAIL"}\n\n${result.evaluation.slice(0, 2000)}`
        );
        return result;
      });
    }

    // Step 6: Deliver
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

      try { await removeReaction(slackChannelId, slackThreadTs, "gear"); } catch { /* ok */ }
      await addReaction(slackChannelId, slackThreadTs, finalTest.passed ? "white_check_mark" : "warning");

      await postToThread(
        slackChannelId,
        slackThreadTs,
        finalTest.passed
          ? `🚀 *Build Squad — Delivered*\n\nYour tool is ready and tested. Check the files above.\n_Reply in this thread if you need changes._`
          : `⚠️ *Build Squad — Delivered with Issues*\n\nQA flagged issues. Check the output above.\n_Reply in this thread if you want a retry._`
      );
    });
  }
);
