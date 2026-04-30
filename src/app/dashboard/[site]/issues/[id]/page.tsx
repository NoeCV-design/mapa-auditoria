import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  ImageOff,
  AlertTriangle,
  Lightbulb,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fetchIssues } from "@/lib/notion";
import { isAuthenticated } from "@/lib/auth";
import { IssueActions } from "@/components/issue-actions";
import { AuditCategory, AuditPriority, AuditSource, AuditWebsite } from "@/types/audit";

const SITES: Record<string, { website: AuditWebsite; title: string }> = {
  mapa: { website: "MAPA", title: "MAPA" },
  alimentos: { website: "Alimentos", title: "Alimentos de España" },
  caminos: { website: "Caminos", title: "Caminos Naturales" },
};

const categoryStyles: Record<AuditCategory, string> = {
  UX: "text-violet-600 border-violet-200 bg-violet-50",
  UI: "text-indigo-600 border-indigo-200 bg-indigo-50",
  Performance: "text-orange-600 border-orange-200 bg-orange-50",
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
  Performance: "Rendimiento",
  Accessibility: "Accesibilidad",
  Functional: "Funcional",
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

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ site: string; id: string }>;
}) {
  const { site, id } = await params;
  const config = SITES[site];
  if (!config) notFound();

  const [issues, adminLoggedIn] = await Promise.all([
    fetchIssues(config.website),
    isAuthenticated(),
  ]);
  const issue = issues.find((i) => i.id === id);
  if (!issue) notFound();

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link
          href={`/dashboard/${site}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {config.title}
        </Link>
        <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
      </div>

      <div className="flex-1 p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8 items-start max-w-5xl mx-auto">

          {/* Columna izquierda — captura de pantalla */}
          <div className="rounded-lg border border-border overflow-hidden bg-muted aspect-[390/844] flex items-center justify-center sticky top-6">
            {issue.screenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={issue.screenshot}
                alt={issue.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageOff className="w-6 h-6" />
                <span className="text-xs">Sin captura</span>
              </div>
            )}
          </div>

          {/* Columna derecha — contenido */}
          <div className="space-y-6">

            {/* Title + meta */}
            <div className="space-y-3">
              <h1 className="text-xl font-semibold text-foreground leading-snug">
                {issue.title}
              </h1>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs font-medium text-muted-foreground border-border">
                  {config.title}
                </Badge>
                <Badge variant="outline" className={`text-xs font-medium ${categoryStyles[issue.category]}`}>
                  {categoryLabels[issue.category]}
                </Badge>
                <Badge variant="outline" className={`text-xs font-medium ${priorityStyles[issue.priority]}`}>
                  {priorityLabels[issue.priority]}
                </Badge>
                {issue.source && (
                  <Badge variant="outline" className={`text-xs font-medium ${sourceStyles[issue.source]}`}>
                    {sourceLabels[issue.source]}
                  </Badge>
                )}
                {issue.url && (
                  <>
                    <Separator orientation="vertical" className="h-4" />
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {issue.url}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>
            </div>

            {adminLoggedIn && (
              <IssueActions issue={issue} site={site} />
            )}

            <Separator />

            {/* Problem / Impact / Solution */}
            <div className="space-y-5">
              <section className="space-y-1.5">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  Problema
                </h2>
                {(() => {
                  const [desc, code] = issue.problem.split(/\n\nCódigo:\n/);
                  return (
                    <>
                      <p className="text-sm text-foreground leading-relaxed">{desc}</p>
                      {code && (
                        <pre className="mt-2 rounded-md bg-muted border border-border px-4 py-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                          {code}
                        </pre>
                      )}
                    </>
                  );
                })()}
              </section>

              <section className="space-y-1.5">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Target className="w-3.5 h-3.5 text-amber-500" />
                  Impacto
                </h2>
                <p className="text-sm text-foreground leading-relaxed">{issue.impact}</p>
              </section>

              <section className="space-y-1.5">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="w-3.5 h-3.5 text-green-500" />
                  Solución
                </h2>
                <p className="text-sm text-foreground leading-relaxed">{issue.solution}</p>
              </section>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
