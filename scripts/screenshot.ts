import { chromium, devices, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

const COOKIE_ACCEPT_SELECTORS = [
  // Common Spanish-language accept buttons
  'button:has-text("Aceptar")',
  'button:has-text("Acepto")',
  'button:has-text("Aceptar cookies")',
  'button:has-text("Aceptar todas")',
  'button:has-text("Aceptar todo")',
  // Common English-language accept buttons
  'button:has-text("Accept")',
  'button:has-text("Accept all")',
  'button:has-text("Accept cookies")',
  // Common cookie consent framework selectors
  "#onetrust-accept-btn-handler",
  ".cc-accept",
  ".cc-btn.cc-dismiss",
  '[data-testid="cookie-accept"]',
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  ".cookie-consent-accept",
  "#cookie_action_close_header",
];

export async function dismissCookieConsent(page: Page): Promise<void> {
  for (const selector of COOKIE_ACCEPT_SELECTORS) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        // Wait briefly for the modal to disappear
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // Selector not found or not visible — try next
    }
  }
}
export type CaptureResolution = "390x844" | "414x896";

export interface ScreenshotResult {
  path: string;
  url: string;
  capturedAt: string;
  resolution: CaptureResolution;
}

export const RESOLUTION_DEVICE: Record<CaptureResolution, string> = {
  "390x844": "iPhone 13",
  "414x896": "iPhone XR",
};

/**
 * Waits until the page layout has stabilised (no changes in scrollHeight
 * or visible element count for several consecutive checks).  This catches
 * JS-driven responsive adaptations, late-firing resize observers, and
 * framework re-renders that happen after `networkidle`.
 */
export async function waitForStableLayout(page: Page, maxWaitMs = 5_000): Promise<void> {
  const interval = 300;
  const requiredStable = 3; // 3 consecutive identical snapshots ≈ 900 ms of stability
  let stableCount = 0;
  let prevSnapshot = "";
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      const h = document.documentElement.scrollHeight;
      const w = document.documentElement.scrollWidth;
      // Count DOM elements to detect mutations / hide-show toggling
      const els = document.querySelectorAll("body *:not(script):not(style):not(link)").length;
      // Sample rendered widths of structural elements to detect layout-only
      // responsive changes (flex/grid reflows, visibility toggles) that don't
      // alter total document dimensions or element count.
      const sampleWidths = Array.from(
        document.querySelectorAll("header, nav, main, section, article, aside, footer"),
      ).slice(0, 8).map((el) => Math.round(el.getBoundingClientRect().width)).join(",");
      return `${w}x${h}:${els}:${sampleWidths}`;
    });

    if (snapshot === prevSnapshot) {
      stableCount++;
      if (stableCount >= requiredStable) return;
    } else {
      stableCount = 0;
      prevSnapshot = snapshot;
    }

    await page.waitForTimeout(interval);
  }
}

/**
 * Scrolls the full page top-to-bottom without capturing, then returns to top.
 *
 * Purpose: trigger IntersectionObserver callbacks, lazy-responsive modules,
 * and viewport-dependent JS that only fires when an element enters the viewport.
 * After this pass every element has been "seen", so the subsequent capture
 * scroll renders each section in its final responsive state.
 */
export async function warmUpScroll(page: Page): Promise<void> {
  const MAX_STEPS = 50;

  await page.evaluate(() => window.scrollTo(0, 0));

  const viewportHeight = await page.evaluate(() => window.innerHeight);

  for (let i = 0; i < MAX_STEPS; i++) {
    // Brief pause — enough for IntersectionObserver callbacks and rAF flushes
    await page.waitForTimeout(150);

    const { scrollY, scrollHeight } = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    if (scrollY + viewportHeight >= scrollHeight) break;

    await page.evaluate((vh) => window.scrollBy(0, vh), viewportHeight);
  }

  // Return to top so the capture pass starts from the beginning
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

export async function captureScreenshot(
  url: string,
  website: string,
  outDir = "screenshots",
  resolution: CaptureResolution = "390x844",
): Promise<ScreenshotResult> {
  await fs.mkdir(outDir, { recursive: true });

  const deviceName = RESOLUTION_DEVICE[resolution];
  const browser = await chromium.launch();
  // Override deviceScaleFactor to 1 so screenshots are at logical pixel size.
  // iPhone DPR is 3× by default — at DPR 1 a 390×844 viewport produces a
  // 390×844 px image instead of 1170×2532, keeping file sizes well under
  // Claude's 5 MB per-image limit without sacrificing layout fidelity.
  const context = await browser.newContext({ ...devices[deviceName], deviceScaleFactor: 1 });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      // Last resort: just wait for commit (the server responded)
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
    }
  }

  // Dismiss cookie consent modal if present
  await dismissCookieConsent(page);

  // 1. Wait for initial layout to stabilise
  await waitForStableLayout(page);

  // 2. Scroll the full page once (no capture) to trigger IntersectionObservers
  //    and any viewport-dependent responsive JS on below-the-fold modules
  await warmUpScroll(page);

  // 3. Wait for the responsive re-renders triggered by the warm-up to settle
  await waitForStableLayout(page);

  const filename = `${website}-${resolution}-${Date.now()}.png`;
  const filepath = path.join(outDir, filename);

  // Single-pass: scroll down the page capturing each viewport segment.
  // This triggers lazy-loaded content AND captures screenshots simultaneously,
  // avoiding both Chromium's texture size limit and double-scroll overhead.
  await scrollCaptureAndStitch(page, filepath);

  await browser.close();

  return { path: filepath, url, capturedAt: new Date().toISOString(), resolution };
}

/**
 * Single-pass scroll + capture: scrolls the page one viewport at a time,
 * waits for lazy content to load at each position, takes a screenshot,
 * and stitches all segments into a single full-page image.
 */
async function scrollCaptureAndStitch(page: Page, outPath: string): Promise<void> {
  const MAX_SEGMENTS = 50;

  // Auto-dismiss any dialog (alert/confirm/prompt) that appears during scroll.
  // Some sites show cookie or newsletter popups as JS dialogs mid-page.
  page.on("dialog", async (dialog) => {
    await dialog.dismiss().catch(() => {});
  });

  // Scroll to top first
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const segments: Buffer[] = [];
  const segmentHeights: number[] = [];
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    // Wait for lazy content at this scroll position
    await page.waitForTimeout(300);

    // From the second segment onwards: hide elements with position: fixed or
    // sticky so they don't appear duplicated across every viewport capture
    // (e.g. headers, nav menus, floating buttons). The first segment keeps
    // them so the final stitched image still shows them once, at the top.
    if (i === 1) {
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
          const pos = getComputedStyle(el).position;
          if (pos === "fixed" || pos === "sticky") {
            el.style.setProperty("visibility", "hidden", "important");
          }
        });
      });
    }

    // Capture this viewport — retry once on transient protocol errors
    // (e.g. a modal appeared and was auto-dismissed just before the call).
    let buf: Buffer;
    try {
      buf = await page.screenshot({ timeout: 10_000 });
    } catch {
      await page.waitForTimeout(500);
      buf = await page.screenshot({ timeout: 10_000 });
    }
    const meta = await sharp(buf).metadata();
    const scrollInfo = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    const atBottom = scrollInfo.scrollY + viewportHeight >= scrollInfo.scrollHeight;

    if (i === 0) {
      // First segment: always keep in full
      segments.push(buf);
      segmentHeights.push(meta.height!);
    } else {
      // Subsequent segments: the page may have grown due to lazy loading.
      // We always take a full viewport capture and handle overlap at stitch time
      // by cropping the top portion that was already captured in the previous segment.
      segments.push(buf);
      segmentHeights.push(meta.height!);
    }

    if (atBottom) {
      // Check once more after a short wait — some sites load content with a delay
      await page.waitForTimeout(400);
      const newHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      if (newHeight <= scrollInfo.scrollHeight) break;
    }

    // Scroll down one viewport
    await page.evaluate((vh) => window.scrollBy(0, vh), viewportHeight);
  }

  // If only one segment, save directly
  if (segments.length <= 1) {
    await fs.writeFile(outPath, segments[0]);
    return;
  }

  // Stitch: first segment is full, subsequent segments are full viewports
  // but we need to trim the overlap from the last segment since scrollBy
  // may not land exactly at the bottom.
  const firstMeta = await sharp(segments[0]).metadata();
  const totalWidth = firstMeta.width!;

  // For the last segment, figure out how much overlaps with the previous position
  const finalScrollInfo = await page.evaluate(() => ({
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));

  // Total segments minus last: each covers exactly one viewport in pixels
  const dpr = firstMeta.height! / viewportHeight;
  const fullSegments = segments.length - 1;
  const coveredLogical = fullSegments * viewportHeight;
  const remainingLogical = finalScrollInfo.scrollHeight - coveredLogical;
  const lastSegmentMeta = await sharp(segments[segments.length - 1]).metadata();

  let lastBuf = segments[segments.length - 1];
  let lastHeight = lastSegmentMeta.height!;

  // Trim last segment if it overlaps
  if (remainingLogical > 0 && remainingLogical < viewportHeight) {
    const overlapPx = Math.round((viewportHeight - remainingLogical) * dpr);
    const keepHeight = lastHeight - overlapPx;
    if (keepHeight > 0 && overlapPx > 0 && overlapPx < lastHeight) {
      lastBuf = await sharp(lastBuf)
        .extract({ left: 0, top: overlapPx, width: totalWidth, height: keepHeight })
        .toBuffer();
      lastHeight = keepHeight;
    }
  }

  // Calculate total stitched height
  const totalHeight = segmentHeights.slice(0, -1).reduce((a, b) => a + b, 0) + lastHeight;

  let yOffset = 0;
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    composites.push({ input: segments[i], left: 0, top: yOffset });
    yOffset += segmentHeights[i];
  }
  composites.push({ input: lastBuf, left: 0, top: yOffset });

  await sharp({
    create: { width: totalWidth, height: totalHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
}

const RESOLUTION_DIMENSIONS: Record<CaptureResolution, { width: number; height: number }> = {
  "390x844": { width: 390, height: 844 },
  "414x896": { width: 414, height: 896 },
};

/**
 * Crops a viewport-sized region from a full-page screenshot,
 * centered vertically on the given yPercent position.
 */
export async function cropScreenshot(
  fullPagePath: string,
  yPercent: number,
  resolution: CaptureResolution,
  outPath: string,
): Promise<string> {
  const { width, height } = RESOLUTION_DIMENSIONS[resolution];
  const meta = await sharp(fullPagePath).metadata();
  const imgWidth = meta.width ?? width;
  const imgHeight = meta.height ?? height;

  // Clamp yPercent to [0, 100]
  const safeY = Math.max(0, Math.min(100, isFinite(yPercent) ? yPercent : 50));

  // With DPR=1 the stitched image is at logical resolution, so dpr≈1
  const cropH = Math.min(height, imgHeight);

  // Center the crop vertically on safeY
  const centerY = Math.round((safeY / 100) * imgHeight);
  let top = centerY - Math.round(cropH / 2);
  top = Math.max(0, Math.min(top, Math.max(0, imgHeight - cropH)));

  const finalHeight = Math.min(cropH, imgHeight - top);

  if (finalHeight <= 0 || imgWidth <= 0) {
    // Fallback: copy source as-is
    await fs.copyFile(fullPagePath, outPath);
    return outPath;
  }

  // Use toBuffer() + writeFile() to avoid sharp path issues on Windows
  const buf = await sharp(fullPagePath)
    .extract({ left: 0, top, width: imgWidth, height: finalHeight })
    .png()
    .toBuffer();

  await fs.writeFile(outPath, buf);
  return outPath;
}

/**
 * Claude limits: 8000px per dimension, 5MB per image.
 * We target 1200px wide (enough for readability) and JPEG quality 82
 * so tiles stay well under 5MB even on full-page captures.
 */
// Tile each screenshot into chunks of at most this many pixels tall.
// 3000px at 800px wide JPEG q72 ≈ 0.5–2 MB — well under Claude's 5 MB limit.
const TILE_MAX_HEIGHT_PX = 3000;
const CLAUDE_MAX_BYTES   = 4_800_000; // target 4.8 MB to have headroom

/**
 * Compress a raw PNG/Buffer to JPEG, reducing size until it fits
 * within Claude's 5 MB per-image limit.
 */
async function compressTile(raw: Buffer): Promise<Buffer> {
  const attempts: Array<{ width: number; quality: number }> = [
    { width: 800, quality: 72 },
    { width: 700, quality: 68 },
    { width: 600, quality: 63 },
    { width: 500, quality: 58 },
    { width: 400, quality: 55 },
  ];

  for (const { width, quality } of attempts) {
    const buf = await sharp(raw)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (buf.length < CLAUDE_MAX_BYTES) return buf;
  }

  // Absolute last resort
  return sharp(raw)
    .resize({ width: 350, withoutEnlargement: true })
    .jpeg({ quality: 50 })
    .toBuffer();
}

/**
 * Splits a full-page screenshot into vertical tiles that each fit
 * within Claude's limits (8000px height, 5MB). Each tile is resized
 * and JPEG-compressed before being returned.
 */
export async function splitIntoTiles(
  fullPagePath: string,
): Promise<{ buffer: Buffer; mediaType: "image/jpeg"; tileIndex: number; totalTiles: number; startYPercent: number; endYPercent: number }[]> {
  const meta = await sharp(fullPagePath).metadata();
  const imgWidth = meta.width ?? 390;
  const imgHeight = meta.height ?? 844;

  type Tile = { buffer: Buffer; mediaType: "image/jpeg"; tileIndex: number; totalTiles: number; startYPercent: number; endYPercent: number };
  const tiles: Tile[] = [];

  if (imgHeight <= TILE_MAX_HEIGHT_PX) {
    const raw = await fs.readFile(fullPagePath);
    const buffer = await compressTile(raw);
    return [{ buffer, mediaType: "image/jpeg", tileIndex: 0, totalTiles: 1, startYPercent: 0, endYPercent: 100 }];
  }

  const overlap = Math.round(TILE_MAX_HEIGHT_PX * 0.05); // 5% overlap at boundaries
  const step = TILE_MAX_HEIGHT_PX - overlap;
  let top = 0;
  let index = 0;

  while (top < imgHeight) {
    const currentHeight = Math.min(TILE_MAX_HEIGHT_PX, imgHeight - top);
    if (currentHeight <= 0) break;

    const raw = await sharp(fullPagePath)
      .extract({ left: 0, top, width: imgWidth, height: currentHeight })
      .toBuffer();

    const buffer = await compressTile(raw);
    const startYPercent = Math.round((top / imgHeight) * 100);
    const endYPercent = Math.round(((top + currentHeight) / imgHeight) * 100);

    tiles.push({ buffer, mediaType: "image/jpeg", tileIndex: index, totalTiles: 0, startYPercent, endYPercent });

    top += step;
    index++;
  }

  for (const tile of tiles) tile.totalTiles = tiles.length;

  return tiles;
}

// Allow direct CLI invocation: `tsx scripts/screenshot.ts <url> <website>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, website] = process.argv.slice(2);
  if (!url || !website) {
    console.error("Usage: tsx scripts/screenshot.ts <url> <website>");
    process.exit(1);
  }
  captureScreenshot(url, website).then((r) => console.log(r.path));
}
