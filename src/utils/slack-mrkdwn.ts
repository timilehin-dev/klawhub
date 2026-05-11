/**
 * Convert GitHub/CommonMark markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - Slack bold: *text* (single asterisk)  vs GitHub: **text**
 * - Slack italic: _text_ (underscore)      vs GitHub: *text* or _text_
 * - Slack strikethrough: ~text~           vs GitHub: ~~text~~
 * - Slack has NO headings (# ## ###) — they render as literal text
 * - Slack bullet: • or -  (no nested lists)
 * - Slack code: `text` (same as GitHub)
 * - Slack code blocks: ``` (same as GitHub)
 */

/**
 * Convert markdown text to Slack-compatible mrkdwn.
 * This is a lightweight converter focused on the patterns LLMs typically output.
 */
export function toSlackMrkdwn(text: string): string {
  if (!text) return text;

  let result = text;

  // 0. Strip language tags from code blocks (e.g., ```python -> ```)
  // Slack does not render code blocks properly if a language tag is present in standard text messages
  result = result.replace(/^```[a-zA-Z0-9_+-]+\s*$/gm, "```");

  // 1. Remove heading markers (# ### ####) — convert to bold text instead
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => `*${heading.trim()}*`);

  // 2. Convert GitHub bold (**text**) to Slack bold (*text*)
  //    Must be done BEFORE italic conversion to avoid conflicts
  // 1. Handle leftover triple/quad asterisks that LLMs sometimes generate (artifacts)
  //    e.g., "***", "++++", "___" — strip them entirely
  result = result.replace(/\*{3,}/g, "");
  result = result.replace(/\+{2,}/g, " ");
  result = result.replace(/_{3,}/g, "");

  // 2. Convert GitHub bold (**text**) to Slack bold (*text*)
  result = result.replace(/\*\*([^*]+)\*\*/g, "*$1*");

  // 3. Convert GitHub strikethrough (~~text~~) to Slack (~text~)
  result = result.replace(/~~([^~]+)~~/g, "~$1~");

  // 4. Handle leftover triple/quad asterisks that LLMs sometimes generate (artifacts)
  //    e.g., "***", "++++", "___" — strip them entirely
  result = result.replace(/\*{3,}/g, "");
  result = result.replace(/\+{2,}/g, " ");
  result = result.replace(/_{3,}/g, "");

  // 5. Convert GitHub-style nested list indentation (4 spaces or tab) to 2 spaces
  //    Slack doesn't support nested lists, so flatten them with a sub-bullet indicator
  result = result.replace(/^(\s{2,4}|\t)([-*])\s+/gm, "  • ");

  // 6. Ensure bullet points use • for consistency (Slack renders both - and •)
  //    Keep - as-is since Slack also supports it, but ensure it has a space after
  result = result.replace(/^(\s*)-\s+/gm, "$1• ");

  // 7. Clean up any remaining double asterisks that weren't caught (edge cases)
  result = result.replace(/\*\*/g, "*");

  // 8. Remove any empty lines that have only whitespace artifacts
  result = result.replace(/^\s*\n/gm, "\n");

  // 9. Collapse excessive newlines (3+ → 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
