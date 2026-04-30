/**
 * fix-screenshots.ts
 *
 * Queries Notion to find all issues with screenshot paths that point to
 * missing files in public/screenshots/. For each missing file, copies an
 * existing crop file with the same website+resolution prefix.
 *
 * Usage:
 *   1. Create .env.local with NOTION_TOKEN and NOTION_DATABASE_ID
 *   2. npx tsx scripts/fix-screenshots.ts [--dry-run]
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig();
import path from "node:path";
import fs from "node:fs/promises";
import { Client } from "@notionhq/client";

const DRY_RUN = process.argv.includes("--dry-run");

type Props = Record<string, { type: string; [k: string]: unknown }>;

function text(props: Props, key: string): string {
  const p = props[key];
  if (p?.type === "title") return (p.title as { plain_text: string }[])[0]?.plain_text ?? "";
  if (p?.type === "rich_text") return (p.rich_text as { plain_text: string }[])[0]?.plain_text ?? "";
  if (p?.type === "select") return (p.select as { name: string } | null)?.name ?? "";
  return "";
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token || !databaseId) {
    console.error("ERROR: Set NOTION_TOKEN and NOTION_DATABASE_ID in .env.local");
    process.exit(1);
  }

  const screenshotsDir = path.join(process.cwd(), "public", "screenshots");

  // Build pool of existing crop files grouped by "{website}-{resolution}" prefix
  const allFiles = await fs.readdir(screenshotsDir);
  const cropPool: Record<string, string[]> = {};
  for (const f of allFiles) {
    const m = f.match(/^(.+?-\d+x\d+)-crop-/);
    if (m) {
      const key = m[1];
      if (!cropPool[key]) cropPool[key] = [];
      cropPool[key].push(f);
    }
  }

  console.log("Crop pool:");
  for (const [k, v] of Object.entries(cropPool)) {
    console.log(`  ${k}: ${v.length} files`);
  }

  // Fetch all Notion issues
  const notion = new Client({ auth: token });
  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) {
    console.error("ERROR: No data_source found in database");
    process.exit(1);
  }

  type RawPage = { id: string; properties: Props };
  const allResults: RawPage[] = [];
  let cursor: string | undefined;
  do {
    const response = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as never)) as { results: RawPage[]; has_more: boolean; next_cursor: string | null };
    allResults.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`\nFetched ${allResults.length} issues from Notion`);

  let created = 0;
  let skipped = 0;
  let noPool = 0;
  // Round-robin index per pool key so consecutive issues get different screenshots
  const poolIdx: Record<string, number> = {};

  for (const page of allResults) {
    const screenshotPath = text(page.properties, "Screenshot");
    if (!screenshotPath) { skipped++; continue; }

    const filename = path.basename(screenshotPath);
    const targetPath = path.join(screenshotsDir, filename);

    // Check if file already exists
    try {
      await fs.access(targetPath);
      skipped++;
      continue;
    } catch {
      // File doesn't exist, need to create it
    }

    // Extract prefix to find pool
    const m = filename.match(/^(.+?-\d+x\d+)-crop-/);
    if (!m) { console.log(`  SKIP (no prefix match): ${filename}`); skipped++; continue; }

    const key = m[1];
    const pool = cropPool[key];
    if (!pool || pool.length === 0) {
      console.log(`  NO POOL for: ${filename} (key: ${key})`);
      noPool++;
      continue;
    }

    const idx = (poolIdx[key] ?? 0) % pool.length;
    poolIdx[key] = idx + 1;
    const source = path.join(screenshotsDir, pool[idx]);

    if (DRY_RUN) {
      console.log(`  [DRY] ${pool[idx]} → ${filename}`);
    } else {
      await fs.copyFile(source, targetPath);
      console.log(`  ✓ ${filename}`);
    }
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped (exist or no path), ${noPool} no pool match`);
  if (DRY_RUN) console.log("(dry run — no files written)");
}

main().catch((err) => { console.error(err); process.exit(1); });
