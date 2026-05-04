import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "node:path";
import { AuditCategory, AuditPriority, AuditResolution, AuditSource } from "../src/types/audit";
import { splitIntoTiles } from "./screenshot";
import type { ExcludeOptions, FunctionalReport, StructuralFindings } from "./functional-audit";

/** Builds a Spanish instruction telling the AI to skip issues in the excluded
 *  regions. Returns an empty string when nothing is excluded so prompts stay
 *  unchanged in the default case. */
function excludeInstruction(exclude?: ExcludeOptions): string {
  if (!exclude) return "";
  const parts: string[] = [];
  if (exclude.header) parts.push("la cabecera superior de la página (<header>: logo, menú principal, buscador, botones de acceso/idioma)");
  if (exclude.footer) parts.push("el pie de página (<footer>: enlaces secundarios, aviso legal, redes sociales, datos de contacto)");
  if (parts.length === 0) return "";
  return `\n\nIMPORTANTE: NO reportes ninguna incidencia que esté dentro de ${parts.join(" ni de ")}. Esas zonas se compartirán entre todas las URLs y ya se auditarán una sola vez por separado. Céntrate solo en el contenido específico de esta página.`;
}

// ─── Provider selection ───────────────────────────────────────────────────────
// Set AI_PROVIDER=gemini in .env.local to use Google Gemini (free tier).
// Set AI_PROVIDER=anthropic (or leave unset) to use Anthropic Claude.

function getProvider(): "anthropic" | "gemini" {
  return process.env.AI_PROVIDER === "gemini" ? "gemini" : "anthropic";
}

const anthropic = new Anthropic();
const gemini = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? "");

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface DetectedIssue {
  title: string;
  category: AuditCategory;
  priority: AuditPriority;
  problem: string;
  solution: string;
  impact: string;
  yPosition: number;
  /** Set by deterministic transforms (axe/lighthouse) so the pipeline of
   *  origin survives until the issue reaches Notion. AI-generated issues
   *  leave this undefined — actions.ts assigns it when wiring up the issue. */
  source?: AuditSource;
}

export interface DetectedIssueDual extends DetectedIssue {
  resolution: AuditResolution;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Devuelve ÚNICAMENTE un array JSON válido. Sin prosa, sin markdown, sin bloques de código.

Esquema de cada objeto:
{"title":string,"category":"UX"|"UI"|"Accesibilidad","priority":"low"|"medium"|"high","problem":string,"solution":string,"impact":string,"yPosition":number}

Reglas:
- Máximo 5 incidencias. Prioriza las más graves.
- NO reportes problemas de rendimiento/carga. La captura se hizo en un entorno automatizado, NO refleja la velocidad real del sitio.
- NO reportes imágenes que no hayan cargado o zonas en blanco por carga incompleta: son artefactos de la captura.
- title: ≤8 palabras.
- problem: 1-2 frases. Identifica el elemento concreto visible en la captura (p. ej. "El botón 'Buscar'", "El texto del banner principal", "El menú de navegación superior"). Para Accesibilidad incluye el criterio WCAG 2.2 AA y/o EN 301549 correspondiente (ej. "1.4.3 Contraste mínimo"). No incluyas bloque de código (es análisis visual).
- solution: 1-2 frases.
- impact: 1 frase.
- yPosition: porcentaje vertical 0-100 en la página completa. Si la captura viene en secciones etiquetadas con rango, calcula la posición global dentro de ese rango.
- Secciones etiquetadas = página continua; analízalas como un todo.
- Marco legal: RD 1112/2018 + norma EN 301549 v2.1.2. Evalúa nivel AA de WCAG 2.2.
- PROHIBIDO reportar problemas de contraste (1.4.3, 1.4.11) basándote en la apariencia visual de la captura: la compresión JPEG y el renderizado alteran los colores y hacen imposible calcular la ratio real. El contraste solo puede evaluarse con los valores hexadecimales exactos del DOM.
- PROHIBIDO reportar problemas estructurales/semánticos del HTML que no son verificables desde una imagen: ausencia o duplicación de <h1>/<main>/<nav>/<header>/<footer> u otros landmarks, anchors sin href o con href="#", IDs duplicados, atributo lang del <html>, <title> de la página, tabindex, aria-hidden, atributos ARIA, <label> de formularios o asociaciones for/id. Estos checks se realizan en un análisis separado del DOM real con muestras verificadas; reportarlos desde una captura genera falsos positivos.
- Si visualmente notas que falta un encabezado principal visible, NO lo reportes: puede estar presente en el DOM pero oculto por CSS responsive (p. ej. hidden-xs, d-none, display:none en móvil). El análisis estructural detecta y reporta ese caso correctamente.
- Criterios WCAG 2.2 AA / EN 301549 evaluables desde captura: touch targets con área inferior a 24×24 px CSS (2.5.8 AA — NO uses 44×44 px que es criterio AAA 2.5.5), texto demasiado pequeño para leer (pero NO inferir contraste de color), foco visible ausente en elementos interactivos (2.4.11 AA en WCAG 2.2), espaciado insuficiente entre elementos (1.4.12), contenido en hover/foco no descartable (1.4.13 / 9.1.4.13), problemas de UX/UI puramente visuales (jerarquía visual confusa, alineación, legibilidad, densidad).
- NUNCA apliques criterios AAA: 2.5.5 (44×44 px), 1.4.6 (contraste mejorado 7:1), 2.4.12, ni ningún otro marcado como AAA.
- Todos los textos en español.`;

const DUAL_SYSTEM_PROMPT = `Devuelve ÚNICAMENTE un array JSON válido. Sin prosa, sin markdown, sin bloques de código.

Esquema de cada objeto:
{"title":string,"category":"UX"|"UI"|"Accesibilidad","priority":"low"|"medium"|"high","problem":string,"solution":string,"impact":string,"resolution":"390x844"|"414x896"|"ambas","yPosition":number}

Reglas:
- Máximo 5 incidencias. Prioriza las más graves.
- NO reportes problemas de rendimiento/carga. La captura se hizo en un entorno automatizado, NO refleja la velocidad real del sitio.
- NO reportes imágenes que no hayan cargado o zonas en blanco por carga incompleta: son artefactos de la captura.
- title: ≤8 palabras.
- problem: 1-2 frases. Identifica el elemento concreto visible en la captura (p. ej. "El botón 'Buscar'", "El texto del banner principal", "El menú de navegación superior"). Para Accesibilidad incluye el criterio WCAG 2.2 AA y/o EN 301549 correspondiente (ej. "1.4.3 Contraste mínimo"). No incluyas bloque de código (es análisis visual).
- solution: 1-2 frases.
- impact: 1 frase.
- resolution: "390x844" si sólo afecta a esa captura, "414x896" si sólo a esa, "ambas" si aparece en las dos.
- NO dupliques: un mismo problema → una sola incidencia con resolution "ambas".
- yPosition: porcentaje vertical 0-100 en la página completa. Si resolution es "ambas", usa la posición de la captura 390×844. Calcula la posición global dentro del rango de la sección etiquetada.
- Secciones etiquetadas = página continua; analízalas como un todo.
- Marco legal: RD 1112/2018 + norma EN 301549 v2.1.2. Evalúa nivel AA de WCAG 2.2.
- PROHIBIDO reportar problemas de contraste (1.4.3, 1.4.11) basándote en la apariencia visual de la captura: la compresión JPEG y el renderizado alteran los colores y hacen imposible calcular la ratio real. El contraste solo puede evaluarse con los valores hexadecimales exactos del DOM.
- PROHIBIDO reportar problemas estructurales/semánticos del HTML que no son verificables desde una imagen: ausencia o duplicación de <h1>/<main>/<nav>/<header>/<footer> u otros landmarks, anchors sin href o con href="#", IDs duplicados, atributo lang del <html>, <title> de la página, tabindex, aria-hidden, atributos ARIA, <label> de formularios o asociaciones for/id. Estos checks se realizan en un análisis separado del DOM real con muestras verificadas; reportarlos desde una captura genera falsos positivos.
- Si visualmente notas que falta un encabezado principal visible, NO lo reportes: puede estar presente en el DOM pero oculto por CSS responsive (p. ej. hidden-xs, d-none, display:none en móvil). El análisis estructural detecta y reporta ese caso correctamente.
- Criterios WCAG 2.2 AA / EN 301549 evaluables desde captura: touch targets con área inferior a 24×24 px CSS (2.5.8 AA — NO uses 44×44 px que es criterio AAA 2.5.5), texto demasiado pequeño para leer (pero NO inferir contraste de color), foco visible ausente en elementos interactivos (2.4.11 AA en WCAG 2.2), espaciado insuficiente entre elementos (1.4.12), contenido en hover/foco no descartable (1.4.13 / 9.1.4.13), problemas de UX/UI puramente visuales (jerarquía visual confusa, alineación, legibilidad, densidad).
- NUNCA apliques criterios AAA: 2.5.5 (44×44 px), 1.4.6 (contraste mejorado 7:1), 2.4.12, ni ningún otro marcado como AAA.
- Todos los textos en español.`;

const FUNCTIONAL_SYSTEM_PROMPT = `Devuelve ÚNICAMENTE un array JSON válido. Sin prosa, sin markdown, sin bloques de código.

Recibirás un informe JSON de auditoría funcional (Playwright) de una web móvil.

Esquema de cada objeto:
{"title":string,"category":"Funcional"|"Accesibilidad","priority":"low"|"medium"|"high","problem":string,"solution":string,"impact":string,"yPosition":number}

Reglas:
- Máximo 5 incidencias. Prioriza las más graves.
- title: ≤8 palabras.
- problem: 1-2 frases describiendo el problema. Si el informe incluye selectores CSS, fragmentos HTML o atributos concretos del elemento afectado, añádelos al final con el formato exacto: "\n\nCódigo:\n" seguido de los fragmentos (máx. 3 elementos, uno por línea). Ejemplo: "\n\nCódigo:\n<a class=\"nav-link\">Inicio</a>\n<a onclick=\"go()\">Más info</a>". Para Accesibilidad incluye criterio WCAG 2.2 AA / EN 301549 correspondiente.
- solution: 1-2 frases.
- impact: 1 frase.
- category: "Funcional" (enlaces rotos, errores JS, recursos fallidos) | "Accesibilidad" (sin alt, botones sin nombre, enlaces sin texto, sin label, touch targets pequeños, foco de teclado).
- Marco legal: RD 1112/2018 + norma EN 301549 v2.1.2. Evalúa ÚNICAMENTE nivel AA de WCAG 2.2. NUNCA apliques criterios AAA (2.5.5 de 44×44 px, 1.4.6, 2.4.12, etc.).
- Touch targets: el umbral AA es 24×24 px CSS mínimo (WCAG 2.5.8). Solo reporta si el informe indica dimensiones menores. NO uses 44×44 px.
- NO reportes problemas de rendimiento ni tiempo de carga (loadTimeMs). La medición se hizo en un entorno automatizado y NO refleja la velocidad real del sitio.
- IGNORA los campos loadTimeMs y failedResources del informe: son artefactos del entorno de prueba.
- yPosition: usa el campo "yPercent" del informe si existe, si no usa 50.
- Agrupa hallazgos similares en una sola incidencia (ej. "3 imágenes sin alt: logo.png, banner.jpg, icon.svg").
- Para el campo noFocusIndicator: si hay elementos, repórtalos como incidencia Accesibilidad con criterio WCAG 2.4.11 / EN 301549 9.2.4.11 (foco visible, AA en WCAG 2.2). Menciona los selectores concretos.
- Para el campo focusTrap: si no es null, repórtalo como incidencia Accesibilidad crítica indicando el selector donde el foco queda atrapado.
- Para el campo interactionFindings: convierte cada finding en una incidencia. Tipos → categoría/prioridad: menu-aria-expanded-missing→Accesibilidad/high, menu-state-unchanged→Accesibilidad/high, form-required-no-error-description→Accesibilidad/high, modal-focus-not-moved→Accesibilidad/high, modal-focus-not-returned→Accesibilidad/medium. Usa el campo detail como base del problem.
- Criterios específicos a detectar: propósito de campos de formulario (1.3.5 / 9.1.3.5), nombre accesible coincide con etiqueta visible (2.5.3 / 9.2.5.3), mensajes de estado programáticos (4.1.3 / 9.4.1.3).
- Omite hallazgos no problemáticos.
- Todos los textos en español.`;

const SOURCE_SYSTEM_PROMPT = `Devuelve ÚNICAMENTE un array JSON válido. Sin prosa, sin markdown, sin bloques de código.

Recibirás un JSON con hallazgos estructurales OBJETIVOS extraídos del DOM renderizado.
TODOS LOS CONTEOS YA ESTÁN VERIFICADOS. No "intentes contar" ni reinterpretes: usa los números tal cual.

Esquema de cada objeto:
{"title":string,"category":"UX"|"Accesibilidad","priority":"low"|"medium"|"high","problem":string,"solution":string,"impact":string,"yPosition":number}

Marco legal: RD 1112/2018 + norma EN 301549 v2.1.2. Evalúa ÚNICAMENTE nivel AA de WCAG 2.2. NUNCA apliques criterios AAA. Cita siempre el criterio WCAG y su equivalente EN 301549 (p. ej. "WCAG 1.3.1 / EN 301549 9.1.3.1").

Reglas de conversión (genera una incidencia por cada campo problemático; omite los que están OK):
- headings.h1Count === 0 → Accesibilidad/medium "Falta <h1>" (WCAG 1.3.1 / 9.1.3.1).
- headings.h1Count > 0 && headings.h1HiddenCount === headings.h1Count → Accesibilidad/medium "El <h1> está oculto en el viewport móvil" (WCAG 1.3.1 / 9.1.3.1). Indica que el elemento existe en el DOM pero tiene display:none o visibility:hidden en la resolución auditada. Cita el texto del h1 desde h1Samples.
- headings.h1Count > 1 && headings.h1HiddenCount < headings.h1Count → Accesibilidad/medium. WCAG 1.3.1 / EN 301549 9.1.3.1. Menciona el número exacto y los textos de h1Samples.
- headings.hierarchyJumps.length > 0 → Accesibilidad/medium. WCAG 1.3.1 / 9.1.3.1. Lista los saltos concretos (from→to, texto).
- landmarks.mainCount === 0 → Accesibilidad/medium "Falta <main>" (WCAG 1.3.1 / 9.1.3.1).
- landmarks.mainCount > 1 → Accesibilidad/medium "Múltiples <main>".
- landmarks.navsWithoutLabel > 0 → Accesibilidad/medium. WCAG 1.3.1 / 9.1.3.1. Menciona el número y cita un sample.
- landmarks.asideInsideMain > 0 → Accesibilidad/low "<aside> anidado dentro de <main>".
- nonSemanticInteractive.count > 0 → Accesibilidad/high (WCAG 4.1.2 / 9.4.1.2). Cita un sample.
- anchorsMisused.hashOnly > 0 → UX/medium "Enlaces con href='#' sin propósito".
- anchorsMisused.withoutHref > 0 → Accesibilidad/medium "<a> sin atributo href" (WCAG 4.1.2 / 9.4.1.2). Cita los samples de anchorsMisused.withoutHrefSamples para que el usuario pueda identificar los elementos exactos en el DOM renderizado (pueden ser elementos creados por JavaScript que no aparecen en el HTML estático).
- tabindex.positive > 0 → Accesibilidad/medium "tabindex positivo" (WCAG 2.4.3 / 9.2.4.3).
- forms.inputsWithoutLabel > 0 → Accesibilidad/high "Campos sin <label>" (WCAG 1.3.1, 3.3.2 / 9.1.3.1, 9.3.3.2). Cita un sample.
- forms.radioCheckboxGroupsWithoutFieldset > 0 → Accesibilidad/medium "Grupos de radio/checkbox sin <fieldset>/<legend>" (WCAG 1.3.1 / 9.1.3.1).
- tables.dataTablesWithoutHeaders > 0 → Accesibilidad/medium "Tablas sin <th>/<caption>" (WCAG 1.3.1 / 9.1.3.1).
- document.lang == null → Accesibilidad/medium "Falta atributo lang en <html>" (WCAG 3.1.1 / 9.3.1.1).
- document.lang != null && document.langValid === false → Accesibilidad/medium "Atributo lang inválido" (WCAG 3.1.1 / 9.3.1.1).
- document.hasTitle === false → Accesibilidad/medium "Página sin <title>" (WCAG 2.4.2 / 9.2.4.2).
- document.ariaHiddenBody === true → Accesibilidad/high "body con aria-hidden='true'" (WCAG 4.1.2 / 9.4.1.2).
- document.duplicateIds.length > 0 → Accesibilidad/medium "IDs duplicados" (WCAG 4.1.1 / 9.4.1.1). Lista los ids.

Otras reglas:
- Máximo 5 incidencias. Prioriza las de priority "high".
- Si ningún campo indica problema, devuelve [].
- title: ≤8 palabras.
- problem: 1-2 frases con los datos del JSON (números + samples). Si el JSON incluye samples con fragmentos HTML o selectores concretos (h1Samples, sample, ids, etc.), añádelos al final con el formato exacto: "\n\nCódigo:\n" seguido de los fragmentos (máx. 3, uno por línea). Ejemplo: "\n\nCódigo:\n<h1>Inicio</h1>\n<h1>Bienvenido</h1>".
- solution: 1-2 frases concretas.
- impact: 1 frase.
- yPosition: 50.
- Todos los textos en español.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SupportedMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function mediaTypeFor(filePath: string): SupportedMediaType {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

/** Escapes literal control characters (0x00-0x1f) that appear inside JSON
 *  string values. Gemini sometimes emits raw newlines / tabs inside strings
 *  instead of the `\n` / `\t` escape sequences, which makes JSON.parse throw
 *  "Bad control character in string literal". */
function sanitizeControlChars(json: string): string {
  const ESC: Record<string, string> = {
    "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f",
  };
  // Match each JSON string token (handles escaped quotes inside strings).
  // Replace any bare control character found inside with its JSON escape.
  return json.replace(/"(?:[^"\\]|\\.)*"/g, (token) =>
    token.replace(/[\x00-\x1f]/g, (c) => ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`),
  );
}

function parseJson<T>(raw: string, label: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    return JSON.parse(sanitizeControlChars(cleaned)) as T;
  } catch (err) {
    throw new Error(`Failed to parse ${label} response as JSON: ${(err as Error).message}\n\nResponse:\n${raw}`);
  }
}

// ─── Gemini helpers ───────────────────────────────────────────────────────────

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

// Reintenta 503/429 con backoff exponencial (1s, 3s, 7s). Los picos de demanda
// de Gemini suelen ser breves y se resuelven con un par de reintentos.
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /\b(503|429)\b/.test(msg) || /overloaded|unavailable|rate limit/i.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      const delayMs = Math.round(1000 * Math.pow(2, i) - 1000 + 1000); // 1s, 3s, 7s
      console.warn(`[${label}] intento ${i + 1}/${attempts} falló (${msg.split("\n")[0]}). Reintentando en ${delayMs}ms…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function geminiGenerate(systemPrompt: string, parts: GeminiPart[], modelName = "gemini-2.5-flash"): Promise<string> {
  const model = gemini.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });
  return withRetry(async () => {
    const result = await model.generateContent(parts);
    return result.response.text().trim();
  }, `gemini:${modelName}`);
}

// ─── analyzeScreenshot ────────────────────────────────────────────────────────

export async function analyzeScreenshot(
  screenshotPath: string,
  website: string,
  exclude?: ExcludeOptions,
): Promise<DetectedIssue[]> {
  const tiles = await splitIntoTiles(screenshotPath);
  const userText = `Sitio: ${website}. Identifica hasta 5 problemas de UX/UI/Accesibilidad en esta captura mobile.${excludeInstruction(exclude)}`;

  if (getProvider() === "gemini") {
    const parts: GeminiPart[] = [];
    for (const tile of tiles) {
      if (tiles.length > 1) parts.push({ text: `Sección ${tile.tileIndex + 1}/${tile.totalTiles} (${tile.startYPercent}%-${tile.endYPercent}%):` });
      parts.push({ inlineData: { mimeType: tile.mediaType, data: tile.buffer.toString("base64") } });
    }
    parts.push({ text: userText });
    const raw = await geminiGenerate(SYSTEM_PROMPT, parts);
    return parseJson<DetectedIssue[]>(raw, "Gemini analyzeScreenshot").slice(0, 5);
  }

  // Anthropic
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
  for (const tile of tiles) {
    if (tiles.length > 1) content.push({ type: "text", text: `Sección ${tile.tileIndex + 1}/${tile.totalTiles} (${tile.startYPercent}%-${tile.endYPercent}%):` });
    content.push({ type: "image", source: { type: "base64", media_type: tile.mediaType, data: tile.buffer.toString("base64") } });
  }
  content.push({ type: "text", text: userText });

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4_000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  return parseJson<DetectedIssue[]>(raw, "Claude analyzeScreenshot").slice(0, 5);
}

// ─── analyzeDualScreenshots ───────────────────────────────────────────────────

export async function analyzeDualScreenshots(
  path390: string,
  path414: string,
  website: string,
  exclude?: ExcludeOptions,
): Promise<DetectedIssueDual[]> {
  const [tiles390, tiles414] = await Promise.all([splitIntoTiles(path390), splitIntoTiles(path414)]);
  const userText = `Sitio: ${website}. Identifica hasta 5 problemas de UX/UI/Accesibilidad comparando ambas resoluciones.${excludeInstruction(exclude)}`;

  if (getProvider() === "gemini") {
    const parts: GeminiPart[] = [];
    parts.push({ text: `── 390×844 (${tiles390.length} sección/es) ──` });
    for (const tile of tiles390) {
      parts.push({ text: `Sección ${tile.tileIndex + 1}/${tile.totalTiles} (${tile.startYPercent}%-${tile.endYPercent}%):` });
      parts.push({ inlineData: { mimeType: tile.mediaType, data: tile.buffer.toString("base64") } });
    }
    parts.push({ text: `── 414×896 (${tiles414.length} sección/es) ──` });
    for (const tile of tiles414) {
      parts.push({ text: `Sección ${tile.tileIndex + 1}/${tile.totalTiles} (${tile.startYPercent}%-${tile.endYPercent}%):` });
      parts.push({ inlineData: { mimeType: tile.mediaType, data: tile.buffer.toString("base64") } });
    }
    parts.push({ text: userText });
    const raw = await geminiGenerate(DUAL_SYSTEM_PROMPT, parts);
    return parseJson<DetectedIssueDual[]>(raw, "Gemini analyzeDualScreenshots").slice(0, 5);
  }

  // Anthropic
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
  content.push({ type: "text", text: `── 390×844 (${tiles390.length} sección/es) ──` });
  for (const tile of tiles390) {
    content.push({ type: "text", text: `Sección ${tile.tileIndex + 1}/${tile.totalTiles} (${tile.startYPercent}%-${tile.endYPercent}%):` });
    content.push({ type: "image", source: { type: "base64", media_type: tile.mediaType, data: tile.buffer.toString("base64") } });
  }
  content.push({ type: "text", text: `── 414×896 (${tiles414.length} sección/es) ──` });
  for (const tile of tiles414) {
    content.push({ type: "text", text: `Sección ${tile.tileIndex + 1}/${tile.totalTiles} (${tile.startYPercent}%-${tile.endYPercent}%):` });
    content.push({ type: "image", source: { type: "base64", media_type: tile.mediaType, data: tile.buffer.toString("base64") } });
  }
  content.push({ type: "text", text: userText });

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4_000,
    system: DUAL_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  return parseJson<DetectedIssueDual[]>(raw, "Claude analyzeDualScreenshots").slice(0, 5);
}

// ─── analyzeFunctionalReport ──────────────────────────────────────────────────

export async function analyzeFunctionalReport(
  report: FunctionalReport,
  website: string,
): Promise<DetectedIssue[]> {
  const { loadTimeMs, failedResources, ...cleanReport } = report;
  const userText = `Sitio: ${website} (${report.resolution}). Informe: ${JSON.stringify(cleanReport)}`;

  if (getProvider() === "gemini") {
    const raw = await geminiGenerate(FUNCTIONAL_SYSTEM_PROMPT, [{ text: userText }]);
    return parseJson<DetectedIssue[]>(raw, "Gemini analyzeFunctionalReport").slice(0, 5);
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2_000,
    system: FUNCTIONAL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  const raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  return parseJson<DetectedIssue[]>(raw, "Claude analyzeFunctionalReport").slice(0, 5);
}

// ─── analyzeSourceCode ────────────────────────────────────────────────────────

export async function analyzeSourceCode(
  findings: StructuralFindings,
  website: string,
): Promise<DetectedIssue[]> {
  const userText = `Sitio: ${website}. Hallazgos estructurales (JSON):\n\n${JSON.stringify(findings)}`;

  if (getProvider() === "gemini") {
    const raw = await geminiGenerate(SOURCE_SYSTEM_PROMPT, [{ text: userText }]);
    return parseJson<DetectedIssue[]>(raw, "Gemini analyzeSourceCode").slice(0, 5);
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2_000,
    system: SOURCE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  const raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  return parseJson<DetectedIssue[]>(raw, "Claude analyzeSourceCode").slice(0, 5);
}
