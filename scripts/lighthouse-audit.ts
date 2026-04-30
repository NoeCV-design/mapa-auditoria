import { spawn } from "node:child_process";
import path from "node:path";
import { CaptureResolution } from "./screenshot";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single failed Lighthouse audit (score < passThreshold). */
export interface LighthouseFinding {
  id: string;
  title: string;
  description: string;
  displayValue: string;
  score: number | null;
  /** Bytes that could be saved (render-blocking, unused-js, etc.). 0 when n/a. */
  savingsBytes: number;
  /** Milliseconds that could be saved. 0 when n/a. */
  savingsMs: number;
  /** Number of problematic items (unused scripts, unoptimized images, etc.). */
  itemsCount: number;
}

/** Compact performance report extracted from the full Lighthouse result. */
export interface LighthousePerformanceReport {
  url: string;
  resolution: CaptureResolution;
  /** Overall Performance score 0-100. */
  score: number;
  /** Largest Contentful Paint in ms. */
  lcpMs: number | null;
  /** Cumulative Layout Shift (unitless). */
  cls: number | null;
  /** Total Blocking Time in ms. */
  tbtMs: number | null;
  /** First Contentful Paint in ms. */
  fcpMs: number | null;
  /** Speed Index in ms. */
  speedIndexMs: number | null;
  /** Failed audits — score < 0.9 means "needs improvement" or "fails". */
  failedAudits: LighthouseFinding[];
}

// ─── LHR shape ───────────────────────────────────────────────────────────────

type LhrAudit = {
  id: string;
  title: string;
  description?: string;
  displayValue?: string;
  score: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  details?: {
    type?: string;
    overallSavingsBytes?: number;
    overallSavingsMs?: number;
    items?: unknown[];
  };
};

type Lhr = {
  categories: Record<string, { score: number | null; auditRefs: { id: string }[] }>;
  audits: Record<string, LhrAudit>;
  runtimeError?: { code: string; message: string };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toFinding(audit: LhrAudit): LighthouseFinding {
  return {
    id: audit.id,
    title: audit.title,
    description: (audit.description ?? "").replace(/\[Learn more.*?\]\([^)]+\)/g, "").trim(),
    displayValue: audit.displayValue ?? "",
    score: audit.score,
    savingsBytes: audit.details?.overallSavingsBytes ?? 0,
    savingsMs: audit.details?.overallSavingsMs ?? 0,
    itemsCount: Array.isArray(audit.details?.items) ? audit.details!.items!.length : 0,
  };
}

/**
 * Runs the Lighthouse CLI as a subprocess and returns parsed LHR JSON.
 * Uses a subprocess instead of the programmatic API because Lighthouse 12+
 * is strictly ESM and cannot be imported from CJS contexts (tsx/Next.js).
 */
function runLighthouseCli(url: string, width: number, height: number): Promise<Lhr> {
  const lhBinary = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "lighthouse.cmd" : "lighthouse",
  );

  const args = [
    url,
    "--output=json",
    "--only-categories=performance",
    "--quiet",
    "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
    "--form-factor=mobile",
    `--screenEmulation.mobile=true`,
    `--screenEmulation.width=${width}`,
    `--screenEmulation.height=${height}`,
    `--screenEmulation.deviceScaleFactor=2`,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(lhBinary, args, {
      shell: true, // needed on Windows for .cmd
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0 && !stdout.trim().startsWith("{")) {
        reject(new Error(`Lighthouse exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const lhr = JSON.parse(stdout) as Lhr;
        if (lhr.runtimeError && lhr.runtimeError.code !== "NO_ERROR") {
          reject(new Error(`Lighthouse runtime error: ${lhr.runtimeError.message}`));
          return;
        }
        resolve(lhr);
      } catch (err) {
        reject(new Error(`Failed to parse Lighthouse JSON: ${(err as Error).message}\nStderr: ${stderr.slice(0, 500)}`));
      }
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Runs Lighthouse against `url` with mobile emulation and returns a compact
 * performance report. Only Performance audits are collected — accessibility,
 * best-practices and SEO are skipped because we cover those via axe/functional.
 *
 * Timing: Lighthouse takes 20-60 s per URL. Run in parallel with other audits.
 */
export async function runLighthouseAudit(
  url: string,
  resolution: CaptureResolution = "390x844",
): Promise<LighthousePerformanceReport> {
  const width = resolution === "414x896" ? 414 : 390;
  const height = resolution === "414x896" ? 896 : 844;

  const lhr = await runLighthouseCli(url, width, height);

  // Collect failed audits from the Performance category.
  const perfCategory = lhr.categories.performance;
  const failedAudits: LighthouseFinding[] = [];
  if (perfCategory) {
    for (const ref of perfCategory.auditRefs) {
      const audit = lhr.audits[ref.id];
      if (!audit) continue;
      if (audit.scoreDisplayMode && audit.scoreDisplayMode !== "binary" && audit.scoreDisplayMode !== "numeric") continue;
      if (audit.score === null || audit.score >= 0.9) continue;
      failedAudits.push(toFinding(audit));
    }
  }

  const getNumeric = (id: string): number | null => {
    const v = lhr.audits[id]?.numericValue;
    return typeof v === "number" ? Math.round(v) : null;
  };

  return {
    url,
    resolution,
    score: Math.round((perfCategory?.score ?? 0) * 100),
    lcpMs: getNumeric("largest-contentful-paint"),
    cls: (() => {
      const v = lhr.audits["cumulative-layout-shift"]?.numericValue;
      return typeof v === "number" ? Math.round(v * 1000) / 1000 : null;
    })(),
    tbtMs: getNumeric("total-blocking-time"),
    fcpMs: getNumeric("first-contentful-paint"),
    speedIndexMs: getNumeric("speed-index"),
    failedAudits,
  };
}
