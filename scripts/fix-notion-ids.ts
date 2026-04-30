/**
 * fix-notion-ids.ts
 *
 * Lee todos los registros de Notion, detecta IDs anómalos o duplicados
 * y los reescribe de forma incremental (UX-001, UX-002, …) respetando
 * el orden de creación de cada página.
 *
 * Uso:  npx tsx scripts/fix-notion-ids.ts [--dry-run]
 *   --dry-run  muestra los cambios sin aplicarlos
 */

import { Client } from "@notionhq/client";
import * as dotenv from "dotenv";
import * as path from "node:path";
import * as readline from "node:readline";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const DRY_RUN = process.argv.includes("--dry-run");
const YES = process.argv.includes("--yes");
const SKIP_EMPTY = process.argv.includes("--skip-empty");

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatId(n: number): string {
  return `UX-${String(n).padStart(3, "0")}`;
}

function isValidId(id: string): boolean {
  return /^UX-\d+$/.test(id);
}

async function confirm(question: string): Promise<boolean> {
  if (DRY_RUN) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + " (s/N): ", (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "s");
    });
  });
}

// ─── Paginación completa ─────────────────────────────────────────────────────

type RawPage = {
  id: string;
  created_time: string;
  properties: Record<string, { type: string; [k: string]: unknown }>;
};

async function fetchAllPages(notion: Client, dataSourceId: string): Promise<RawPage[]> {
  const all: RawPage[] = [];
  let cursor: string | undefined;

  do {
    const res = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as never)) as {
      results: RawPage[];
      has_more: boolean;
      next_cursor: string | null;
    };
    all.push(...res.results);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return all;
}

function getIdText(page: RawPage): string {
  const idProp = page.properties.ID as { rich_text?: { plain_text: string }[] } | undefined;
  return idProp?.rich_text?.[0]?.plain_text ?? "";
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token || !databaseId) {
    console.error("❌ Faltan NOTION_TOKEN o NOTION_DATABASE_ID en .env");
    process.exit(1);
  }

  console.log(DRY_RUN ? "🔍 MODO DRY-RUN (sin cambios reales)\n" : "🔧 MODO REAL\n");

  const notion = new Client({ auth: token });

  // Resolver dataSourceId
  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) {
    console.error("❌ No se encontró data_source en la base de datos.");
    process.exit(1);
  }

  console.log("📥 Leyendo todos los registros de Notion…");
  const pages = await fetchAllPages(notion, dataSourceId);
  console.log(`   → ${pages.length} registros encontrados\n`);

  // Ordenar por fecha de creación (ascendente) para asignar IDs correlativos
  pages.sort((a, b) => a.created_time.localeCompare(b.created_time));

  // Excluir registros sin ID si se pide
  const workPages = SKIP_EMPTY ? pages.filter((p) => getIdText(p) !== "") : pages;

  // ── Análisis ──────────────────────────────────────────────────────────────

  // Registrar IDs actuales
  const currentIds = workPages.map((p) => getIdText(p));
  const idCounts = new Map<string, number>();
  for (const id of currentIds) {
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const invalid = workPages.filter((p) => !isValidId(getIdText(p)));
  const duplicates = workPages.filter((p) => (idCounts.get(getIdText(p)) ?? 0) > 1);
  const anomalous = workPages.filter((p) => {
    const id = getIdText(p);
    if (!isValidId(id)) return false;
    const num = parseInt(id.replace("UX-", ""), 10);
    return num > 9999;
  });

  console.log("─── Diagnóstico ───────────────────────────────────────────────");
  console.log(`  Total registros:       ${pages.length}`);
  console.log(`  IDs inválidos:         ${invalid.length}`);
  console.log(`  IDs duplicados:        ${[...new Set(duplicates.map((p) => getIdText(p)))].length} valores únicos afectando ${duplicates.length} registros`);
  console.log(`  IDs anómalos (>9999):  ${anomalous.length}`);

  const needsFix = new Set<string>();
  [...invalid, ...duplicates, ...anomalous].forEach((p) => needsFix.add(p.id));

  if (needsFix.size === 0) {
    console.log("\n✅ Todos los IDs son correctos. No hay nada que corregir.");
    return;
  }

  // Mostrar detalles
  console.log("\n─── Registros con problemas ───────────────────────────────────");
  for (const page of workPages) {
    const currentId = getIdText(page);
    const isDup = (idCounts.get(currentId) ?? 0) > 1;
    const isInv = !isValidId(currentId);
    const isAno = isValidId(currentId) && parseInt(currentId.replace("UX-", ""), 10) > 9999;
    if (isDup || isInv || isAno) {
      const flags = [isInv ? "INVÁLIDO" : "", isDup ? "DUPLICADO" : "", isAno ? "ANÓMALO" : ""]
        .filter(Boolean)
        .join(", ");
      const titleProp = page.properties.Title as { title?: { plain_text: string }[] } | undefined;
      const title = titleProp?.title?.[0]?.plain_text ?? "(sin título)";
      console.log(`  pageId: ${page.id}`);
      console.log(`    ID actual: "${currentId}"  [${flags}]`);
      console.log(`    Título:    ${title}`);
      console.log(`    Creado:    ${page.created_time}`);
    }
  }

  // ── Plan de reasignación ───────────────────────────────────────────────────
  // Asignamos IDs correlativos a TODOS los registros en orden de creación.
  // Los que ya tienen un ID válido y único los mantenemos si son ≤ su posición
  // (para minimizar cambios). En caso de conflicto, reasignamos.

  console.log("\n─── Plan de reasignación ──────────────────────────────────────");

  // Primera pasada: determinar IDs "buenos" que no cambian
  // Estrategia: reasignamos absolutamente todos para garantizar orden limpio
  // (más seguro que intentar parchar sólo los rotos).

  const updates: { pageId: string; oldId: string; newId: string }[] = [];
  let counter = 1;

  for (const page of workPages) {
    const currentId = getIdText(page);
    const newId = formatId(counter++);
    if (currentId !== newId) {
      updates.push({ pageId: page.id, oldId: currentId, newId });
    }
  }

  if (updates.length === 0) {
    console.log("  ✅ Los IDs ya están en orden. No se requieren cambios.");
    return;
  }

  console.log(`  Se actualizarán ${updates.length} de ${pages.length} registros:\n`);
  for (const u of updates) {
    console.log(`    "${u.oldId}"  →  "${u.newId}"  (pageId: ${u.pageId})`);
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] Ningún cambio aplicado.");
    return;
  }

  // ── Confirmación ──────────────────────────────────────────────────────────
  if (!YES) {
    console.log();
    const ok = await confirm(
      `⚠️  Se van a actualizar ${updates.length} registros en Notion. ¿Continuar?`
    );
    if (!ok) {
      console.log("Cancelado.");
      return;
    }
  }

  // ── Aplicar cambios ────────────────────────────────────────────────────────
  console.log("\n🔄 Actualizando registros…");
  let done = 0;
  let errors = 0;

  for (const u of updates) {
    try {
      await notion.pages.update({
        page_id: u.pageId,
        properties: {
          ID: { rich_text: [{ text: { content: u.newId } }] },
        },
      } as never);
      done++;
      process.stdout.write(`\r  ${done}/${updates.length} actualizados…`);
    } catch (err) {
      errors++;
      console.error(`\n  ❌ Error en ${u.pageId} (${u.oldId} → ${u.newId}): ${(err as Error).message}`);
    }
  }

  console.log(`\n\n✅ Completado: ${done} actualizados, ${errors} errores.`);
  if (errors === 0) {
    console.log("   Los IDs de Notion ahora son correlativos y sin duplicados.");
  }
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
