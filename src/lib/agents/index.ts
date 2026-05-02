import { llm } from "@/lib/llm";
import { tools } from "@/lib/tools";

// Agent system prompts — FORCEFUL, no ambiguity
const SYSTEM_PROMPTS = {
  general: `You are Klawhub, the coordinator of the Build Squad. Your ONLY job is to classify user messages into ONE of three categories:

1. BUILD — User wants a script, tool, function, automation, or piece of software built
2. CHAT — User is greeting, asking a question, making conversation, or giving feedback
3. UNCLEAR — User might want something built but the request is too vague

Rules:
- If BUILD: extract the exact build request and return ONLY: BUILD: [the request]
- If CHAT: return ONLY: CHAT: [your friendly response, max 2 sentences]
- If UNCLEAR: return ONLY: UNCLEAR: [one clarifying question]

Never explain your reasoning. Never ask follow-up questions in BUILD or CHAT. Be decisive.`,

  pm: `You are the PM Agent of Klawhub Build Squad. You write technical specifications for small software tools.

CRITICAL RULES:
1. You ALWAYS write a spec. Never ask the user for more details.
2. If the request is vague, make reasonable assumptions and write the spec anyway.
3. Keep specs under 200 words.
4. Be specific about: inputs, outputs, logic flow, and libraries.
5. Choose Python for data/API tasks, JavaScript for web/UI tasks.

Format:
LANGUAGE: <python or javascript>
SPEC:
<concise technical spec>

Example good spec:
"Build a Python script that fetches Bitcoin price from CoinGecko API and prints it. Use requests library. Endpoint: https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd. Handle network errors gracefully. Output format: 'Bitcoin: $XX,XXX'"

Never say "please provide details" or "I need more information". Just write the spec.`,

  engineer: `You are the Engineer Agent of Klawhub Build Squad. You write working code.

CRITICAL RULES:
1. Write MINIMAL working code. No classes, no abstractions, no boilerplate unless specifically needed.
2. The code MUST do something useful immediately when run. No placeholder URLs, no dummy data.
3. Python: use requests, json, sys. JavaScript: use fetch.
4. Include basic error handling (try/catch or if/else).
5. If the spec mentions an API, use a REAL public API endpoint that works.
6. Keep it under 80 lines. Single script, top-to-bottom execution.
7. NEVER write generic wrapper classes, abstract base classes, or "Tool" classes.
8. If the spec is vague about an API endpoint, pick a real one that exists.

Return ONLY the code inside a markdown code block. No explanations outside the block.`,

  qa: `You are the QA Agent of Klawhub Build Squad. You test code ruthlessly.

CRITICAL RULES:
1. The code MUST run without errors to pass.
2. The code MUST produce meaningful output (not empty, not just "success").
3. If the code uses an API, check that the endpoint looks real and the params are correct.
4. If the code has placeholder data or dummy URLs, FAIL it immediately.
5. If the code is a generic class/wrapper with no actual functionality, FAIL it.
6. Be concise. One sentence per issue found.

Format:
VERDICT: <PASS or FAIL>
REASON: <why it passed or failed, max 3 sentences>
OUTPUT: <what the code actually produced when run>`,
};

export const agents = {
  general: {
    name: "General",
    slackName: "Klawhub",
    async classify(userMessage: string) {
      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPTS.general },
        { role: "user" as const, content: userMessage },
      ];
      const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 200 });

      const buildMatch = response.match(/^BUILD:\s*(.+)/im);
      const chatMatch = response.match(/^CHAT:\s*(.+)/im);
      const unclearMatch = response.match(/^UNCLEAR:\s*(.+)/im);

      if (buildMatch) {
        return { type: "build" as const, extractedRequest: buildMatch[1].trim() };
      }
      if (chatMatch) {
        return { type: "chat" as const, response: chatMatch[1].trim() };
      }
      if (unclearMatch) {
        return { type: "unclear" as const, question: unclearMatch[1].trim() };
      }

      // Fallback — if the LLM didn't follow format, assume chat
      return { type: "chat" as const, response: response.slice(0, 200) };
    },
  },

  pm: {
    name: "PM",
    slackName: "klawhub-pm",
    async createSpec(request: string, userContext: string) {
      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPTS.pm },
        { role: "user" as const, content: `Build request: ${request}\n\nUser context: ${userContext}` },
      ];
      const response = await llm.chat(messages, { temperature: 0.5, maxTokens: 500 });

      const langMatch = response.match(/LANGUAGE:\s*(\w+)/i);
      const specMatch = response.match(/SPEC:\s*([\s\S]*)/i);

      return {
        language: langMatch?.[1]?.toLowerCase() || "python",
        spec: specMatch?.[1]?.trim() || response,
        raw: response,
      };
    },
  },

  engineer: {
    name: "Engineer",
    slackName: "klawhub-dev",
    async writeCode(spec: string, language: string) {
      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPTS.engineer },
        { role: "user" as const, content: `Language: ${language}\n\nSpecification:\n${spec}` },
      ];
      const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 1500 });

      const codeMatch = response.match(/```(?:\w+)?\n?([\s\S]*?)```/);
      return {
        code: codeMatch?.[1]?.trim() || response.trim(),
        raw: response,
      };
    },

    async fixCode(code: string, error: string, spec: string) {
      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPTS.engineer },
        { role: "user" as const, content: `Fix this code.\n\nSpecification:\n${spec}\n\nCurrent code:\n${code}\n\nError/QA feedback:\n${error}\n\nReturn the corrected code.` },
      ];
      const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 1500 });
      const codeMatch = response.match(/```(?:\w+)?\n?([\s\S]*?)```/);
      return {
        code: codeMatch?.[1]?.trim() || response.trim(),
        raw: response,
      };
    },
  },

  qa: {
    name: "QA",
    slackName: "klawhub-qa",
    async testCode(code: string, language: string, spec: string) {
      const execution = await tools.code_execute({ code, language });

      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPTS.qa },
        {
          role: "user" as const,
          content: `Specification:\n${spec}\n\nCode:\n${code}\n\nExecution result:\nstdout: ${execution.stdout}\nstderr: ${execution.stderr}\nerror: ${execution.error || "none"}`,
        },
      ];
      const evaluation = await llm.chat(messages, { temperature: 0.3, maxTokens: 500 });

      const verdictMatch = evaluation.match(/VERDICT:\s*(PASS|FAIL)/i);
      const passed = verdictMatch?.[1]?.toUpperCase() === "PASS" && execution.passed;

      return {
        passed,
        evaluation,
        execution,
      };
    },
  },
};
