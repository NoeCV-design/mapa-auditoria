import "dotenv/config";
import { Client } from "@notionhq/client";

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token) throw new Error("NOTION_TOKEN not set");
  if (!databaseId) throw new Error("NOTION_DATABASE_ID not set");

  const notion = new Client({ auth: token });

  // New Notion model: database → data_source(s) → properties.
  // Look up the first (and usually only) data source for the given database.
  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    title: { plain_text: string }[];
    data_sources: { id: string; name: string }[];
  };
  const title = db.title.map((t) => t.plain_text).join("");
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No data_source found on database");
  console.log(`→ Database: "${title}"`);
  console.log(`  data_source_id: ${dataSourceId}`);

  const ds = (await notion.dataSources.retrieve({ data_source_id: dataSourceId })) as unknown as {
    properties: Record<string, { type: string }>;
  };
  const existing = ds.properties ?? {};
  console.log(`  Existing properties: ${Object.keys(existing).join(", ") || "(none)"}`);

  const existingTitleKey = Object.entries(existing).find(([, v]) => v.type === "title")?.[0];
  const propertiesPatch: Record<string, unknown> = {};

  if (existingTitleKey && existingTitleKey !== "Title") {
    propertiesPatch[existingTitleKey] = { name: "Title" };
  } else if (!existingTitleKey && !("Title" in existing)) {
    // Brand-new data source with no title column at all — create one.
    propertiesPatch["Title"] = { title: {} };
  }

  const toAdd: Record<string, unknown> = {
    ID: { rich_text: {} },
    Website: {
      select: {
        options: [
          { name: "MAPA", color: "blue" },
          { name: "Alimentos", color: "green" },
          { name: "Caminos", color: "orange" },
        ],
      },
    },
    Category: {
      select: {
        options: [
          { name: "UX", color: "purple" },
          { name: "UI", color: "blue" },
          { name: "Accesibilidad", color: "green" },
          { name: "Funcional", color: "red" },
        ],
      },
    },
    Priority: {
      select: {
        options: [
          { name: "low", color: "gray" },
          { name: "medium", color: "yellow" },
          { name: "high", color: "red" },
        ],
      },
    },
    Status: {
      select: {
        options: [
          { name: "todo", color: "gray" },
          { name: "in_progress", color: "blue" },
          { name: "done", color: "green" },
        ],
      },
    },
    URL: { url: {} },
    Screenshot: { rich_text: {} },
    Problem: { rich_text: {} },
    Solution: { rich_text: {} },
    Impact: { rich_text: {} },
    Source: {
      select: {
        options: [
          { name: "visual", color: "purple" },
          { name: "functional", color: "blue" },
          { name: "structural", color: "green" },
          { name: "axe", color: "orange" },
          { name: "lighthouse", color: "red" },
          { name: "manual", color: "gray" },
        ],
      },
    },
  };

  for (const [key, value] of Object.entries(toAdd)) {
    if (!(key in existing)) propertiesPatch[key] = value;
    else console.log(`  · "${key}" already exists — skipping`);
  }

  if (Object.keys(propertiesPatch).length === 0) {
    console.log("→ Nothing to do, schema already matches.");
    return;
  }

  console.log(`→ Patching ${Object.keys(propertiesPatch).length} propert${Object.keys(propertiesPatch).length === 1 ? "y" : "ies"}: ${Object.keys(propertiesPatch).join(", ")}`);

  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: propertiesPatch as never,
  });

  console.log("  ✓ Done");
  console.log("");
  console.log(`  Tip: export NOTION_DATA_SOURCE_ID=${dataSourceId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
