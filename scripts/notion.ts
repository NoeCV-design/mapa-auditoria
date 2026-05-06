import { Client, isFullPage } from "@notionhq/client";
import { AuditIssue, AuditWebsite } from "../src/types/audit";

export interface NotionConfig {
  databaseId: string;
  token?: string;
}

type Props = Record<string, { type: string; [k: string]: unknown }>;

function text(props: Props, key: string): string {
  const p = props[key];
  if (p?.type === "title") return (p.title as { plain_text: string }[])[0]?.plain_text ?? "";
  if (p?.type === "rich_text") return (p.rich_text as { plain_text: string }[])[0]?.plain_text ?? "";
  if (p?.type === "url") return (p.url as string) ?? "";
  if (p?.type === "select") return (p.select as { name: string } | null)?.name ?? "";
  return "";
}

export async function fetchFromNotion(
  website: AuditWebsite,
  config: NotionConfig,
): Promise<AuditIssue[]> {
  const token = config.token ?? process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN not set");

  const notion = new Client({ auth: token });

  const db = (await notion.databases.retrieve({ database_id: config.databaseId })) as unknown as {
    data_sources: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`Database ${config.databaseId} has no data_source`);

  type RawPage = { id: string; properties: Props };
  const allResults: RawPage[] = [];
  let cursor: string | undefined;

  do {
    const response = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: "Website", select: { equals: website } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as never)) as { results: RawPage[]; has_more: boolean; next_cursor: string | null };
    allResults.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return allResults
    .map((page) => {
      const p = page.properties;
      const res = text(p, "Resolution");
      const src = text(p, "Source");
      return {
        id: text(p, "ID") || page.id,
        title: text(p, "Title"),
        website: text(p, "Website") as AuditWebsite,
        category: text(p, "Category") as AuditIssue["category"],
        priority: text(p, "Priority") as AuditIssue["priority"],
        status: text(p, "Status") as AuditIssue["status"],
        url: text(p, "URL"),
        problem: text(p, "Problem"),
        solution: text(p, "Solution"),
        impact: text(p, "Impact"),
        resolution: (res || undefined) as AuditIssue["resolution"],
        source: (src || undefined) as AuditIssue["source"],
        isHeuristic: src === "heuristic",
      };
    });
}

/**
 * Queries Notion (no cache, full pagination) to find the highest UX-NNN number
 * already in the database and returns the next available number (max + 1).
 * Falls back to 1. Uses cursor pagination to cover all records.
 */
export async function getNextIssueNum(config: NotionConfig): Promise<number> {
  const token = config.token ?? process.env.NOTION_TOKEN;
  if (!token) return 1;
  try {
    const notion = new Client({ auth: token });
    const db = (await notion.databases.retrieve({ database_id: config.databaseId })) as unknown as {
      data_sources: { id: string }[];
    };
    const dataSourceId = db.data_sources?.[0]?.id;
    if (!dataSourceId) return 1;

    let max = 0;
    let cursor: string | undefined;

    do {
      const res = (await notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      } as never)) as {
        results: Array<{ properties: Props }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const page of res.results) {
        const idText = (page.properties.ID as { rich_text?: { plain_text: string }[] })?.rich_text?.[0]?.plain_text ?? "";
        const match = idText.match(/^UX-(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1], 10));
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);

    return max + 1;
  } catch {
    return 1;
  }
}

/**
 * Send audit issues to a Notion database.
 *
 * Expected schema (see scripts/setup-notion-db.ts):
 *   Title (title), ID (rich_text), Website/Category/Priority/Status (select),
 *   URL (rich_text), Problem/Solution/Impact (rich_text)
 *
 * Notion's 2025 model nests properties under a data_source; this helper
 * resolves the first data_source of the given database automatically.
 */
export async function sendToNotion(
  issues: AuditIssue[],
  config: NotionConfig,
): Promise<void> {
  const token = config.token ?? process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN not set (pass via config or env)");
  }

  const notion = new Client({ auth: token });

  const db = (await notion.databases.retrieve({ database_id: config.databaseId })) as unknown as {
    data_sources: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error(`Database ${config.databaseId} has no data_source`);
  }

  for (const issue of issues) {
    await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: dataSourceId } as never,
      properties: {
        Title: { title: [{ text: { content: issue.title } }] },
        ID: { rich_text: [{ text: { content: issue.id } }] },
        Website: { select: { name: issue.website } },
        Category: { select: { name: issue.category } },
        Priority: { select: { name: issue.priority } },
        Status: { select: { name: issue.status } },
        URL: { url: issue.url },
        ...(issue.screenshot ? { Screenshot: { rich_text: [{ text: { content: issue.screenshot } }] } } : {}),
        Problem: { rich_text: [{ text: { content: issue.problem } }] },
        Solution: { rich_text: [{ text: { content: issue.solution } }] },
        Impact: { rich_text: [{ text: { content: issue.impact } }] },
        ...(issue.resolution ? { Resolution: { select: { name: issue.resolution } } } : {}),
        ...(issue.source ? { Source: { select: { name: issue.source } } } : {}),
      },
    });
  }
}
