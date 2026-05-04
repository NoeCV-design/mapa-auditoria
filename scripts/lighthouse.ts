import type { AuditPriority } from "../src/types/audit";
import type { DetectedIssue } from "./analyze";
import type { LighthouseFinding, LighthousePerformanceReport } from "./lighthouse-audit";

// ─── Score → priority ────────────────────────────────────────────────────────

function mapPriority(score: number | null): AuditPriority {
  if (score === null) return "low";
  if (score < 0.5) return "high";   // fail
  if (score < 0.9) return "medium"; // needs improvement
  return "low";
}

// ─── Copy per Lighthouse audit id ─────────────────────────────────────────────
// Keys are Lighthouse audit ids; values are [problem, solution, impact].
// Only the most frequent performance audits are covered; everything else
// falls back to the audit's own title/description.

// Tuple: [problem, solution, impact, title]
const AUDIT_COPY: Record<string, [string, string, string, string]> = {
  "largest-contentful-paint": [
    "El elemento principal visible tarda demasiado en aparecer (Largest Contentful Paint).",
    "Optimizar la imagen o bloque de texto más grande del primer viewport: servir formatos modernos (WebP/AVIF), precargar recursos críticos y eliminar CSS/JS bloqueante.",
    "Los usuarios perciben que la página es lenta y pueden abandonarla antes de ver el contenido principal.",
    "LCP elevado: pintado tardío del contenido principal",
  ],
  "cumulative-layout-shift": [
    "El contenido de la página se desplaza mientras se carga (Cumulative Layout Shift).",
    "Reservar espacio con ancho y alto explícitos en imágenes, iframes y anuncios; evitar insertar contenido sobre otro ya visible.",
    "Los usuarios hacen clic por error sobre elementos que se han movido, empeorando la usabilidad.",
    "CLS elevado: desplazamiento visual del contenido",
  ],
  "total-blocking-time": [
    "El hilo principal queda bloqueado demasiado tiempo tras el primer pintado (Total Blocking Time).",
    "Dividir JavaScript en bundles más pequeños, aplazar scripts no críticos y eliminar código no usado.",
    "La página no responde a la interacción del usuario durante los primeros segundos.",
    "TBT elevado: hilo principal bloqueado",
  ],
  "first-contentful-paint": [
    "Tarda demasiado en mostrarse el primer contenido visible (First Contentful Paint).",
    "Reducir recursos bloqueantes, optimizar el servidor y priorizar los estilos del primer viewport (CSS crítico).",
    "El usuario ve una pantalla en blanco durante demasiado tiempo al entrar en la página.",
    "FCP elevado: primer pintado tardío",
  ],
  "speed-index": [
    "La página tarda en completar la composición visual inicial (Speed Index).",
    "Reducir el peso de los recursos que afectan al primer viewport y usar carga diferida para el contenido fuera de pantalla.",
    "La experiencia percibida de carga es lenta en comparación con otros sitios.",
    "Índice de velocidad de carga elevado",
  ],
  "render-blocking-resources": [
    "Hay recursos CSS o JavaScript que bloquean el renderizado de la página.",
    "Inline del CSS crítico, cargar el resto con media=print + onload, y añadir defer o async a los scripts no esenciales.",
    "Retrasa la aparición del contenido: los usuarios ven la pantalla en blanco más tiempo.",
    "Recursos bloqueantes del renderizado",
  ],
  "unused-javascript": [
    "Se descarga JavaScript que nunca se ejecuta en la página.",
    "Aplicar code-splitting, eliminar librerías no usadas y cargar bajo demanda los módulos de rutas no visitadas.",
    "Consume datos móviles innecesariamente y ralentiza el primer renderizado.",
    "JavaScript no utilizado en la página",
  ],
  "unused-css-rules": [
    "Hay reglas CSS que no se aplican en esta página.",
    "Dividir el CSS por ruta o usar herramientas de tree-shaking (PurgeCSS, critical) para incluir sólo lo necesario.",
    "Aumenta el tamaño de descarga y retrasa el primer pintado sin aportar valor.",
    "CSS no utilizado en la página",
  ],
  "uses-optimized-images": [
    "Hay imágenes que se pueden comprimir sin pérdida de calidad visible.",
    "Re-comprimir con herramientas como Squoosh o imagemin, o servirlas desde un CDN que optimice automáticamente.",
    "Peso innecesario en la descarga: afecta sobre todo a usuarios con datos móviles limitados.",
    "Imágenes sin optimizar",
  ],
  "modern-image-formats": [
    "Las imágenes no usan formatos modernos (WebP/AVIF).",
    "Servir WebP o AVIF con <picture> y fallback a JPG/PNG para navegadores antiguos.",
    "Las imágenes pesan hasta un 30-50 % más de lo necesario.",
    "Imágenes en formato obsoleto",
  ],
  "uses-responsive-images": [
    "Se sirven imágenes más grandes de las que se muestran en pantalla.",
    "Usar srcset y sizes para servir tamaños adaptados al viewport de cada dispositivo.",
    "Especialmente costoso en móvil: descarga de datos innecesaria y primer pintado más lento.",
    "Imágenes sobredimensionadas para el viewport",
  ],
  "offscreen-images": [
    "Se cargan imágenes que están fuera del viewport inicial.",
    "Aplicar loading=\"lazy\" a las imágenes por debajo del primer viewport.",
    "Retrasa el primer pintado y malgasta datos en contenido que el usuario quizás no verá.",
    "Imágenes fuera del viewport sin carga diferida",
  ],
  "efficient-animated-content": [
    "Se usan GIFs animados en vez de vídeo.",
    "Convertir los GIFs a MP4/WebM con <video autoplay muted loop playsinline>.",
    "Los vídeos pesan hasta 10 veces menos que los GIFs equivalentes.",
    "GIFs animados en lugar de vídeo",
  ],
  "total-byte-weight": [
    "El peso total de la página es excesivo.",
    "Auditar los recursos más grandes (imágenes, bundles JS, fuentes) y optimizarlos o eliminarlos.",
    "La página carga lenta en conexiones móviles y consume datos innecesariamente.",
    "Peso total de la página excesivo",
  ],
  "dom-size": [
    "El DOM tiene demasiados nodos.",
    "Simplificar el HTML, usar paginación o virtualización para listas largas y eliminar elementos ocultos innecesarios.",
    "Aumenta el consumo de memoria y ralentiza las operaciones de layout y estilo.",
    "DOM con demasiados nodos",
  ],
  "uses-text-compression": [
    "Los recursos de texto (HTML/CSS/JS) se sirven sin compresión.",
    "Habilitar gzip o brotli en el servidor para todos los recursos de texto.",
    "Las descargas son 3-5 veces más grandes de lo necesario.",
    "Recursos de texto sin comprimir",
  ],
  "uses-long-cache-ttl": [
    "Algunos recursos estáticos tienen una caché corta o ausente.",
    "Servir recursos con versionado en el nombre y Cache-Control de al menos un año.",
    "Los usuarios recurrentes descargan archivos innecesariamente en cada visita.",
    "Caché de recursos estáticos insuficiente",
  ],
  "uses-rel-preconnect": [
    "Faltan <link rel=\"preconnect\"> para orígenes críticos de terceros.",
    "Añadir preconnect a los orígenes más usados (CDN, fuentes, analíticas) en el <head>.",
    "Se pierden cientos de ms esperando a la resolución DNS y handshake TLS.",
    "Faltan preconnects a orígenes críticos",
  ],
  "preload-lcp-image": [
    "La imagen del LCP no está precargada.",
    "Añadir <link rel=\"preload\" as=\"image\"> a la imagen principal del primer viewport.",
    "La imagen principal aparece más tarde y baja la puntuación de LCP.",
    "Imagen LCP sin precargar",
  ],
  "font-display": [
    "Las fuentes web no usan font-display: swap.",
    "Añadir font-display: swap a las @font-face para mostrar texto con fuente del sistema mientras carga la fuente personalizada.",
    "Los usuarios ven texto invisible durante varios segundos (FOIT).",
    "Fuentes web sin font-display: swap",
  ],
  "third-party-summary": [
    "El código de terceros consume demasiados recursos.",
    "Auditar los scripts de terceros y cargar bajo demanda los no esenciales (analíticas, chat, publicidad).",
    "Los scripts de terceros bloquean el hilo principal y ralentizan la interacción.",
    "Scripts de terceros excesivos",
  ],
  "bootup-time": [
    "El JavaScript tarda demasiado en ejecutarse.",
    "Reducir el tamaño de los bundles, eliminar polyfills innecesarios y aplazar lo no crítico.",
    "La página se siente lenta y no responde durante el arranque inicial.",
    "Tiempo de ejecución de JavaScript elevado",
  ],
  "mainthread-work-breakdown": [
    "El hilo principal está ocupado demasiado tiempo.",
    "Mover tareas pesadas a Web Workers o dividirlas en trozos con requestIdleCallback.",
    "La interfaz deja de responder durante la carga inicial.",
    "Hilo principal saturado en la carga inicial",
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  return words.slice(0, 8).join(" ");
}

function formatSavings(f: LighthouseFinding): string {
  const parts: string[] = [];
  if (f.savingsMs > 0) parts.push(`${Math.round(f.savingsMs)} ms`);
  if (f.savingsBytes > 0) parts.push(`${Math.round(f.savingsBytes / 1024)} KB`);
  if (f.itemsCount > 0) parts.push(`${f.itemsCount} elemento${f.itemsCount !== 1 ? "s" : ""}`);
  return parts.length > 0 ? ` Ahorro estimado: ${parts.join(" / ")}.` : "";
}

// ─── Main transform ───────────────────────────────────────────────────────────

/**
 * Converts a LighthousePerformanceReport into DetectedIssue[] — same format as
 * axeToIssues. Uses curated Spanish copy when available; falls back to the
 * audit's own title/description. Category is always "Performance". yPosition
 * defaults to 50 (no pixel context for performance issues).
 */
export function lighthouseToIssues(report: LighthousePerformanceReport): DetectedIssue[] {
  return report.failedAudits.map((f): DetectedIssue => {
    const copy = AUDIT_COPY[f.id];
    const title = copy?.[3] ?? shortTitle(f.title);

    const savings = formatSavings(f);
    const displayVal = f.displayValue ? ` Valor actual: ${f.displayValue}.` : "";

    const problem = copy ? `${copy[0]}${displayVal}${savings}` : `${f.title}.${displayVal}${savings} ${f.description}`.trim();
    const solution = copy ? copy[1] : f.description || "Revisar y optimizar el recurso afectado siguiendo las recomendaciones de Lighthouse.";
    const impact = copy ? copy[2] : "Afecta negativamente al rendimiento percibido por el usuario.";

    return {
      title,
      category: "UX",
      priority: mapPriority(f.score),
      problem,
      solution,
      impact,
      yPosition: 50,
      source: "lighthouse",
    };
  });
}
