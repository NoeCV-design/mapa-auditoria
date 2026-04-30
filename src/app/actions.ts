"use server";

import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import path from "node:path";
import fs from "node:fs/promises";
import { Client } from "@notionhq/client";
import { AuditWebsite, AuditCategory, AuditPriority, AuditStatus } from "@/types/audit";
import { isAuthenticated } from "@/lib/auth";

// Dynamic import that bypasses webpack/turbopack static analysis.
// Used for local-only scripts (Playwright, Lighthouse, Sharp) that must not
// be bundled into the Vercel serverless function.
const dynImport = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;

const siteSlug: Record<AuditWebsite, string> = {
  MAPA: "mapa",
  Alimentos: "alimentos",
  Caminos: "caminos",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Queries Notion without cache (with full pagination) to find the highest
 *  UX-NNN number in the DB and returns the next available number (max + 1).
 *  Falls back to 1 on error. Uses cursor pagination to cover all records. */
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

// ─── Crear incidencia manual ──────────────────────────────────────────────────

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
  const captureRes = resolution === "ambas" ? "390x844" : resolution;

  // Screenshot: user either uploads a file or we auto-capture from the URL.
  const outDir = path.join(process.cwd(), "public", "screenshots");
  await fs.mkdir(outDir, { recursive: true });

  const uploaded = formData.get("screenshotFile");
  const hasUpload =
    uploaded instanceof File && uploaded.size > 0 && uploaded.type.startsWith("image/");

  let screenshotUrl: string;
  if (hasUpload) {
    const ext = uploaded.type === "image/jpeg" ? "jpg" : "png";
    const filename = `${website}-upload-${Date.now()}.${ext}`;
    const buffer = Buffer.from(await uploaded.arrayBuffer());
    await fs.writeFile(path.join(outDir, filename), buffer);
    screenshotUrl = "/screenshots/" + filename;
  } else {
    if (process.env.VERCEL) {
      throw new Error("La captura automática solo está disponible en local. Sube una captura manualmente.");
    }
    const screenshot = await dynImport("../../scripts/screenshot") as typeof import("../../scripts/screenshot");
    const shot = await screenshot.captureScreenshot(pageUrl, website, outDir, captureRes);
    screenshotUrl = "/screenshots/" + path.basename(shot.path);
  }

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

// ─── Auditar URL automáticamente ─────────────────────────────────────────────

export async function auditUrl(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  if (process.env.VERCEL) {
    return "La auditoría automática solo está disponible en local. Usa el script run-audit.ts desde tu máquina.";
  }

  const [
    screenshotMod,
    analyzeMod,
    functionalAuditMod,
    axeMod,
    lighthouseAuditMod,
    lighthouseMod,
    notionMod,
  ] = (await Promise.all([
    dynImport("../../scripts/screenshot"),
    dynImport("../../scripts/analyze"),
    dynImport("../../scripts/functional-audit"),
    dynImport("../../scripts/axe"),
    dynImport("../../scripts/lighthouse-audit"),
    dynImport("../../scripts/lighthouse"),
    dynImport("../../scripts/notion"),
  ])) as [
    typeof import("../../scripts/screenshot"),
    typeof import("../../scripts/analyze"),
    typeof import("../../scripts/functional-audit"),
    typeof import("../../scripts/axe"),
    typeof import("../../scripts/lighthouse-audit"),
    typeof import("../../scripts/lighthouse"),
    typeof import("../../scripts/notion"),
  ];

  const { captureScreenshot, cropScreenshot } = screenshotMod;
  const { analyzeDualScreenshots, analyzeFunctionalReport, analyzeSourceCode } = analyzeMod;
  const { runFunctionalAudit } = functionalAuditMod;
  const { axeToIssues } = axeMod;
  const { runLighthouseAudit } = lighthouseAuditMod;
  const { lighthouseToIssues } = lighthouseMod;
  const { sendToNotion } = notionMod;

  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) return "NOTION_DATABASE_ID no configurado.";

  const pageUrl = (formData.get("url") as string)?.trim();
  const website = formData.get("website") as AuditWebsite;
  const exclude = {
    header: formData.get("excludeHeader") === "1",
    footer: formData.get("excludeFooter") === "1",
  };

  if (!pageUrl) return "Introduce una URL válida.";
  if (!website) return "Selecciona un sitio web.";

  try {
    const outDir = path.join(process.cwd(), "public", "screenshots");

    // Obtener el siguiente número correlativo antes de crear incidencias
    const token = process.env.NOTION_TOKEN;
    let seqNum = 1;
    if (token && databaseId) {
      const _notion = new Client({ auth: token });
      const _db = (await _notion.databases.retrieve({ database_id: databaseId })) as unknown as {
        data_sources: { id: string }[];
      };
      const _dsId = _db.data_sources?.[0]?.id;
      if (_dsId) seqNum = await nextIssueNum(_notion, _dsId);
    }

    // 1. Capturas visuales + auditoría funcional + Lighthouse en paralelo
    const [shot390, shot414, functionalAudit, lighthouseReport] = await Promise.all([
      captureScreenshot(pageUrl, website, outDir, "390x844"),
      captureScreenshot(pageUrl, website, outDir, "414x896"),
      runFunctionalAudit(pageUrl, "390x844", exclude),
      runLighthouseAudit(pageUrl, "390x844").catch((err) => {
        console.error("[lighthouse] falló:", (err as Error).message);
        return null;
      }),
    ]);

    const { report: functionalReport } = functionalAudit;

    // 2. Análisis visual + funcional + código fuente en paralelo (3 llamadas AI)
    const [detected, functionalIssues, sourceIssues] = await Promise.all([
      analyzeDualScreenshots(shot390.path, shot414.path, website, exclude),
      analyzeFunctionalReport(functionalReport, website),
      analyzeSourceCode(functionalAudit.structural, website),
    ]);

    // Incidencias de performance (sin AI — parseadas directamente del LHR)
    const perfIssuesRaw = lighthouseReport ? lighthouseToIssues(lighthouseReport) : [];

    if (
      detected.length === 0 &&
      functionalIssues.length === 0 &&
      sourceIssues.length === 0 &&
      functionalAudit.axe.violations.length === 0 &&
      perfIssuesRaw.length === 0
    ) {
      return "No se detectaron incidencias en esta pantalla.";
    }

    // 4. Recortar capturas por incidencia y construir issues
    // Helper: crop screenshot, fallback to full-page if crop fails
    async function cropOrFull(
      sourcePath: string,
      yPosition: number,
      sourceRes: "390x844" | "414x896",
      id: string,
    ): Promise<string> {
      const cropFilename = `${website}-${sourceRes}-crop-${id}.png`;
      const cropPath = path.join(outDir, cropFilename);
      try {
        await cropScreenshot(sourcePath, yPosition, sourceRes, cropPath);
        return "/screenshots/" + cropFilename;
      } catch {
        // Fallback to full-page screenshot
        return "/screenshots/" + path.basename(sourcePath);
      }
    }

    // Visual issues (have resolution field)
    const visualIssues = await Promise.all(
      detected.map(async (d) => {
        const id = `UX-${String(seqNum++).padStart(3, "0")}`;
        const sourceRes = d.resolution === "414x896" ? "414x896" as const : "390x844" as const;
        const sourcePath = d.resolution === "414x896" ? shot414.path : shot390.path;
        const screenshot = await cropOrFull(sourcePath, d.yPosition, sourceRes, id);
        return {
          ...d,
          id,
          website,
          url: pageUrl,
          screenshot,
          status: "todo" as const,
          source: "visual" as const,
        };
      }),
    );

    // Functional issues (no resolution field — default to 390x844 / ambas)
    const funcIssues = await Promise.all(
      functionalIssues.map(async (d) => {
        const id = `UX-${String(seqNum++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot390.path, d.yPosition, "390x844", id);
        return {
          ...d,
          id,
          website,
          url: pageUrl,
          screenshot,
          resolution: "ambas" as const,
          status: "todo" as const,
          source: "functional" as const,
        };
      }),
    );

    // Axe-core accessibility issues — same field shape as funcIssues
    const axeIssues = await Promise.all(
      axeToIssues(functionalAudit.axe).map(async (d) => {
        const id = `UX-${String(seqNum++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot390.path, d.yPosition, "390x844", id);
        return {
          ...d,
          id,
          website,
          url: pageUrl,
          screenshot,
          resolution: "ambas" as const,
          status: "todo" as const,
          source: "axe" as const,
        };
      }),
    );

    // Source-code analysis issues (structural/semantic HTML problems)
    const codeIssues = await Promise.all(
      sourceIssues.map(async (d) => {
        const id = `UX-${String(seqNum++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot390.path, d.yPosition, "390x844", id);
        return {
          ...d,
          id,
          website,
          url: pageUrl,
          screenshot,
          resolution: "ambas" as const,
          status: "todo" as const,
          source: "structural" as const,
        };
      }),
    );

    // Performance issues (Lighthouse — ya mapeadas a DetectedIssue sin AI)
    const perfIssues = await Promise.all(
      perfIssuesRaw.map(async (d) => {
        const id = `UX-${String(seqNum++).padStart(3, "0")}`;
        const screenshot = await cropOrFull(shot390.path, d.yPosition, "390x844", id);
        return {
          ...d,
          id,
          website,
          url: pageUrl,
          screenshot,
          resolution: "ambas" as const,
          status: "todo" as const,
          source: "lighthouse" as const,
        };
      }),
    );

    const issues = [...visualIssues, ...funcIssues, ...axeIssues, ...codeIssues, ...perfIssues];

    // 5. Guardar en Notion
    await sendToNotion(issues, { databaseId });

    // 5. Invalidar caché para que el dashboard muestre los nuevos datos
    revalidateTag("notion-issues", "max");
  } catch (err) {
    return `Error durante la auditoría: ${(err as Error).message}`;
  }

  redirect(`/dashboard/${siteSlug[website]}`);
}

// ─── Editar incidencia ────────────────────────────────────────────────────────

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

  // Optional screenshot replacement
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

// ─── Eliminar incidencia ──────────────────────────────────────────────────────

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
