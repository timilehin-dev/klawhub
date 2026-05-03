/**
 * High-level browser actions — wraps the low-level client into
 * tool-callable operations with proper error handling and cleanup.
 *
 * Every action uses the new `createPage()` helper which creates a fresh
 * browser connection per operation — safe on serverless (Vercel).
 */

import {
  createPage,
  navigateTo,
  clickElement,
  typeText,
  selectOption,
  scrapeText,
  screenshot,
  waitFor,
  getLinks,
  isBrowserConfigured,
  getBrowserStatus,
} from "./client";

// ── Error Helpers ──

function browserUnavailable(): string {
  return "Browser automation is not available. Set BROWSER_WS_URL env var to connect to a Lightpanda or CDP-compatible browser instance.";
}

// ── Public Actions ──

export async function browseUrl(url: string): Promise<string> {
  const result = await createPage();
  if (!result) return browserUnavailable();

  const { page, cleanup } = result;
  try {
    const nav = await navigateTo(page, url);
    const text = await scrapeText(page);
    const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n\n[... content truncated]" : text;
    return `Page: ${nav.title}\nURL: ${nav.url}\nStatus: ${nav.statusCode}\n\n${truncated}`;
  } finally {
    await cleanup();
  }
}

export async function browserScreenshot(url: string, options?: { fullPage?: boolean; selector?: string }): Promise<Buffer | null> {
  const result = await createPage();
  if (!result) return null;

  const { page, cleanup } = result;
  try {
    await navigateTo(page, url, "networkidle2");
    return await screenshot(page, options);
  } finally {
    await cleanup();
  }
}

export async function browserScrape(url: string, selector?: string): Promise<string> {
  const result = await createPage();
  if (!result) return browserUnavailable();

  const { page, cleanup } = result;
  try {
    await navigateTo(page, url);
    if (selector) {
      return await scrapeText(page, selector);
    }
    const text = await scrapeText(page);
    const truncated = text.length > 10000 ? text.slice(0, 10000) + "\n\n[... content truncated]" : text;
    return truncated;
  } finally {
    await cleanup();
  }
}

export async function browserGetLinks(url: string): Promise<string> {
  const result = await createPage();
  if (!result) return browserUnavailable();

  const { page, cleanup } = result;
  try {
    await navigateTo(page, url);
    const links = await getLinks(page);
    if (links.length === 0) return "No links found on the page.";
    return links.map((l, i) => `${i + 1}. ${l.text} → ${l.href}`).join("\n");
  } finally {
    await cleanup();
  }
}

export async function browserInteract(
  url: string,
  actions: Array<{ type: "click" | "type" | "select" | "wait" | "scrape"; selector?: string; value?: string }>
): Promise<string> {
  const result = await createPage();
  if (!result) return browserUnavailable();

  const { page, cleanup } = result;
  const results: string[] = [];

  try {
    await navigateTo(page, url);
    results.push(`Navigated to ${url}`);

    for (const action of actions) {
      switch (action.type) {
        case "click":
          if (!action.selector) { results.push("[ERROR] click requires a selector"); break; }
          await clickElement(page, action.selector);
          results.push(`Clicked: ${action.selector}`);
          break;

        case "type":
          if (!action.selector || !action.value) { results.push("[ERROR] type requires selector and value"); break; }
          await typeText(page, action.selector, action.value);
          results.push(`Typed "${action.value}" into ${action.selector}`);
          break;

        case "select":
          if (!action.selector || !action.value) { results.push("[ERROR] select requires selector and value"); break; }
          await selectOption(page, action.selector, action.value);
          results.push(`Selected "${action.value}" in ${action.selector}`);
          break;

        case "wait":
          await waitFor(page, { selector: action.selector, timeout: 10000 });
          results.push(action.selector ? `Waited for: ${action.selector}` : "Waited 10s");
          break;

        case "scrape":
          const text = action.selector
            ? await scrapeText(page, action.selector)
            : await scrapeText(page);
          const truncated = text.length > 4000 ? text.slice(0, 4000) + "...[truncated]" : text;
          results.push(`Scraped content:\n${truncated}`);
          break;
      }
    }

    // Get final page text
    const finalText = await scrapeText(page);
    if (finalText) {
      const truncated = finalText.length > 4000 ? finalText.slice(0, 4000) + "...[truncated]" : finalText;
      results.push(`\nFinal page content:\n${truncated}`);
    }

    return results.join("\n");
  } catch (err) {
    return results.join("\n") + `\n\n[ERROR] ${(err as Error).message}`;
  } finally {
    await cleanup();
  }
}

export async function browserEvaluate(url: string, script: string): Promise<string> {
  const result = await createPage();
  if (!result) return browserUnavailable();

  const { page, cleanup } = result;
  try {
    await navigateTo(page, url);
    const { evaluateScript } = await import("./client");
    const evalResult = await evaluateScript(page, script);
    return typeof evalResult === "string" ? evalResult : JSON.stringify(evalResult, null, 2);
  } catch (err) {
    return `[ERROR] ${(err as Error).message}`;
  } finally {
    await cleanup();
  }
}

export { isBrowserConfigured, getBrowserStatus };
