import puppeteer, { type Browser, type Page } from "puppeteer-core";

/**
 * Browser client — connects to a Lightpanda (or any CDP-compatible) browser instance.
 *
 * Lightpanda is a Zig-based headless browser that exposes a Chrome DevTools Protocol endpoint.
 * Run it with: lightpanda --remote-debugging-port=9222
 *
 * Set BROWSER_WS_URL env var to the WebSocket endpoint (e.g. ws://localhost:9222).
 * If not set, browser tools will gracefully report as unavailable.
 *
 * DESIGN: Each operation creates a fresh page and closes it after use.
 * No global singleton — safe on serverless (Vercel) where concurrent requests
 * share the same process but each invocation should be isolated.
 */

const BROWSER_TIMEOUT = 30_000; // 30 seconds for page operations
const CONNECTION_TIMEOUT = 10_000; // 10 seconds to connect

function getWsUrl(): string | null {
  return process.env.BROWSER_WS_URL || null;
}

/**
 * Create a one-shot browser connection. Each call gets a fresh connection.
 * The caller is responsible for closing it via `closeBrowser()`.
 */
export async function connectBrowser(): Promise<Browser | null> {
  const wsUrl = getWsUrl();
  if (!wsUrl) return null;

  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: { width: 1280, height: 720 },
    });
    return browser;
  } catch (err) {
    console.error("[BROWSER] Failed to connect:", (err as Error).message);
    return null;
  }
}

/**
 * Close a browser connection.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.disconnect();
  } catch {
    // Already disconnected or never connected
  }
}

/**
 * Check if browser tools are configured (env var exists).
 */
export function isBrowserConfigured(): boolean {
  return !!getWsUrl();
}

/**
 * Run a browser operation with automatic connection management.
 * Creates a fresh browser + page for each operation, ensuring isolation.
 */
export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>,
  options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2" }
): Promise<T | null> {
  const browser = await connectBrowser();
  if (!browser) return null;

  try {
    const page = await browser.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await closeBrowser(browser);
  }
}

/**
 * Create a new page (tab) in the browser — for advanced multi-step operations.
 * Caller MUST call closePage() when done.
 */
export async function createPage(): Promise<{ page: Page; cleanup: () => Promise<void> } | null> {
  const browser = await connectBrowser();
  if (!browser) return null;
  try {
    const page = await browser.newPage();
    return {
      page,
      cleanup: async () => {
        await page.close().catch(() => {});
        await closeBrowser(browser);
      },
    };
  } catch (err) {
    console.error("[BROWSER] Failed to create page:", (err as Error).message);
    await closeBrowser(browser);
    return null;
  }
}

// ── Convenience helpers (all use withBrowser internally) ──

export async function navigateTo(page: Page, url: string, waitUntil: "load" | "domcontentloaded" | "networkidle0" | "networkidle2" = "domcontentloaded"): Promise<{ title: string; url: string; statusCode: number | null }> {
  const response = await page.goto(url, {
    waitUntil,
    timeout: BROWSER_TIMEOUT,
  });
  return {
    title: await page.title(),
    url: page.url(),
    statusCode: response?.status() || null,
  };
}

export async function clickElement(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
    await page.click(selector);
    return true;
  } catch (err) {
    throw new Error(`Click failed for "${selector}": ${(err as Error).message.slice(0, 200)}`);
  }
}

export async function typeText(page: Page, selector: string, text: string, options?: { clearFirst?: boolean; delay?: number }): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
    if (options?.clearFirst) {
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press("Backspace");
    }
    await page.type(selector, text, { delay: options?.delay || 10 });
    return true;
  } catch (err) {
    throw new Error(`Type failed for "${selector}": ${(err as Error).message.slice(0, 200)}`);
  }
}

export async function selectOption(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
    await page.select(selector, value);
    return true;
  } catch (err) {
    throw new Error(`Select failed for "${selector}": ${(err as Error).message.slice(0, 200)}`);
  }
}

export async function scrapeText(page: Page, selector?: string): Promise<string> {
  if (selector) {
    try {
      await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
      return await page.$eval(selector, (el) => el.textContent || "");
    } catch (err) {
      throw new Error(`Scrape failed for "${selector}": ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return await page.evaluate(() => document.body.innerText);
}

export async function evaluateScript(page: Page, script: string): Promise<unknown> {
  return page.evaluate(script);
}

export async function screenshot(page: Page, options?: { fullPage?: boolean; selector?: string }): Promise<Buffer> {
  if (options?.selector) {
    const element = await page.$(options.selector);
    if (!element) throw new Error(`Element not found: "${options.selector}"`);
    const uint8 = await element.screenshot({ type: "png" });
    return Buffer.from(uint8);
  }
  const uint8 = await page.screenshot({
    type: "png",
    fullPage: options?.fullPage || false,
  });
  return Buffer.from(uint8);
}

export async function waitFor(
  page: Page,
  options: {
    selector?: string;
    navigation?: boolean;
    timeout?: number;
  }
): Promise<void> {
  const timeout = options.timeout || BROWSER_TIMEOUT;
  if (options.selector) {
    await page.waitForSelector(options.selector, { timeout });
  } else if (options.navigation) {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout });
  } else {
    await new Promise((resolve) => setTimeout(resolve, timeout));
  }
}

export async function getHtml(page: Page): Promise<string> {
  return await page.content();
}

export async function getLinks(page: Page): Promise<Array<{ text: string; href: string }>> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: (a.textContent || "").trim(),
      href: (a as HTMLAnchorElement).href,
    }))
  );
}

export function getBrowserStatus(): { available: boolean; wsUrl: string | null } {
  const wsUrl = getWsUrl();
  return {
    available: !!wsUrl,
    wsUrl,
  };
}

// Backward-compatible alias for actions.ts
export { isBrowserConfigured as isBrowserAvailable };
