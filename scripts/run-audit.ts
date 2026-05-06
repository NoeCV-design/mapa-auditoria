import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import { put } from "@vercel/blob";
import { captureScreenshot, cropScreenshot } from "./screenshot";
import { analyzeScreenshot, analyzeSourceCode, analyzeHeuristics } from "./analyze";
import { runFunctionalAudit } from "./functional-audit";
import { axeToIssues } from "./axe";
import { sendToNotion, getNextIssueNum } from "./notion";
import { AuditIssue, AuditWebsite } from "../src/types/audit";

const WEBSITES: AuditWebsite[] = ["MAPA", "Alimentos", "Caminos"];

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  const website = args.filter((a) => !a.startsWith("--"))[1] as AuditWebsite | undefined;
  const excludeHeader = args.includes("--exclude-header");
  const excludeFooter = args.includes("--exclude-footer");
  const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
  const mode: "full" | "heuristic" = modeArg === "heuristic" ? "heuristic" : "full";

  if (!url || !website || !WEBSITES.includes(website)) {
    console.error(`Usage: tsx scripts/run-audit.ts <url> <website> [--exclude-header] [--exclude-footer] [--mode=full|heuristic]`);
    console.error(`  website: ${WEBSITES.join(" | ")}`);
    process.exit(1);
  }

  const exclude = { header: excludeHeader, footer: excludeFooter };
  if (excludeHeader) console.log("  ↳ Excluyendo <header> del análisis");
  if (excludeFooter) console.log("  ↳ Excluyendo <footer> del análisis");
  console.log(`  ↳ Modo: ${mode === "heuristic" ? "solo análisis heurístico" : "análisis completo"}`);

  const databaseId = process.env.NOTION_DATABASE_ID;
  const skipNotion = !databaseId;

  const outDir = path.join(process.cwd(), "public", "screenshots");

  // Obtener el siguiente número correlativo desde Notion (o 1 si no hay BD)
  let idx = databaseId
    ? await getNextIssueNum({ databaseId })
    : 1;

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const blobAllowOverwrite = process.env.BLOB_ALLOW_OVERWRITE === "true";

  async function uploadToBlob(filePath: string, filename: string): Promise<string> {
    if (!blobToken) return "/screenshots/" + filename;
    const buffer = await fs.readFile(filePath);
    const { url: blobUrl } = await put(filename, buffer, {
      access: "private",
      token: blobToken,
      ...(blobAllowOverwrite ? { allowOverwrite: true } : { addRandomSuffix: true }),
    });
    return `/api/blob?url=${encodeURIComponent(blobUrl)}`;
  }

  async function cropOrFull(sourcePath: string, yPosition: number, id: string): Promise<string> {
    const cropFilename = `${website}-390x844-crop-${id}.png`;
    const cropPath = path.join(outDir, cropFilename);
    try {
      await cropScreenshot(sourcePath, yPosition, "390x844", cropPath);
      return uploadToBlob(cropPath, cropFilename);
    } catch {
      return uploadToBlob(sourcePath, path.basename(sourcePath));
    }
  }

  console.log(`→ Capturing screenshot + running axe in parallel`);
  const emptyFunctional: Awaited<ReturnType<typeof runFunctionalAudit>> = {
    report: {} as never,
    axe: { violations: [], passes: [], incomplete: [] },
    structural: {} as never,
  };

  const [shot, functionalAudit] = await Promise.all([
    captureScreenshot(url, website, outDir),
    runFunctionalAudit(url, exclude).catch((err) => {
      console.error("  ✗ Functional audit failed:", (err as Error).message);
      return emptyFunctional;
    }),
  ]);
  console.log(`  ✓ Saved ${shot.path}`);
  console.log(`  ✓ Axe: ${functionalAudit.axe.violations.length} violation(s)`);

  console.log(`→ Analyzing with AI`);

  let allIssues: AuditIssue[] = [];

  if (mode === "heuristic") {
    const heuristicDetected = await analyzeHeuristics(shot.path, website, functionalAudit.axe.violations, exclude);
    const heurIssues: AuditIssue[] = await Promise.all(
      heuristicDetected.map(async (d) => {
        const id = `UX-${String(idx++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot.path, d.yPosition, id);
        return { ...d, id, website, url, screenshot, category: "UX" as const, resolution: "390x844" as const, status: "todo" as const, source: "heuristic" as const, isHeuristic: true };
      }),
    );
    console.log(`  ✓ Found ${heurIssues.length} heuristic issue(s)`);
    allIssues = heurIssues;
  } else {
    const [detected, sourceIssues, heuristicDetected] = await Promise.all([
      analyzeScreenshot(shot.path, website, exclude),
      analyzeSourceCode(functionalAudit.structural, website, exclude),
      analyzeHeuristics(shot.path, website, functionalAudit.axe.violations, exclude),
    ]);

    const issues: AuditIssue[] = await Promise.all(
      detected.map(async (d) => {
        const id = `UX-${String(idx++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot.path, d.yPosition, id);
        return { ...d, id, website, url, screenshot, resolution: "390x844" as const, status: "todo" as const, source: "visual" as const };
      }),
    );
    console.log(`  ✓ Found ${issues.length} Claude issue(s)`);

    const axeIssues: AuditIssue[] = await Promise.all(
      axeToIssues(functionalAudit.axe).map(async (d) => {
        const id = `UX-${String(idx++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot.path, d.yPosition, id);
        return { ...d, id, website, url, screenshot, resolution: "ambas" as const, status: "todo" as const, source: "axe" as const };
      }),
    );
    console.log(`  ✓ Found ${axeIssues.length} axe issue(s)`);

    const codeIssues: AuditIssue[] = await Promise.all(
      sourceIssues.map(async (d) => {
        const id = `UX-${String(idx++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot.path, d.yPosition, id);
        return { ...d, id, website, url, screenshot, resolution: "ambas" as const, status: "todo" as const, source: "structural" as const };
      }),
    );
    console.log(`  ✓ Found ${codeIssues.length} source-code issue(s)`);

    const heurIssues: AuditIssue[] = await Promise.all(
      heuristicDetected.map(async (d) => {
        const id = `UX-${String(idx++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot.path, d.yPosition, id);
        return { ...d, id, website, url, screenshot, category: "UX" as const, resolution: "390x844" as const, status: "todo" as const, source: "heuristic" as const, isHeuristic: true };
      }),
    );
    console.log(`  ✓ Found ${heurIssues.length} heuristic issue(s)`);

    allIssues = [...issues, ...axeIssues, ...codeIssues, ...heurIssues];
  }
  console.log(`  ✓ Total: ${allIssues.length} issue(s)`);
  for (const issue of allIssues) {
    console.log(`    · ${issue.id} [${issue.priority}] ${issue.title}`);
  }

  if (skipNotion) {
    console.log(`→ NOTION_DATABASE_ID not set — skipping Notion sync`);
    return;
  }

  console.log(`→ Sending to Notion`);
  await sendToNotion(allIssues, { databaseId });
  console.log(`  ✓ Done`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
