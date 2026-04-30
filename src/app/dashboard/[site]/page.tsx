import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { IssuesList } from "@/components/issues-list";
import { fetchIssues } from "@/lib/notion";
import { isAuthenticated } from "@/lib/auth";
import { AuditWebsite } from "@/types/audit";

type SiteConfig = {
  website: AuditWebsite | "all";
  title: string;
  description: string;
};

const SITES: Record<string, SiteConfig> = {
  todas: {
    website: "all",
    title: "Todas las webs",
    description: "Vista agregada — MAPA · Alimentos de España · Caminos Naturales",
  },
  mapa: {
    website: "MAPA",
    title: "MAPA",
    description: "mapa.gob.es — Auditoría UX mobile",
  },
  alimentos: {
    website: "Alimentos",
    title: "Alimentos de España",
    description: "alimentacion.gob.es — Auditoría UX mobile",
  },
  caminos: {
    website: "Caminos",
    title: "Caminos Naturales",
    description: "caminosnaturales.mapa.gob.es — Auditoría UX mobile",
  },
};

export function generateStaticParams() {
  return Object.keys(SITES).map((site) => ({ site }));
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  const config = SITES[site];
  if (!config) notFound();

  const isAggregated = config.website === "all";
  const [issues, isAdmin] = await Promise.all([
    fetchIssues(config.website),
    isAuthenticated(),
  ]);

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title={config.title} description={`${config.description} · ${issues.length} ${issues.length !== 1 ? "incidencias" : "incidencia"}`}>
        {isAdmin && !isAggregated && (
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/${site}/audit`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-foreground text-xs font-medium hover:bg-muted transition-colors"
            >
              <ScanSearch className="w-3.5 h-3.5" />
              Auditar URL
            </Link>
            <Link
              href={`/dashboard/${site}/new`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Añadir incidencia
            </Link>
          </div>
        )}
      </PageHeader>
      <div className="flex-1 p-6">
        <Suspense>
          <IssuesList issues={issues} site={site} />
        </Suspense>
      </div>
    </div>
  );
}
