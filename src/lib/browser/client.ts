import puppeteer, { type Browser, type Page, type LaunchOptions } from "puppeteer-core";

/**
 * Browser client — connects to a Lightpanda (or any CDP-compatible) browser instance.
 *
 * Lightpanda is a Zig-based headless browser that exposes a Chrome DevTools Protocol endpoint.
 * Run it with: lightpanda --remote-debugging-port=9222
 *
 * Set BROWSER_WS_URL env var to the WebSocket endpoint (e.g. ws://localhost:9222).
 * If not set, browser tools will gracefully report as unavailable.
 */

const BROWSER_TIMEOUT = 30_000; // 30 seconds for page operations

let _browser: Browser | null = null;
let _browserInitPromise: Promise<Browser | null> | null = null;

function getWsUrl(): string | null {
  return process.env.BROWSER_WS_URL || null;
}

/**
 * Connect to the browser instance. Reuses connection if already established.
 */
export async function getBrowser(): Promise<Browser | null> {
  if (_browser && _browser.connected) return _browser;
  if (_browserInitPromise) return _browserInitPromise;

  const wsUrl = getWsUrl();
  if (!wsUrl) return null;

  _browserInitPromise = (async () => {
    try {
      _browser = await puppeteer.connect({
        browserWSEndpoint: wsUrl,
        defaultViewport: { width: 1280, height: 720 },
      });
      _browser.on("disconnected", () => {
        _browser = null;
        _browserInitPromise = null;
      });
      return _browser;
    } catch (err) {
      console.error("[BROWSER] Failed to connect:", (err as Error).message);
      _browser = null;
      _browserInitPromise = null;
      return null;
    }
  })();

  return _browserInitPromise;
}

/**
 * Check if browser is available.
 */
export async function isBrowserAvailable(): Promise<boolean> {
  const browser = await getBrowser();
  return browser !== null;
}

/**
 * Create a new page (tab) in the browser.
 */
export async function createPage(): Promise<Page | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  try {
    return await browser.newPage();
  } catch (err) {
    console.error("[BROWSER] Failed to create page:", (err as Error).message);
    return null;
  }
}

/**
 * Close a page (tab).
 */
export async function closePage(page: Page): Promise<void> {
  try {
    await page.close();
  } catch {
    // Page may already be closed
  }
}

/**
 * Navigate to a URL and wait for the page to load.
 */
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

/**
 * Click an element on the page using a CSS selector.
 */
export async function clickElement(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
    await page.click(selector);
    return true;
  } catch (err) {
    throw new Error(`Click failed for "${selector}": ${(err as Error).message.slice(0, 200)}`);
  }
}

/**
 * Type text into an input field.
 */
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

/**
 * Select a value from a dropdown (select element).
 */
export async function selectOption(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
    await page.select(selector, value);
    return true;
  } catch (err) {
    throw new Error(`Select failed for "${selector}": ${(err as Error).message.slice(0, 200)}`);
  }
}

/**
 * Extract visible text content from the page.
 */
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

/**
 * Extract structured data from the page (returns JSON-serializable data from JS evaluation).
 */
export async function evaluateScript(page: Page, script: string): Promise<unknown> {
  return page.evaluate(script);
}

/**
 * Take a screenshot of the page. Returns a Buffer.
 */
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

/**
 * Wait for a specific condition (selector appears, navigation, timeout).
 */
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

/**
 * Get the HTML source of the page.
 */
export async function getHtml(page: Page): Promise<string> {
  return await page.content();
}

/**
 * Get all links from the page.
 */
export async function getLinks(page: Page): Promise<Array<{ text: string; href: string }>> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: (a.textContent || "").trim(),
      href: (a as HTMLAnchorElement).href,
    }))
  );
}

/**
 * Check if browser tools are configured and available.
 */
export function getBrowserStatus(): { available: boolean; wsUrl: string | null; connected: boolean } {
  const wsUrl = getWsUrl();
  return {
    available: !!wsUrl,
    wsUrl,
    connected: _browser?.connected || false,
  };
}
