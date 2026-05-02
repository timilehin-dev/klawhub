import { inngest } from "../client";
import { agents } from "@/lib/agents";
import { tools } from "@/lib/tools";
import { slack, postToThread, uploadFile } from "@/lib/slack/client";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const buildSquadWorkflow = inngest.createFunction(
  { id: "build-squad", name: "Build Squad Workflow", retries: 2 },
  { event: "slack/build.requested" },
  async ({ event, step }) => {
    const { slackChannelId, slackThreadTs, slackUserId, messageText, runId } = event.data;

    // Step 1: PM Agent writes spec
    const pmResult = await step.run("pm-spec", async () => {
      const userMemory = await tools.memory_read({ slackUserId, query: "preference" });
      const spec = await agents.pm.createSpec(messageText, userMemory);

      await db
        .update(runs)
        .set({ status: "pm", pmSpec: spec.spec, codeLanguage: spec.language })
        .where(eq(runs.id, runId));

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `📋 *PM Agent* — Specification ready\n_Language: ${spec.language}_\n\n${spec.spec}`
      );

      return spec;
    });

    // Step 2: Engineer writes code
    const engineerResult = await step.run("engineer-code", async () => {
      const codeResult = await agents.engineer.writeCode(pmResult.spec, pmResult.language);

      await db
        .update(runs)
        .set({ status: "coding", code: codeResult.code })
        .where(eq(runs.id, runId));

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `👨‍💻 *Engineer Agent* — Code written (${pmResult.language})`
      );

      const ext = pmResult.language === "javascript" ? "js" : "py";
      await uploadFile(
        slackChannelId,
        slackThreadTs,
        codeResult.code,
        `build-${runId.slice(0, 8)}.${ext}`,
        "Generated Code"
      );

      return codeResult;
    });

    // Step 3: QA Test 1
    const test1 = await step.run("qa-test-1", async () => {
      const result = await agents.qa.testCode(
        engineerResult.code,
        pmResult.language,
        pmResult.spec
      );

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `🧪 *QA Agent* — Test 1\n${result.passed ? "✅ PASS" : "❌ FAIL"}\n\n${result.evaluation.slice(0, 2000)}`
      );

      return result;
    });

    let finalCode = engineerResult.code;
    let finalTest = test1;

    // Step 4: Fix if needed (only once)
    if (!test1.passed) {
      const fixResult = await step.run("engineer-fix", async () => {
        const error = test1.execution.error || test1.execution.stderr || test1.evaluation;
        const fixed = await agents.engineer.fixCode(engineerResult.code, error, pmResult.spec);

        await db.update(runs).set({ code: fixed.code }).where(eq(runs.id, runId));

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `👨‍💻 *Engineer Agent* — Fixing issues...`
        );

        const ext = pmResult.language === "javascript" ? "js" : "py";
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
        const result = await agents.qa.testCode(finalCode, pmResult.language, pmResult.spec);

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `🧪 *QA Agent* — Test 2\n${result.passed ? "✅ PASS" : "❌ FAIL"}\n\n${result.evaluation.slice(0, 2000)}`
        );

        return result;
      });
    }

    // Step 6: Deliver final result
    await step.run("deliver", async () => {
      const status = finalTest.passed ? "done" : "error";
      const emoji = finalTest.passed ? "white_check_mark" : "warning";

      await db
        .update(runs)
        .set({
          status,
          testResult: {
            passed: finalTest.passed,
            output: finalTest.execution.stdout,
            error: finalTest.execution.error || finalTest.execution.stderr,
          },
          finalOutput: finalTest.evaluation,
        })
        .where(eq(runs.id, runId));

      try {
        await slack.reactions.remove({
          channel: slackChannelId,
          timestamp: slackThreadTs,
          name: "gear",
        });
      } catch {}

      await slack.reactions.add({
        channel: slackChannelId,
        timestamp: slackThreadTs,
        name: emoji,
      });

      await postToThread(
        slackChannelId,
        slackThreadTs,
        finalTest.passed
          ? `🚀 *Build Squad — Delivered*\n\nYour tool is ready! The code has been tested and passed QA.\n\n_Reply in this thread if you need changes._`
          : `⚠️ *Build Squad — Delivered with Issues*\n\nThe code was delivered but QA flagged issues. Check the files above.\n\n_Reply in this thread if you want the team to try again._`
      );
    });
  }
);
