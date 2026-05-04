import { chromium, devices, type Page, type ConsoleMessage, type Request, type Locator } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { CaptureResolution, RESOLUTION_DEVICE, dismissCookieConsent, waitForStableLayout, warmUpScroll } from "./screenshot";

// Loaded once at module init — plain JS so esbuild never transforms it.
// Avoids the __name() ReferenceError that occurs when tsx serialises TS arrow functions for page.evaluate.
const STRUCTURAL_EVAL_FN: string = fs.readFileSync(
  path.join(process.cwd(), "scripts", "structural-eval.js"),
  "utf8",
);

const AXE_PATH: string = path.join(process.cwd(), "node_modules", "axe-core", "axe.js");

/** Regions to skip during analysis — used to avoid repeating cross-URL issues
 *  that live in shared `<header>` / `<footer>` blocks. */
export interface ExcludeOptions {
  header: boolean;
  footer: boolean;
}

const DEFAULT_EXCLUDE: ExcludeOptions = { header: false, footer: false };

/** CSS selector matching any excluded region (empty string when nothing excluded). */
function excludeSelector(opts: ExcludeOptions): string {
  const parts: string[] = [];
  if (opts.header) parts.push("header");
  if (opts.footer) parts.push("footer");
  return parts.join(", ");
}

/** True when the element sits inside an excluded `<header>` / `<footer>` region. */
async function isInsideExcluded(el: Locator, excludeSel: string): Promise<boolean> {
  if (!excludeSel) return false;
  try {
    return await el.evaluate((node, sel) => !!(node as Element).closest(sel), excludeSel);
  } catch {
    return false;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DomSnapshot {
  images: { src: string; alt: string | null }[];
  buttons: { text: string; type: string | null }[];
  links: { href: string; text: string }[];
  inputs: { type: string; name: string | null; label: string | null; placeholder: string | null }[];
}

export interface FunctionalFinding {
  type: "broken-link" | "js-error" | "failed-resource" | "missing-alt" | "small-touch-target" | "empty-link" | "missing-label";
  detail: string;
  selector?: string;
  /** Vertical percentage (0-100) within the full page */
  yPercent?: number;
}

export interface InteractionFinding {
  type:
    | "menu-aria-expanded-missing"
    | "menu-state-unchanged"
    | "form-required-no-error-description"
    | "modal-focus-not-moved"
    | "modal-focus-not-returned";
  detail: string;
  selector: string;
  yPercent: number;
}

export interface FunctionalReport {
  url: string;
  resolution: CaptureResolution;
  loadTimeMs: number;
  jsErrors: string[];
  failedResources: { url: string; status: number }[];
  brokenLinks: { href: string; status: number; text: string }[];
  emptyLinks: { selector: string; yPercent: number }[];
  emptyButtons: { selector: string; yPercent: number }[];
  missingAltImages: { src: string; yPercent: number }[];
  smallTouchTargets: { selector: string; size: string; yPercent: number }[];
  missingLabels: { selector: string; yPercent: number }[];
  /** Elements that receive keyboard focus but show no visible focus indicator. */
  noFocusIndicator: { selector: string; yPercent: number }[];
  /** First element where Tab navigation got stuck (same element 3+ times). */
  focusTrap: { selector: string; yPercent: number } | null;
  /** Results of interactive component tests (menu, form, modal). */
  interactionFindings: InteractionFinding[];
}

export interface AxeViolationNode {
  target: string[];
  failureSummary?: string;
}

export interface AxeViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor" | null;
  help: string;
  description: string;
  helpUrl: string;
  nodes: AxeViolationNode[];
  /** Vertical percentage (0-100) of the first affected node within the full page */
  yPercent: number;
}

export interface AxeReport {
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
  inapplicable: number;
}

/** Objective structural/semantic facts extracted from the rendered DOM.
 *  Fed to the LLM as pre-counted data so it doesn't have to parse HTML itself
 *  (which caused hallucinated counts, e.g. "multiple h1" when there was one). */
export interface StructuralFindings {
  document: {
    lang: string | null;
    langValid: boolean;
    hasTitle: boolean;
    ariaHiddenBody: boolean;
    duplicateIds: string[];
  };
  headings: {
    h1Count: number;
    h1HiddenCount: number;
    h1Samples: string[];
    hierarchyJumps: { from: string; to: string; nextText: string }[];
  };
  landmarks: {
    mainCount: number;
    navCount: number;
    navsWithoutLabel: number;
    navsWithoutLabelSamples: string[];
    asideInsideMain: number;
  };
  nonSemanticInteractive: {
    count: number;
    samples: string[];
  };
  anchorsMisused: {
    hashOnly: number;
    hashOnlySamples: string[];
    withoutHref: number;
    withoutHrefSamples: string[];
  };
  tabindex: {
    positive: number;
    positiveSamples: string[];
  };
  forms: {
    inputsWithoutLabel: number;
    inputsWithoutLabelSamples: string[];
    radioCheckboxGroupsWithoutFieldset: number;
  };
  tables: {
    dataTablesWithoutHeaders: number;
  };
}

/** Wraps the unchanged FunctionalReport together with the new axe results. */
export interface FunctionalAuditResult {
  report: FunctionalReport;
  axe: AxeReport;
  structural: StructuralFindings;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getYPercent(_page: Page, element: ReturnType<Page["locator"]>): Promise<number> {
  try {
    // boundingBox() returns viewport-relative coords; after scrolling we must
    // add window.scrollY to get the absolute position within the document.
    // Computing everything in-page avoids that round-trip mismatch entirely.
    const y = await element.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const pageHeight = document.documentElement.scrollHeight || 1;
      const absoluteY = rect.top + window.scrollY + rect.height / 2;
      return Math.round((absoluteY / pageHeight) * 100);
    });
    return Math.max(0, Math.min(100, y));
  } catch {
    return 0;
  }
}

// ─── Interaction tests ────────────────────────────────────────────────────────

/**
 * Runs three interaction tests and returns any findings:
 *  1. Mobile menu toggle — checks aria-expanded presence and state change on click.
 *  2. Form required fields — checks that each required field has an associated
 *     error-description container (aria-describedby) so errors are announced.
 *  3. Modal focus management — clicks triggers with aria-haspopup="dialog",
 *     verifies focus moves inside, presses Escape and checks focus returns.
 *
 * Every test is wrapped in try/catch so a single failure never aborts the audit.
 */
async function runInteractionTests(page: Page, excludeSel: string): Promise<InteractionFinding[]> {
  const findings: InteractionFinding[] = [];

  // ── 1. Mobile navigation menu toggle ──────────────────────────────────────
  // Skipped entirely when <header> is excluded — mobile menus are almost
  // always inside the site header and the user has opted out of that region.
  try {
    const menuBtn = page
      .locator(
        'button[aria-expanded], [role="button"][aria-expanded],' +
        '[class*="hamburger"], [class*="burger"i], [class*="nav-toggle"i],' +
        '[class*="menu-toggle"i], [class*="menu-btn"i]',
      )
      .first();

    if (
      (await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false)) &&
      !(await isInsideExcluded(menuBtn, excludeSel))
    ) {
      const selector = await menuBtn.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const cls = el.className?.toString().trim().split(/\s+/)[0] ?? "";
        return cls ? `${tag}.${cls}` : tag;
      });
      const yPercent = await getYPercent(page, menuBtn);
      const hasAriaExpanded = (await menuBtn.getAttribute("aria-expanded")) !== null;

      if (!hasAriaExpanded) {
        findings.push({
          type: "menu-aria-expanded-missing",
          detail: `El botón de menú '${selector}' no tiene el atributo aria-expanded; los lectores de pantalla no conocen su estado (abierto/cerrado).`,
          selector,
          yPercent,
        });
      } else {
        const before = await menuBtn.getAttribute("aria-expanded");
        await menuBtn.click();
        await page.waitForTimeout(500);
        const after = await menuBtn.getAttribute("aria-expanded");

        if (before === after) {
          findings.push({
            type: "menu-state-unchanged",
            detail: `El botón de menú '${selector}' tiene aria-expanded pero su valor no cambia al hacer clic; el estado del menú no se comunica correctamente.`,
            selector,
            yPercent,
          });
        }
        // Restore: click again to close
        await menuBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  } catch { /* no menu found or interaction failed — skip */ }

  // ── 2. Form required fields: error-description association ────────────────
  try {
    const forms = await page.locator("form").all();
    for (const form of forms.slice(0, 3)) {
      if (!(await form.isVisible().catch(() => false))) continue;
      if (await isInsideExcluded(form, excludeSel)) continue;

      const requiredFields = await form
        .locator("input:not([type='hidden']):not([type='submit']), select, textarea")
        .all();

      for (const field of requiredFields.slice(0, 10)) {
        const isRequired =
          (await field.getAttribute("required")) !== null ||
          (await field.getAttribute("aria-required")) === "true";
        if (!isRequired) continue;

        const describedBy = await field.getAttribute("aria-describedby");
        const hasErrorContainer = describedBy
          ? (await page.locator(`#${CSS.escape(describedBy)}`).count()) > 0
          : false;

        if (!hasErrorContainer) {
          const name =
            (await field.getAttribute("name")) ||
            (await field.getAttribute("id")) ||
            (await field.getAttribute("type")) ||
            "input";
          const formSelector = await form.evaluate((el) => {
            const id = el.id ? `#${el.id}` : "";
            const cls = el.className?.toString().trim().split(/\s+/)[0] ?? "";
            return `form${id || (cls ? "." + cls : "")}`;
          });
          const yPercent = await getYPercent(page, field);
          findings.push({
            type: "form-required-no-error-description",
            detail: `El campo requerido '${name}' en '${formSelector}' no tiene aria-describedby apuntando a un contenedor de error; los mensajes de validación no serán anunciados por lectores de pantalla (WCAG 3.3.1).`,
            selector: `[name="${name}"]`,
            yPercent,
          });
          break; // one finding per form is enough
        }
      }
    }
  } catch { /* skip */ }

  // ── 3. Modal / dialog focus management ────────────────────────────────────
  try {
    const triggers = await page
      .locator('[aria-haspopup="dialog"], [data-bs-toggle="modal"], [data-toggle="modal"]')
      .all();

    for (const trigger of triggers.slice(0, 2)) {
      if (!(await trigger.isVisible().catch(() => false))) continue;
      if (await isInsideExcluded(trigger, excludeSel)) continue;

      const selector = await trigger.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className?.toString().trim().split(/\s+/)[0] ?? "";
        return `${tag}${id || (cls ? "." + cls : "")}`;
      });
      const yPercent = await getYPercent(page, trigger);

      await trigger.click();
      await page.waitForTimeout(600);

      const dialog = page.locator('[role="dialog"], dialog').first();
      if (!(await dialog.isVisible({ timeout: 1_000 }).catch(() => false))) continue;

      // Check focus moved inside the dialog
      const focusInDialog = await page.evaluate(() => {
        const focused = document.activeElement;
        const dlg = document.querySelector('[role="dialog"], dialog');
        return dlg ? dlg.contains(focused) : false;
      });

      if (!focusInDialog) {
        findings.push({
          type: "modal-focus-not-moved",
          detail: `Al abrir el diálogo activado por '${selector}', el foco no se desplaza al interior del modal (WCAG 2.4.3).`,
          selector,
          yPercent,
        });
      }

      // Close with Escape and check focus returns to trigger
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);

      const focusReturned = await page.evaluate((sel) => {
        const focused = document.activeElement as Element | null;
        if (!focused) return false;
        try { return focused.matches(sel) || focused.closest(sel) !== null; } catch { return false; }
      }, selector);

      if (!focusReturned) {
        findings.push({
          type: "modal-focus-not-returned",
          detail: `Al cerrar el diálogo, el foco no regresa al elemento '${selector}' que lo abrió (WCAG 2.4.3).`,
          selector,
          yPercent,
        });
      }

      break; // one modal test per audit run
    }
  } catch { /* skip */ }

  return findings;
}

// ─── Keyboard navigation audit ───────────────────────────────────────────────

/**
 * Tabs through the page (up to MAX_TABS presses) and checks each focused element for:
 * - a visible focus indicator (outline-width > 0 OR box-shadow ≠ none)
 * - focus traps (same element focused 3+ consecutive times)
 *
 * Returns at most 8 elements without focus indicator and the first trap found.
 */
async function checkKeyboardNav(page: Page, excludeSel: string): Promise<{
  noFocusIndicator: { selector: string; yPercent: number }[];
  focusTrap: { selector: string; yPercent: number } | null;
}> {
  const MAX_TABS = 35;
  const noFocusIndicator: { selector: string; yPercent: number }[] = [];
  let focusTrap: { selector: string; yPercent: number } | null = null;

  // Reset: scroll to top and remove any existing focus
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.waitForTimeout(200);

  let prevSelector = "";
  let sameCount = 0;

  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);

    const result = await page.evaluate((exSel: string): {
      selector: string;
      hasFocusIndicator: boolean;
      yPercent: number;
    } | null => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const tag = el.tagName.toUpperCase();
      // Skip non-interactive containers that shouldn't hold focus
      if (tag === "BODY" || tag === "HTML" || tag === "IFRAME") return null;
      // Skip elements inside excluded regions (header/footer)
      if (exSel && el.closest(exSel)) return null;

      const style = window.getComputedStyle(el);
      const outlineWidth = parseFloat(style.outlineWidth) || 0;
      const hasOutline = outlineWidth > 0 && style.outlineStyle !== "none";
      const hasBoxShadow = style.boxShadow !== "none";

      // Build a short readable selector
      const tagLower = tag.toLowerCase();
      const id = el.id ? `#${el.id.slice(0, 30)}` : "";
      const cls =
        el.className && typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\s+/)[0]
          : "";
      const selector = `${tagLower}${id || cls}`.slice(0, 60);

      const box = el.getBoundingClientRect();
      const pageHeight = document.documentElement.scrollHeight;
      const yPercent =
        pageHeight > 0
          ? Math.round(((window.scrollY + box.top + box.height / 2) / pageHeight) * 100)
          : 50;

      return { selector, hasFocusIndicator: hasOutline || hasBoxShadow, yPercent };
    }, excludeSel);

    if (!result) continue;

    // Detect focus trap: same selector 3+ times in a row
    if (result.selector === prevSelector) {
      sameCount++;
      if (sameCount >= 3 && !focusTrap) {
        focusTrap = { selector: result.selector, yPercent: result.yPercent };
        break;
      }
    } else {
      sameCount = 0;
    }
    prevSelector = result.selector;

    // Collect elements without visible focus indicator (deduplicated, max 8)
    if (!result.hasFocusIndicator && noFocusIndicator.length < 8) {
      if (!noFocusIndicator.some((x) => x.selector === result.selector)) {
        noFocusIndicator.push({ selector: result.selector, yPercent: result.yPercent });
      }
    }
  }

  return { noFocusIndicator, focusTrap };
}

// ─── Axe-core runner ─────────────────────────────────────────────────────────

/**
 * Injects axe-core into the page and runs a full accessibility analysis.
 * Returns a compact AxeReport — violations in full, other rule counts only.
 * When `excludeSel` is provided, axe skips any element inside those regions
 * (e.g. "header, footer" to avoid reporting issues in shared chrome).
 */
async function runAxe(page: Page, excludeSel: string): Promise<AxeReport> {
  await page.addScriptTag({ path: AXE_PATH });

  const raw = await page.evaluate(async (exSel: string) => {
    // axe is now on window — run with mobile-relevant rules
    const excludeList = exSel ? exSel.split(",").map((s) => [s.trim()]) : [];
    const runOpts: Record<string, unknown> = {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] },
    };
    if (excludeList.length > 0) runOpts.exclude = excludeList;
    const results = await (window as unknown as { axe: { run: (opts?: unknown) => Promise<unknown> } }).axe.run(runOpts);
    const typed = results as {
      violations: Array<{ nodes: Array<{ target: string[] }> }>;
      passes: unknown[];
      incomplete: unknown[];
      inapplicable: unknown[];
    };

    // Enrich each violation with the vertical position of its first affected node.
    // This lets the crop helper center the screenshot on the actual problem area
    // instead of defaulting to the middle of the page.
    const pageHeight = document.documentElement.scrollHeight || 1;
    const violations = typed.violations.map((v) => {
      let yPercent = 50;
      const firstTarget = v.nodes[0]?.target?.[0];
      if (typeof firstTarget === "string") {
        try {
          const el = document.querySelector(firstTarget);
          if (el) {
            const rect = el.getBoundingClientRect();
            const absoluteY = rect.top + window.scrollY + rect.height / 2;
            yPercent = Math.max(0, Math.min(100, Math.round((absoluteY / pageHeight) * 100)));
          }
        } catch {
          // Invalid selector — keep default 50
        }
      }
      return { ...v, yPercent };
    });

    return { ...typed, violations };
  }, excludeSel);

  return {
    violations: raw.violations as unknown as AxeViolation[],
    passes: raw.passes.length,
    incomplete: raw.incomplete.length,
    inapplicable: raw.inapplicable.length,
  };
}

// ─── DOM snapshot ─────────────────────────────────────────────────────────────

/**
 * Extracts basic DOM elements from a page in a single browser-side evaluate()
 * call — lightweight, no per-element round-trips.
 */
export async function extractDomSnapshot(
  url: string,
  resolution: CaptureResolution = "390x844",
): Promise<DomSnapshot> {
  const deviceName = RESOLUTION_DEVICE[resolution];
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices[deviceName], deviceScaleFactor: 1 });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
    }
  }

  await dismissCookieConsent(page);
  await waitForStableLayout(page);

  const snapshot = await page.evaluate((): DomSnapshot => {
    // Images
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("img")).map((img) => ({
      src: img.src || img.getAttribute("src") || "",
      alt: img.hasAttribute("alt") ? img.alt : null,
    }));

    // Buttons (button elements + role=button, trimmed text, max 80 chars)
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("button, [role='button']"),
    ).map((btn) => ({
      text: (btn.textContent ?? "").trim().slice(0, 80),
      type: btn instanceof HTMLButtonElement ? (btn.type || null) : null,
    }));

    // Links (anchor elements with href, text or aria-label)
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => ({
      href: a.href,
      text: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 120),
    }));

    // Form inputs with their associated label
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input:not([type='hidden']), select, textarea",
      ),
    ).map((el) => {
      let label: string | null = null;
      const id = el.id;
      if (id) {
        const lbl = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        label = lbl ? (lbl.textContent ?? "").trim().slice(0, 80) : null;
      }
      if (!label) label = el.getAttribute("aria-label")?.trim().slice(0, 80) ?? null;
      return {
        type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
        name: el.name || null,
        label,
        placeholder: (el as HTMLInputElement).placeholder?.trim().slice(0, 80) || null,
      };
    });

    return { images, buttons, links, inputs };
  });

  await browser.close();
  return snapshot;
}

// ─── Main audit function ─────────────────────────────────────────────────────

export async function runFunctionalAudit(
  url: string,
  resolution: CaptureResolution = "390x844",
  exclude: ExcludeOptions = DEFAULT_EXCLUDE,
): Promise<FunctionalAuditResult> {
  const excludeSel = excludeSelector(exclude);
  const deviceName = RESOLUTION_DEVICE[resolution];
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices[deviceName], deviceScaleFactor: 1 });
  const page = await context.newPage();

  // Auto-dismiss JS dialogs so they don't block Playwright operations
  page.on("dialog", async (dialog) => { await dialog.dismiss().catch(() => {}); });

  // Collect JS errors
  const jsErrors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") jsErrors.push(msg.text());
  });
  page.on("pageerror", (err) => jsErrors.push(err.message));

  // Collect failed network resources
  const failedResources: { url: string; status: number }[] = [];
  page.on("requestfailed", (req: Request) => {
    failedResources.push({ url: req.url(), status: 0 });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      failedResources.push({ url: res.url(), status: res.status() });
    }
  });

  // Navigate and measure load time
  const startTime = Date.now();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
    }
  }
  const loadTimeMs = Date.now() - startTime;

  // Dismiss cookies before inspecting
  await dismissCookieConsent(page);

  // 1. Wait for initial layout to stabilise
  await waitForStableLayout(page);

  // 2. Scroll full page to trigger IntersectionObserver-based responsive modules
  await warmUpScroll(page);

  // 3. Wait for re-renders triggered by the warm-up to settle
  await waitForStableLayout(page);

  // ── Check broken links ────────────────────────────────────────────────────
  // Limit to first 20 unique hrefs to keep audit fast (HEAD timeout 3 s each → max ~60 s)
  const links = await page.locator("a[href]").all();
  const seenHrefs = new Set<string>();
  const brokenLinks: FunctionalReport["brokenLinks"] = [];
  const MAX_LINKS_TO_CHECK = 20;

  for (const link of links) {
    if (seenHrefs.size >= MAX_LINKS_TO_CHECK) break;
    try {
      if (await isInsideExcluded(link, excludeSel)) continue;
      const href = await link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

      const absoluteUrl = new URL(href, url).toString();
      if (seenHrefs.has(absoluteUrl)) continue;
      seenHrefs.add(absoluteUrl);

      const res = await page.request.head(absoluteUrl, { timeout: 3_000 }).catch(() => null);
      if (res && res.status() >= 400) {
        const text = (await link.textContent())?.trim() || "";
        brokenLinks.push({ href: absoluteUrl, status: res.status(), text: text.slice(0, 80) });
      }
    } catch {
      // skip unreachable
    }
    if (brokenLinks.length >= 5) break;
  }

  // ── Check empty links (no text, no aria-label, no title, no img with alt) ──
  const emptyLinks: FunctionalReport["emptyLinks"] = [];
  for (const link of links) {
    try {
      if (await isInsideExcluded(link, excludeSel)) continue;
      const text = (await link.textContent())?.trim() || "";
      const ariaLabel = await link.getAttribute("aria-label");
      const ariaLabelledBy = await link.getAttribute("aria-labelledby");
      const title = await link.getAttribute("title");
      const img = await link.locator("img[alt]:not([alt=''])").count();
      if (!text && !ariaLabel && !ariaLabelledBy && !title && img === 0) {
        const yPercent = await getYPercent(page, link);
        const href = (await link.getAttribute("href")) || "";
        emptyLinks.push({ selector: `a[href="${href.slice(0, 60)}"]`, yPercent });
      }
    } catch { /* skip */ }
    if (emptyLinks.length >= 10) break;
  }

  // ── Check buttons without accessible name ────────────────────────────────
  const emptyButtons: FunctionalReport["emptyButtons"] = [];
  const buttons = await page.locator("button, [role='button']").all();
  for (const btn of buttons) {
    try {
      if (!(await btn.isVisible())) continue;
      if (await isInsideExcluded(btn, excludeSel)) continue;
      const text = (await btn.textContent())?.trim() || "";
      const ariaLabel = await btn.getAttribute("aria-label");
      const ariaLabelledBy = await btn.getAttribute("aria-labelledby");
      const title = await btn.getAttribute("title");
      const img = await btn.locator("img[alt]:not([alt=''])").count();
      if (!text && !ariaLabel && !ariaLabelledBy && !title && img === 0) {
        const tag = await btn.evaluate((e) => {
          const t = e.tagName.toLowerCase();
          const cls = e.className?.toString().split(" ")[0] || "";
          return cls ? `${t}.${cls}` : t;
        });
        const yPercent = await getYPercent(page, btn);
        emptyButtons.push({ selector: tag, yPercent });
      }
    } catch { /* skip */ }
    if (emptyButtons.length >= 10) break;
  }

  // ── Check images without alt (skip explicitly decorative ones) ───────────
  const missingAltImages: FunctionalReport["missingAltImages"] = [];
  // Only flag images that have NO alt attribute. alt="" means the image is
  // intentionally decorative (WCAG technique H67) and must not be reported.
  const images = await page.locator("img:not([alt])").all();
  for (const img of images.slice(0, 10)) {
    try {
      if (await isInsideExcluded(img, excludeSel)) continue;
      // Images marked as decorative via role or aria-hidden are intentional —
      // empty alt on these is correct per WCAG and should not be flagged.
      const role = await img.getAttribute("role");
      const ariaHidden = await img.getAttribute("aria-hidden");
      if (role === "presentation" || ariaHidden === "true") continue;

      const src = (await img.getAttribute("src")) || "unknown";
      const yPercent = await getYPercent(page, img);
      missingAltImages.push({ src: src.slice(0, 100), yPercent });
    } catch { /* skip */ }
  }

  // ── Check small touch targets (< 44x44 CSS px per WCAG 2.5.8) ────────────
  const smallTouchTargets: FunctionalReport["smallTouchTargets"] = [];
  const interactiveEls = await page.locator("a, button, input, select, textarea, [role='button'], [role='link']").all();
  for (const el of interactiveEls) {
    try {
      if (!(await el.isVisible())) continue;
      if (await isInsideExcluded(el, excludeSel)) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      if (box.width < 44 || box.height < 44) {
        const tag = await el.evaluate((e) => {
          const t = e.tagName.toLowerCase();
          const cls = e.className?.toString().split(" ")[0] || "";
          return cls ? `${t}.${cls}` : t;
        });
        const yPercent = await getYPercent(page, el);
        smallTouchTargets.push({
          selector: tag,
          size: `${Math.round(box.width)}x${Math.round(box.height)}`,
          yPercent,
        });
      }
    } catch { /* skip */ }
    if (smallTouchTargets.length >= 15) break;
  }

  // ── Check form inputs without labels ──────────────────────────────────────
  const missingLabels: FunctionalReport["missingLabels"] = [];
  const inputs = await page.locator("input:not([type='hidden']), select, textarea").all();
  for (const input of inputs) {
    try {
      if (!(await input.isVisible())) continue;
      if (await isInsideExcluded(input, excludeSel)) continue;
      const id = await input.getAttribute("id");
      const ariaLabel = await input.getAttribute("aria-label");
      const ariaLabelledBy = await input.getAttribute("aria-labelledby");
      const placeholder = await input.getAttribute("placeholder");
      const title = await input.getAttribute("title");

      let hasLabel = !!(ariaLabel || ariaLabelledBy || title);
      if (!hasLabel && id) {
        hasLabel = (await page.locator(`label[for="${id}"]`).count()) > 0;
      }
      if (!hasLabel && !placeholder) {
        const name = (await input.getAttribute("name")) || (await input.getAttribute("type")) || "input";
        const yPercent = await getYPercent(page, input);
        missingLabels.push({ selector: `input[name="${name}"]`, yPercent });
      }
    } catch { /* skip */ }
    if (missingLabels.length >= 10) break;
  }

  // ── Interaction tests ─────────────────────────────────────────────────────
  // Click-based tests for menu toggles, form validation UX, and modal focus.
  const interactionFindings = await runInteractionTests(page, excludeSel);

  // ── Keyboard navigation audit ─────────────────────────────────────────────
  // Tab through the page to detect missing focus indicators and focus traps.
  const { noFocusIndicator, focusTrap } = await checkKeyboardNav(page, excludeSel);

  // ── Axe-core accessibility analysis ──────────────────────────────────────
  // Runs after all Playwright checks so the page state is consistent.
  const axe = await runAxe(page, excludeSel);

  // ── Structural findings extraction ────────────────────────────────────────
  // Counts and small outerHTML samples of structural/semantic issues, computed
  // over the rendered DOM (not raw HTML) to avoid LLM hallucination when asked
  // to "count h1s" over a large source file with SSR artifacts.
  const structural = await extractStructuralFindings(page, excludeSel);

  await browser.close();

  return {
    report: {
      url,
      resolution,
      loadTimeMs,
      jsErrors,
      failedResources,
      brokenLinks,
      emptyLinks,
      emptyButtons,
      missingAltImages,
      smallTouchTargets,
      missingLabels,
      noFocusIndicator,
      focusTrap,
      interactionFindings,
    },
    axe,
    structural,
  };
}

// ─── Structural findings ─────────────────────────────────────────────────────

async function extractStructuralFindings(page: Page, excludeSel: string): Promise<StructuralFindings> {
  return page.evaluate(`(${STRUCTURAL_EVAL_FN})(${JSON.stringify(excludeSel)})`) as Promise<StructuralFindings>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _extractStructuralFindingsOriginal(page: Page, excludeSel: string): Promise<StructuralFindings> {
  // DEAD CODE — kept for reference only. The live version above reads structural-eval.js
  // as a plain-JS string to avoid tsx/esbuild adding __name() wrappers.
  return page.evaluate((exSel: string): StructuralFindings => {
    const inExcluded = (el: Element): boolean => (exSel ? !!el.closest(exSel) : false);
    // ─── Document-level checks ──────────────────────────────────────────────
    const lang = document.documentElement.getAttribute("lang");
    const langValid = !!lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang);
    const hasTitle = !!document.title?.trim();
    const ariaHiddenBody = document.body?.getAttribute("aria-hidden") === "true";

    const idCounts: Record<string, number> = {};
    const allWithId = document.querySelectorAll<HTMLElement>("[id]");
    for (let i = 0; i < allWithId.length; i++) {
      if (inExcluded(allWithId[i])) continue;
      const id = allWithId[i].id;
      if (id) idCounts[id] = (idCounts[id] ?? 0) + 1;
    }
    const duplicateIds: string[] = [];
    for (const id in idCounts) {
      if (idCounts[id] > 1) duplicateIds.push(id);
      if (duplicateIds.length >= 5) break;
    }

    // ─── Heading hierarchy ──────────────────────────────────────────────────
    const allHeadings = Array.from(
      document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    ).filter((el) => !inExcluded(el));
    const h1Samples: string[] = [];
    let h1Count = 0;
    let h1HiddenCount = 0;
    for (let i = 0; i < allHeadings.length; i++) {
      if (allHeadings[i].tagName === "H1") {
        h1Count++;
        const cs = window.getComputedStyle(allHeadings[i]);
        if (cs.display === "none" || cs.visibility === "hidden") h1HiddenCount++;
        if (h1Samples.length < 3) {
          h1Samples.push((allHeadings[i].textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80));
        }
      }
    }

    const hierarchyJumps: { from: string; to: string; nextText: string }[] = [];
    for (let i = 1; i < allHeadings.length; i++) {
      const prev = parseInt(allHeadings[i - 1].tagName[1], 10);
      const curr = parseInt(allHeadings[i].tagName[1], 10);
      if (curr > prev + 1) {
        hierarchyJumps.push({
          from: allHeadings[i - 1].tagName.toLowerCase(),
          to: allHeadings[i].tagName.toLowerCase(),
          nextText: (allHeadings[i].textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
        });
      }
      if (hierarchyJumps.length >= 5) break;
    }

    // ─── Landmarks ──────────────────────────────────────────────────────────
    const mainCount = Array.from(
      document.querySelectorAll("main, [role='main']"),
    ).filter((el) => !inExcluded(el)).length;
    const navs = Array.from(
      document.querySelectorAll<HTMLElement>("nav, [role='navigation']"),
    ).filter((el) => !inExcluded(el));
    const navsWithoutLabelSamples: string[] = [];
    let navsWithoutLabel = 0;
    for (let i = 0; i < navs.length; i++) {
      const n = navs[i];
      if (!n.getAttribute("aria-label") && !n.getAttribute("aria-labelledby")) {
        navsWithoutLabel++;
        if (navsWithoutLabelSamples.length < 3) {
          navsWithoutLabelSamples.push(n.outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
        }
      }
    }
    const asideInsideMain = Array.from(
      document.querySelectorAll("main aside, [role='main'] aside"),
    ).filter((el) => !inExcluded(el)).length;

    // ─── Non-semantic interactive (div/span used as buttons) ────────────────
    const interactiveDivs = Array.from(
      document.querySelectorAll<HTMLElement>(
        "div[role='button'], span[role='button'], div[onclick], span[onclick]",
      ),
    ).filter((el) => !inExcluded(el));
    const nonSemanticSamples: string[] = [];
    for (let i = 0; i < Math.min(3, interactiveDivs.length); i++) {
      nonSemanticSamples.push(interactiveDivs[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
    }

    // ─── Anchors misused ────────────────────────────────────────────────────
    const hashLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href="#"], a[href=""]'),
    ).filter((el) => !inExcluded(el));
    const hashOnlySamples: string[] = [];
    for (let i = 0; i < Math.min(3, hashLinks.length); i++) {
      hashOnlySamples.push(hashLinks[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
    }
    const withoutHrefElements = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a:not([href])"),
    ).filter((el) => !inExcluded(el));
    const withoutHref = withoutHrefElements.length;
    const withoutHrefSamples: string[] = [];
    for (let i = 0; i < Math.min(3, withoutHrefElements.length); i++) {
      withoutHrefSamples.push(withoutHrefElements[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
    }

    // ─── Positive tabindex ──────────────────────────────────────────────────
    const allTabindex = Array.from(
      document.querySelectorAll<HTMLElement>("[tabindex]"),
    ).filter((el) => !inExcluded(el));
    const tabindexPositiveEls: HTMLElement[] = [];
    for (let i = 0; i < allTabindex.length; i++) {
      const v = parseInt(allTabindex[i].getAttribute("tabindex") ?? "", 10);
      if (!isNaN(v) && v > 0) tabindexPositiveEls.push(allTabindex[i]);
    }
    const tabindexPositiveSamples: string[] = [];
    for (let i = 0; i < Math.min(3, tabindexPositiveEls.length); i++) {
      tabindexPositiveSamples.push(tabindexPositiveEls[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
    }

    // ─── Forms: inputs without label ────────────────────────────────────────
    const formInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), select, textarea",
      ),
    ).filter((el) => !inExcluded(el));
    const inputsWithoutLabelList: HTMLElement[] = [];
    for (let i = 0; i < formInputs.length; i++) {
      const input = formInputs[i];
      if (input.getAttribute("aria-label") || input.getAttribute("aria-labelledby") || input.getAttribute("title")) continue;
      if (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) continue;
      if (input.closest("label")) continue;
      inputsWithoutLabelList.push(input);
    }
    const inputsWithoutLabelSamples: string[] = [];
    for (let i = 0; i < Math.min(3, inputsWithoutLabelList.length); i++) {
      inputsWithoutLabelSamples.push(inputsWithoutLabelList[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
    }

    // ─── Radio/checkbox groups without fieldset ─────────────────────────────
    const groups: Record<string, HTMLInputElement[]> = {};
    const radioCheckboxInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input[type='radio'], input[type='checkbox']"),
    ).filter((el) => !inExcluded(el));
    for (let i = 0; i < radioCheckboxInputs.length; i++) {
      const el = radioCheckboxInputs[i];
      if (!el.name) continue;
      (groups[el.name] ?? (groups[el.name] = [])).push(el);
    }
    let radioCheckboxGroupsWithoutFieldset = 0;
    for (const name in groups) {
      const group = groups[name];
      if (group.length < 2) continue;
      let allInFieldset = true;
      for (let i = 0; i < group.length; i++) {
        if (!group[i].closest("fieldset")) { allInFieldset = false; break; }
      }
      if (!allInFieldset) radioCheckboxGroupsWithoutFieldset++;
    }

    // ─── Data tables without headers ────────────────────────────────────────
    const tables = Array.from(
      document.querySelectorAll<HTMLTableElement>("table"),
    ).filter((el) => !inExcluded(el));
    let dataTablesWithoutHeaders = 0;
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      if (t.querySelectorAll("tr").length < 2) continue;
      if (!t.querySelector("th") && !t.querySelector("caption")) dataTablesWithoutHeaders++;
    }

    return {
      document: { lang, langValid, hasTitle, ariaHiddenBody, duplicateIds },
      headings: { h1Count, h1HiddenCount, h1Samples, hierarchyJumps },
      landmarks: {
        mainCount,
        navCount: navs.length,
        navsWithoutLabel,
        navsWithoutLabelSamples,
        asideInsideMain,
      },
      nonSemanticInteractive: {
        count: interactiveDivs.length,
        samples: nonSemanticSamples,
      },
      anchorsMisused: {
        hashOnly: hashLinks.length,
        hashOnlySamples,
        withoutHref,
        withoutHrefSamples,
      },
      tabindex: {
        positive: tabindexPositiveEls.length,
        positiveSamples: tabindexPositiveSamples,
      },
      forms: {
        inputsWithoutLabel: inputsWithoutLabelList.length,
        inputsWithoutLabelSamples,
        radioCheckboxGroupsWithoutFieldset,
      },
      tables: { dataTablesWithoutHeaders },
    };
  }, excludeSel);
}
