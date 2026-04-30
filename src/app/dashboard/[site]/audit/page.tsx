"use client";

import { useActionState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { auditUrl } from "@/app/actions";
import { AuditWebsite } from "@/types/audit";

const SITES: Record<string, { website: AuditWebsite; title: string }> = {
  mapa: { website: "MAPA", title: "MAPA" },
  alimentos: { website: "Alimentos", title: "Alimentos de España" },
  caminos: { website: "Caminos", title: "Caminos Naturales" },
};

export default function AuditPage() {
  const params = useParams<{ site: string }>();
  const site = params.site ?? "mapa";
  const config = SITES[site];

  const [error, formAction, isPending] = useActionState(auditUrl, null);

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <Link
          href={`/dashboard/${site}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {config?.title ?? site}
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs font-medium text-foreground">Auditar URL</span>
      </div>

      <div className="flex-1 flex items-start justify-center p-8">
        <div className="w-full max-w-lg space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">Auditar URL</h1>
            <p className="text-sm text-muted-foreground">
              Captura una pantalla mobile y analiza automáticamente los problemas de UX con IA.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            {/* Hidden website */}
            <input type="hidden" name="website" value={config?.website ?? "MAPA"} />

            <div className="space-y-1.5">
              <label htmlFor="url" className="text-xs font-medium text-foreground">
                URL a auditar
              </label>
              <input
                id="url"
                name="url"
                type="url"
                required
                placeholder="https://www.mapa.gob.es/..."
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <fieldset className="space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-foreground">
                Excluir del análisis
              </legend>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  name="excludeHeader"
                  value="1"
                  className="h-4 w-4 accent-primary"
                />
                Contenido del <code className="text-xs">&lt;header&gt;</code>
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  name="excludeFooter"
                  value="1"
                  className="h-4 w-4 accent-primary"
                />
                Contenido del <code className="text-xs">&lt;footer&gt;</code>
              </label>
              <p className="text-[11px] text-muted-foreground pt-1">
                Útil para no repetir incidencias compartidas por todas las URLs del sitio.
              </p>
            </fieldset>

            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed w-full"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analizando…
                </>
              ) : (
                "Iniciar auditoría"
              )}
            </button>
          </form>

          {isPending && (
            <p className="text-xs text-muted-foreground text-center">
              Capturando pantalla y analizando con IA. Esto puede tardar unos segundos…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
