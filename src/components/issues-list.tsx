"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuditIssue, AuditCategory, AuditPriority, AuditResolution, AuditSource, AuditStatus, AuditWebsite } from "@/types/audit";

const CATEGORIES: AuditCategory[] = ["UX", "UI", "Accessibility", "Functional"];
const PRIORITIES: AuditPriority[] = ["low", "medium", "high", "critical"];
const RESOLUTIONS: AuditResolution[] = ["390x844", "414x896", "ambas"];

const websiteToSlug: Record<AuditWebsite, string> = {
  MAPA: "mapa",
  Alimentos: "alimentos",
  Caminos: "caminos",
};

const websiteLabels: Record<AuditWebsite, string> = {
  MAPA: "MAPA",
  Alimentos: "Alimentos de España",
  Caminos: "Caminos Naturales",
};

const categoryStyles: Record<AuditCategory, string> = {
  UX: "text-violet-600 border-violet-200 bg-violet-50",
  UI: "text-indigo-600 border-indigo-200 bg-indigo-50",
  Accessibility: "text-teal-600 border-teal-200 bg-teal-50",
  Functional: "text-rose-600 border-rose-200 bg-rose-50",
};

const priorityStyles: Record<AuditPriority, string> = {
  low: "text-muted-foreground border-border",
  medium: "text-amber-600 border-amber-200 bg-amber-50",
  high: "text-red-600 border-red-200 bg-red-50",
  critical: "text-purple-700 border-purple-300 bg-purple-50",
};

const priorityLabels: Record<AuditPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const categoryLabels: Record<AuditCategory, string> = {
  UX: "UX",
  UI: "UI",
  Accessibility: "Accesibilidad",
  Functional: "Funcional",
};

const statusLabels: Record<AuditStatus, string> = {
  todo: "Pendiente",
  in_progress: "En curso",
  done: "Resuelta",
};

const resolutionLabels: Record<AuditResolution, string> = {
  "390x844": "390x844",
  "414x896": "414x896",
  ambas: "Ambas",
};

const resolutionStyles: Record<AuditResolution, string> = {
  "390x844": "text-sky-600 border-sky-200 bg-sky-50",
  "414x896": "text-purple-600 border-purple-200 bg-purple-50",
  "ambas": "text-gray-600 border-gray-200 bg-gray-50",
};

const sourceLabels: Record<AuditSource, string> = {
  visual: "Visual AI",
  functional: "Funcional",
  structural: "Estructural",
  axe: "Axe",
  lighthouse: "Lighthouse",
  manual: "Manual",
};

const sourceStyles: Record<AuditSource, string> = {
  visual: "text-fuchsia-600 border-fuchsia-200 bg-fuchsia-50",
  functional: "text-blue-600 border-blue-200 bg-blue-50",
  structural: "text-emerald-600 border-emerald-200 bg-emerald-50",
  axe: "text-orange-600 border-orange-200 bg-orange-50",
  lighthouse: "text-red-600 border-red-200 bg-red-50",
  manual: "text-gray-600 border-gray-200 bg-gray-50",
};

type FilterAll = "all";

function downloadCSV(issues: AuditIssue[], site: string) {
  const SEP = ";"; // punto y coma para Excel con locale español
  const headers = [
    "ID",
    "Título",
    "Web",
    "URL",
    "Categoría",
    "Prioridad",
    "Estado",
    "Resolución",
    "Origen",
    "Problema",
    "Impacto",
    "Solución",
    "Captura",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = issues.map((i) => [
    escape(i.id),
    escape(i.title),
    escape(websiteLabels[i.website] ?? i.website),
    escape(i.url),
    escape(categoryLabels[i.category] ?? i.category),
    escape(priorityLabels[i.priority] ?? i.priority),
    escape(statusLabels[i.status] ?? i.status),
    escape(i.resolution ? resolutionLabels[i.resolution] ?? i.resolution : ""),
    escape(i.source ? sourceLabels[i.source] ?? i.source : ""),
    escape(i.problem ?? ""),
    escape(i.impact ?? ""),
    escape(i.solution ?? ""),
    escape(i.screenshot ?? ""),
  ]);
  const csv = [headers.join(SEP), ...rows.map((r) => r.join(SEP))].join("\r\n");
  // BOM para que Excel abra correctamente con UTF-8
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `incidencias-${site}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type SortDir = "asc" | "desc" | null;

export function IssuesList({ issues, site }: { issues: AuditIssue[]; site: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAllSites = site === "todas";

  // URL is the single source of truth — survives back-navigation from a detail page.
  const category = (searchParams.get("category") as AuditCategory | FilterAll | null) ?? "all";
  const priority = (searchParams.get("priority") as AuditPriority | FilterAll | null) ?? "all";
  const resolution = (searchParams.get("resolution") as AuditResolution | FilterAll | null) ?? "all";
  const source = (searchParams.get("source") as AuditSource | FilterAll | null) ?? "all";
  const [urlFilter, setUrlFilter] = useState(searchParams.get("url") ?? "");
  const sortParam = searchParams.get("sort");
  const sortDir: SortDir = sortParam === "asc" || sortParam === "desc" ? sortParam : null;

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "all") params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const filtered = useMemo(() => {
    const needle = urlFilter.trim().toLowerCase();
    const base = issues.filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (priority === "all" || i.priority === priority) &&
        (resolution === "all" ||
          i.resolution === resolution ||
          i.resolution === "ambas") &&
        (source === "all" || i.source === source) &&
        (!needle || i.url.toLowerCase().includes(needle))
    );
    if (!sortDir) return base;
    const sorted = [...base].sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [issues, category, priority, resolution, source, urlFilter, sortDir]);

  function toggleIdSort() {
    const next: SortDir = sortDir === null ? "asc" : sortDir === "asc" ? "desc" : null;
    updateParam("sort", next);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters row */}
      <div className="flex items-center gap-2">
        {/* Contador — izquierda */}
        <span className="text-xs text-muted-foreground shrink-0">
          {filtered.length} {filtered.length === 1 ? "incidencia" : "incidencias"}
        </span>

        {/* Filtros */}
        <Select value={category} onValueChange={(v) => updateParam("category", v)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue>
              {category === "all" ? "Todas las categorías" : categoryLabels[category as AuditCategory]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{categoryLabels[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={(v) => updateParam("priority", v)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue>
              {priority === "all" ? "Todas las prioridades" : priorityLabels[priority as AuditPriority]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las prioridades</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{priorityLabels[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={resolution} onValueChange={(v) => updateParam("resolution", v)}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue>
              {resolution === "all" ? "Todas las resoluciones" : resolution}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las resoluciones</SelectItem>
            {RESOLUTIONS.map((r) => (
              <SelectItem key={r} value={r}>{resolutionLabels[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          type="text"
          value={urlFilter}
          onChange={(e) => setUrlFilter(e.target.value)}
          placeholder="Filtrar por URL…"
          className="h-8 w-56 rounded-md border border-input bg-background px-3 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />

        {/* Descargar CSV — derecha */}
        <button
          onClick={() => downloadCSV(filtered, site)}
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Descargar CSV
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
          Ninguna incidencia coincide con los filtros aplicados.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-24 text-xs font-medium">
                  <button
                    type="button"
                    onClick={toggleIdSort}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    ID
                    {sortDir === "asc" ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : sortDir === "desc" ? (
                      <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-xs font-medium">Título</TableHead>
                {isAllSites && <TableHead className="w-32 text-xs font-medium">Web</TableHead>}
                <TableHead className="w-36 text-xs font-medium">Categoría</TableHead>
                <TableHead className="w-28 text-xs font-medium">Prioridad</TableHead>
                <TableHead className="w-28 text-xs font-medium">Resolución</TableHead>
                <TableHead className="w-28 text-xs font-medium">Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((issue) => {
                const issueSiteSlug = isAllSites ? websiteToSlug[issue.website] : site;
                const issueHref = `/dashboard/${issueSiteSlug}/issues/${issue.id}`;
                return (
                <TableRow key={issue.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <Link href={issueHref} className="block hover:underline">
                      {issue.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={issueHref} className="block group">
                      <p className="text-sm font-medium text-foreground leading-snug group-hover:underline">
                        {issue.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate max-w-xs">
                        {issue.url}
                      </p>
                    </Link>
                  </TableCell>
                  {isAllSites && (
                    <TableCell className="text-xs text-muted-foreground">
                      {websiteLabels[issue.website]}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant="outline" className={`text-xs font-medium ${categoryStyles[issue.category]}`}>
                      {categoryLabels[issue.category]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs font-medium ${priorityStyles[issue.priority]}`}>
                      {priorityLabels[issue.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {issue.resolution === "ambas" ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={`text-xs font-mono font-medium ${resolutionStyles["390x844"]}`}>
                          390
                        </Badge>
                        <Badge variant="outline" className={`text-xs font-mono font-medium ${resolutionStyles["414x896"]}`}>
                          414
                        </Badge>
                      </div>
                    ) : issue.resolution ? (
                      <Badge variant="outline" className={`text-xs font-mono font-medium ${resolutionStyles[issue.resolution]}`}>
                        {issue.resolution === "390x844" ? "390" : "414"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {issue.source ? (
                      <Badge variant="outline" className={`text-xs font-medium ${sourceStyles[issue.source]}`}>
                        {sourceLabels[issue.source]}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
