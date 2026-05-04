import type { AuditPriority } from "../src/types/audit";
import type { DetectedIssue } from "./analyze";
import type { AxeReport, AxeViolation } from "./functional-audit";

// ─── Impact → priority ────────────────────────────────────────────────────────

function mapPriority(impact: AxeViolation["impact"]): AuditPriority {
  if (impact === "critical" || impact === "serious") return "high";
  if (impact === "moderate") return "medium";
  return "low";
}

// ─── Plain-language descriptions per rule ID ──────────────────────────────────
// Maps the most common axe rule IDs to concise, non-technical Spanish text.
// Keys are axe rule ids; values are [problem, solution, impact].

// Tuple: [problem, solution, impact, title]
const RULE_COPY: Record<string, [string, string, string, string]> = {
  "image-alt": [
    "Hay imágenes sin texto alternativo.",
    "Añadir un atributo alt descriptivo a cada imagen que transmita información.",
    "Los usuarios con lector de pantalla no pueden entender el contenido de las imágenes.",
    "Imágenes sin texto alternativo",
  ],
  "button-name": [
    "Hay botones sin nombre accesible.",
    "Añadir un texto visible, aria-label o aria-labelledby a cada botón.",
    "Los usuarios de tecnologías de asistencia no saben qué hace el botón.",
    "Botones sin nombre accesible",
  ],
  "link-name": [
    "Hay enlaces sin texto o con texto poco descriptivo.",
    "Añadir texto al enlace o un aria-label que describa su destino.",
    "Los usuarios de lector de pantalla no pueden identificar el destino del enlace.",
    "Enlaces sin texto descriptivo",
  ],
  "label": [
    "Hay campos de formulario sin etiqueta asociada.",
    "Vincular un <label> a cada campo de formulario o usar aria-label.",
    "Los usuarios con discapacidad visual no saben qué dato pide el formulario.",
    "Campos de formulario sin etiqueta",
  ],
  "color-contrast": [
    "El contraste entre el texto y el fondo es insuficiente.",
    "Aumentar el contraste del texto hasta al menos 4,5:1 (WCAG 1.4.3).",
    "El texto es difícil de leer para usuarios con baja visión o en entornos con mucha luz.",
    "Contraste de texto insuficiente",
  ],
  "color-contrast-enhanced": [
    "El contraste de texto no cumple el nivel AAA (7:1).",
    "Aumentar el contraste del texto hasta 7:1 para cumplir WCAG 1.4.6 AAA.",
    "El texto es difícil de leer para usuarios con baja visión severa.",
    "Contraste insuficiente nivel AAA",
  ],
  "landmark-one-main": [
    "La página no tiene un punto de referencia principal (<main>).",
    "Añadir un único elemento <main> que envuelva el contenido principal de la página.",
    "Los usuarios de lector de pantalla no pueden saltar directamente al contenido principal.",
    "Falta región principal <main>",
  ],
  "landmark-complementary-is-top-level": [
    "Los elementos complementarios (<aside>) no están en el nivel correcto.",
    "Mover los elementos <aside> fuera de la región <main> o envolverlos correctamente.",
    "La estructura de la página es confusa para usuarios de tecnologías de asistencia.",
    "Elemento <aside> mal ubicado",
  ],
  "region": [
    "Hay contenido fuera de las regiones de referencia (landmark regions).",
    "Envolver todo el contenido en regiones semánticas: <main>, <nav>, <header>, <footer>.",
    "Los usuarios de lector de pantalla no pueden navegar correctamente por la página.",
    "Contenido fuera de regiones landmark",
  ],
  "heading-order": [
    "Los niveles de los encabezados no siguen una jerarquía correcta.",
    "Usar los encabezados (<h1>–<h6>) en orden consecutivo sin saltar niveles.",
    "Dificulta la comprensión de la estructura del contenido para usuarios de lector de pantalla.",
    "Jerarquía de encabezados incorrecta",
  ],
  "html-has-lang": [
    "La página no declara el idioma del documento.",
    "Añadir el atributo lang al elemento <html> (p. ej., lang=\"es\").",
    "Los lectores de pantalla pueden pronunciar el contenido en el idioma incorrecto.",
    "Idioma de página sin declarar",
  ],
  "html-lang-valid": [
    "El atributo lang del documento tiene un valor inválido.",
    "Usar un código de idioma BCP 47 válido (p. ej., lang=\"es\" o lang=\"es-ES\").",
    "Los lectores de pantalla pueden pronunciar el contenido incorrectamente.",
    "Atributo lang inválido",
  ],
  "document-title": [
    "La página no tiene un título (<title>) descriptivo.",
    "Añadir un <title> único y descriptivo a cada página.",
    "Los usuarios no pueden identificar la página en la barra del navegador ni en los resultados de búsqueda.",
    "Página sin título descriptivo",
  ],
  "frame-title": [
    "Hay iframes sin título descriptivo.",
    "Añadir un atributo title descriptivo a cada <iframe>.",
    "Los usuarios de lector de pantalla no pueden saber qué contenido muestra el iframe.",
    "Iframes sin título",
  ],
  "duplicate-id": [
    "Hay elementos con el mismo atributo id en la página.",
    "Asegurarse de que cada id es único en toda la página.",
    "Puede causar comportamientos inesperados en formularios, anclas y lectores de pantalla.",
    "IDs duplicados en la página",
  ],
  "aria-required-attr": [
    "Hay elementos ARIA que les falta un atributo obligatorio.",
    "Añadir los atributos aria- requeridos según el rol del elemento.",
    "Los lectores de pantalla no pueden comunicar correctamente el estado del componente.",
    "Atributos ARIA requeridos ausentes",
  ],
  "aria-valid-attr-value": [
    "Hay atributos ARIA con valores incorrectos.",
    "Corregir los valores de los atributos aria- según la especificación ARIA.",
    "Los lectores de pantalla pueden transmitir información incorrecta al usuario.",
    "Valores de atributos ARIA incorrectos",
  ],
  "aria-hidden-body": [
    "El elemento <body> tiene aria-hidden=\"true\".",
    "Eliminar el atributo aria-hidden del elemento <body>.",
    "Todo el contenido de la página queda oculto para los lectores de pantalla.",
    "Body oculto con aria-hidden",
  ],
  "focus-order-semantics": [
    "El orden de foco no sigue el orden visual del contenido.",
    "Reorganizar el DOM o usar tabindex para que el foco siga el orden lógico de lectura.",
    "Los usuarios de teclado pueden desorientarse al navegar por la página.",
    "Orden de foco incorrecto",
  ],
  "focusable-content": [
    "Hay elementos interactivos que no se pueden enfocar con el teclado.",
    "Asegurarse de que todos los controles interactivos son accesibles por teclado.",
    "Los usuarios que no usan ratón no pueden interactuar con estos elementos.",
    "Elementos interactivos no enfocables",
  ],
  "tabindex": [
    "Hay elementos con un valor de tabindex mayor que 0.",
    "Usar tabindex=\"0\" o -1; nunca valores positivos que alteran el orden natural.",
    "Interrumpe el flujo de navegación por teclado y confunde a los usuarios.",
    "Valores de tabindex positivos",
  ],
  "target-size": [
    "Hay elementos interactivos con un área de toque demasiado pequeña.",
    "Asegurarse de que botones y enlaces tienen al menos 24×24 px de área tocable (WCAG 2.5.8).",
    "Los usuarios con dificultades motoras tienen problemas para pulsar el elemento correctamente.",
    "Área de toque demasiado pequeña",
  ],
  "scrollable-region-focusable": [
    "Hay zonas con scroll que no son accesibles con el teclado.",
    "Añadir tabindex=\"0\" a las zonas desplazables para que sean alcanzables por teclado.",
    "Los usuarios de teclado no pueden acceder al contenido dentro de estas zonas.",
    "Zonas con scroll no accesibles por teclado",
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate to ≤8 words */
function shortTitle(help: string): string {
  const words = help.trim().split(/\s+/);
  return words.slice(0, 8).join(" ");
}

/**
 * Extract the first actionable line from an axe failureSummary.
 * Summaries look like:
 *   "Fix any of the following:\n  Element does not have …\n  aria-label …"
 * We skip the header line and return the first concrete finding.
 */
function firstFinding(failureSummary: string | undefined): string {
  if (!failureSummary) return "";
  return failureSummary
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Fix (any|all|one) of/i.test(l))
    .at(0) ?? "";
}

/**
 * Builds a readable element reference from axe node targets.
 * Takes the last (most specific) selector in each target chain,
 * skips selectors that are too long to be useful, and joins up to `max` items.
 * Returns an empty string if no usable selectors exist.
 */
function nodeTargets(nodes: AxeViolation["nodes"], max = 3): string {
  return nodes
    .slice(0, max)
    .map((n) => n.target.at(-1) ?? "")
    .filter((s) => s.length > 0 && s.length <= 60)
    .join(", ");
}

// ─── Main transform ───────────────────────────────────────────────────────────

/**
 * Converts an AxeReport (from runFunctionalAudit) into DetectedIssue[],
 * the same format produced by Claude visual/functional analysis.
 *
 * One issue per violation rule — nodes.length tells how many elements failed.
 * Descriptions are plain Spanish; yPosition defaults to 50 (no pixel context).
 */
export function axeToIssues(report: AxeReport): DetectedIssue[] {
  return report.violations.map((v): DetectedIssue => {
    const priority = mapPriority(v.impact);
    const count = v.nodes.length;
    const plural = count !== 1;

    const copy = RULE_COPY[v.id];
    const title = copy?.[3] ?? shortTitle(v.help);
    const targets = nodeTargets(v.nodes);

    // Problem: prefer curated copy, fall back to axe help + count
    // Append element references when available to make the issue concrete.
    const elemSuffix = targets
      ? ` Elementos afectados: ${targets}${count > 3 ? "…" : ""}.`
      : count > 1
        ? ` Afecta a ${count} elementos.`
        : "";
    const problem = copy
      ? `${copy[0]}${elemSuffix}`
      : `${v.help}. ${count} elemento${plural ? "s" : ""}${targets ? `: ${targets}${count > 3 ? "…" : ""}` : ""}.`;

    // Solution: prefer curated copy, fall back to first axe finding
    const rawFinding = firstFinding(v.nodes[0]?.failureSummary);
    const solution = copy
      ? copy[1]
      : rawFinding
        ? `${rawFinding.charAt(0).toUpperCase()}${rawFinding.slice(1)}.`
        : "Revisar y corregir los elementos afectados según las pautas WCAG 2.2.";

    // Impact: prefer curated copy, fall back to generic
    const impact = copy
      ? copy[2]
      : "Dificulta el acceso a usuarios con tecnologías de asistencia o discapacidades visuales.";

    return {
      title,
      category: "Accesibilidad",
      priority,
      problem,
      solution,
      impact,
      yPosition: v.yPercent,
      source: "axe",
    };
  });
}
