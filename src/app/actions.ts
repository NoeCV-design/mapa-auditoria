"use server";

import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import path from "node:path";
import fs from "node:fs/promises";
import { Client } from "@notionhq/client";
import { AuditWebsite, AuditCategory, AuditPriority, AuditStatus } from "@/types/audit";
import { isAuthenticated } from "@/lib/auth";

const siteSlug: Record<AuditWebsite, string> = {
  MAPA: "mapa",
  Alimentos: "alimentos",
  Caminos: "caminos",
};

async function nextIssueNum(notion: Client, dataSourceId: string): Promise<number> {
  try {
    let max = 0;
    let cursor: string | undefined;

    do {
      const res = (await notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      } as never)) as {
        results: Array<{ properties: Record<string, unknown> }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const page of res.results) {
        const p = page.properties as Record<string, { rich_text?: { plain_text: string }[] }>;
        const idText = p.ID?.rich_text?.[0]?.plain_text ?? "";
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

export async function createIssue(formData: FormData) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token || !databaseId) throw new Error("Notion env vars not set");

  const website = formData.get("website") as AuditWebsite;
  const pageUrl = (formData.get("pageUrl") as string).trim();
  const title = (formData.get("title") as string).trim();
  const category = formData.get("category") as AuditCategory;
  const priority = formData.get("priority") as AuditPriority;
  const problem = (formData.get("problem") as string).trim();
  const solution = (formData.get("solution") as string).trim();
  const impact = (formData.get("impact") as string).trim();
  const resolution = (formData.get("resolution") as string || "390x844") as import("@/types/audit").AuditResolution;

  const outDir = path.join(process.cwd(), "public", "screenshots");
  await fs.mkdir(outDir, { recursive: true });

  const uploaded = formData.get("screenshotFile");
  const hasUpload =
    uploaded instanceof File && uploaded.size > 0 && uploaded.type.startsWith("image/");

  if (!hasUpload) {
    throw new Error("Debes subir una captura de pantalla.");
  }

  const ext = uploaded.type === "image/jpeg" ? "jpg" : "png";
  const filename = `${website}-upload-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await uploaded.arrayBuffer());
  await fs.writeFile(path.join(outDir, filename), buffer);
  const screenshotUrl = "/screenshots/" + filename;

  const notion = new Client({ auth: token });

  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No data_source found");

  const num = await nextIssueNum(notion, dataSourceId);
  const id = `UX-${String(num).padStart(3, "0")}`;

  await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: dataSourceId } as never,
    properties: {
      Title: { title: [{ text: { content: title } }] },
      ID: { rich_text: [{ text: { content: id } }] },
      Website: { select: { name: website } },
      Category: { select: { name: category } },
      Priority: { select: { name: priority } },
      Status: { select: { name: "todo" } },
      URL: { url: pageUrl },
      Screenshot: { rich_text: [{ text: { content: screenshotUrl } }] },
      Problem: { rich_text: [{ text: { content: problem } }] },
      Solution: { rich_text: [{ text: { content: solution } }] },
      Impact: { rich_text: [{ text: { content: impact } }] },
      Resolution: { select: { name: resolution } },
      Source: { select: { name: "manual" } },
    },
  });

  revalidateTag("notion-issues", "max");
  redirect(`/dashboard/${siteSlug[website]}`);
}

export async function auditUrl(
  _prevState: string | null,
  _formData: FormData
): Promise<string | null> {
  return "La auditoría automática solo está disponible en local. Ejecútala con: npm run audit";
}

export async function updateIssue(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  if (!(await isAuthenticated())) return "No autorizado";

  const token = process.env.NOTION_TOKEN;
  if (!token) return "NOTION_TOKEN no configurado";

  const pageId = (formData.get("pageId") as string)?.trim();
  if (!pageId) return "ID de página no válido";

  const title = (formData.get("title") as string).trim();
  const category = formData.get("category") as AuditCategory;
  const priority = formData.get("priority") as AuditPriority;
  const status = formData.get("status") as AuditStatus;
  const resolution = (formData.get("resolution") as string) || "ambas";
  const problem = (formData.get("problem") as string).trim();
  const impact = (formData.get("impact") as string).trim();
  const solution = (formData.get("solution") as string).trim();

  let screenshotUrl: string | null = null;
  const uploaded = formData.get("screenshotFile");
  const hasUpload =
    uploaded instanceof File && uploaded.size > 0 && uploaded.type.startsWith("image/");

  if (hasUpload) {
    const website = (formData.get("website") as string) || "unknown";
    const ext = uploaded.type === "image/jpeg" ? "jpg" : "png";
    const filename = `${website}-upload-${Date.now()}.${ext}`;
    const outDir = path.join(process.cwd(), "public", "screenshots");
    await fs.mkdir(outDir, { recursive: true });
    const buffer = Buffer.from(await uploaded.arrayBuffer());
    await fs.writeFile(path.join(outDir, filename), buffer);
    screenshotUrl = "/screenshots/" + filename;
  }

  try {
    const notion = new Client({ auth: token });
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Title: { title: [{ text: { content: title } }] },
        Category: { select: { name: category } },
        Priority: { select: { name: priority } },
        Status: { select: { name: status } },
        Resolution: { select: { name: resolution } },
        Problem: { rich_text: [{ text: { content: problem } }] },
        Solution: { rich_text: [{ text: { content: solution } }] },
        Impact: { rich_text: [{ text: { content: impact } }] },
        ...(screenshotUrl
          ? { Screenshot: { rich_text: [{ text: { content: screenshotUrl } }] } }
          : {}),
      },
    });
  } catch (err) {
    return `Error al actualizar: ${(err as Error).message}`;
  }

  revalidateTag("notion-issues", "max");
  return null;
}

export async function deleteIssue(formData: FormData): Promise<void> {
  if (!(await isAuthenticated())) throw new Error("No autorizado");

  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN no configurado");

  const pageId = (formData.get("pageId") as string)?.trim();
  const site = (formData.get("site") as string)?.trim() || "mapa";

  if (pageId) {
    const notion = new Client({ auth: token });
    await notion.pages.update({ page_id: pageId, archived: true });
  }

  revalidateTag("notion-issues", "max");
  redirect(`/dashboard/${site}`);
}
