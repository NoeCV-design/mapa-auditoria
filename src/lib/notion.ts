import { unstable_cache } from "next/cache";
import { Client } from "@notionhq/client";
import { AuditIssue, AuditWebsite } from "@/types/audit";

type Props = Record<string, { type: string; [k: string]: unknown }>;

function text(props: Props, key: string): string {
  const p = props[key];
  if (p?.type === "title") return (p.title as { plain_text: string }[])[0]?.plain_text ?? "";
  if (p?.type === "rich_text") return (p.rich_text as { plain_text: string }[])[0]?.plain_text ?? "";
  if (p?.type === "url") return (p.url as string) ?? "";
  if (p?.type === "select") return (p.select as { name: string } | null)?.name ?? "";
  return "";
}

async function _fetchIssues(website: AuditWebsite | "all"): Promise<AuditIssue[]> {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token || !databaseId) return [];

  const notion = new Client({ auth: token });

  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) return [];

  const baseQuery: Record<string, unknown> = { data_source_id: dataSourceId, page_size: 100 };
  if (website !== "all") {
    baseQuery.filter = { property: "Website", select: { equals: website } };
  }

  type RawPage = { id: string; properties: Props };
  const allResults: RawPage[] = [];
  let cursor: string | undefined;

  do {
    const response = (await notion.dataSources.query({
      ...baseQuery,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as never)) as { results: RawPage[]; has_more: boolean; next_cursor: string | null };
    allResults.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  const raw = allResults.map((page) => {
    const p = page.properties;
    return {
      id: text(p, "ID") || page.id,
      pageId: page.id,
      title: text(p, "Title"),
      website: text(p, "Website") as AuditWebsite,
      category: text(p, "Category") as AuditIssue["category"],
      priority: text(p, "Priority") as AuditIssue["priority"],
      status: text(p, "Status") as AuditIssue["status"],
      url: text(p, "URL"),
      screenshot: text(p, "Screenshot") || undefined,
      problem: text(p, "Problem"),
      solution: text(p, "Solution"),
      impact: text(p, "Impact"),
      resolution: (text(p, "Resolution") || undefined) as AuditIssue["resolution"],
    };
  });

  // Deduplicar por ID conservando la primera aparición
  const seen = new Set<string>();
  const deduped = raw.filter((issue) => {
    if (seen.has(issue.id)) return false;
    seen.add(issue.id);
    return true;
  });

  return deduped;
}

// Cache de 1 hora por website: Notion + traducción sólo se ejecutan una vez por TTL
export const fetchIssues = unstable_cache(
  _fetchIssues,
  ["notion-issues"],
  { revalidate: 3600, tags: ["notion-issues"] }
);
