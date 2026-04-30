import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { IssueForm } from "@/components/issue-form";
import { AuditWebsite } from "@/types/audit";

const SITES: Record<string, { website: AuditWebsite; title: string }> = {
  mapa: { website: "MAPA", title: "MAPA" },
  alimentos: { website: "Alimentos", title: "Alimentos de España" },
  caminos: { website: "Caminos", title: "Caminos Naturales" },
};

export default async function NewIssuePage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  const config = SITES[site];
  if (!config) notFound();

  return (
    <div className="flex flex-col flex-1">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link
          href={`/dashboard/${site}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {config.title}
        </Link>
        <span className="text-xs text-muted-foreground">Nueva incidencia</span>
      </div>

      <div className="flex-1 p-6">
        <div className="max-w-xl">
          <h1 className="text-lg font-semibold text-foreground mb-6">Añadir incidencia</h1>
          <IssueForm defaultWebsite={config.website} />
        </div>
      </div>
    </div>
  );
}
