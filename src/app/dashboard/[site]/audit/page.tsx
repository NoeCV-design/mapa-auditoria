"use client";

import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle, Loader2, Terminal } from "lucide-react";
import { AuditWebsite } from "@/types/audit";

const SITES: Record<string, { website: AuditWebsite; title: string }> = {
  mapa: { website: "MAPA", title: "MAPA" },
  alimentos: { website: "Alimentos", title: "Alimentos de España" },
  caminos: { website: "Caminos", title: "Caminos Naturales" },
};

type State = "idle" | "running" | "done" | "error";

export default function AuditPage() {
  const params = useParams<{ site: string }>();
  const router = useRouter();
  const site = params.site ?? "mapa";
  const config = SITES[site];

  const [state, setState] = useState<State>("idle");
  const [output, setOutput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim();
    if (!url) return;

    setState("running");
    setOutput("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, website: config?.website ?? "MAPA" }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        setErrorMsg(error ?? "Error desconocido");
        setState("error");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let exitCode = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });

        // Extract exit code sentinel
        if (text.includes("__EXIT__")) {
          const match = text.match(/__EXIT__(\d+)/);
          exitCode = match ? parseInt(match[1]) : 1;
          const clean = text.replace(/__EXIT__\d+/, "");
          if (clean) setOutput((p) => p + clean);
        } else {
          setOutput((p) => p + text);
        }

        // Auto-scroll
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      }

      setState(exitCode === 0 ? "done" : "error");
      if (exitCode !== 0) setErrorMsg("El proceso terminó con errores.");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setState("error");
    }
  }

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
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">Auditar URL</h1>
            <p className="text-sm text-muted-foreground">
              Captura una pantalla mobile y analiza automáticamente los problemas de UX con IA.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          {state === "done" && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Auditoría completada. Las incidencias ya están en Notion.
              <button
                onClick={() => router.push(`/dashboard/${site}`)}
                className="ml-auto text-xs underline hover:no-underline"
              >
                Ver dashboard
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
                disabled={state === "running"}
                placeholder="https://www.mapa.gob.es/..."
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={state === "running"}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed w-full"
            >
              {state === "running" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analizando…
                </>
              ) : (
                "Iniciar auditoría"
              )}
            </button>
          </form>

          {(state === "running" || output) && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Terminal className="w-3.5 h-3.5" />
                Salida del proceso
              </div>
              <pre
                ref={outputRef}
                className="h-72 overflow-y-auto rounded-md border border-border bg-muted p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-all"
              >
                {output || "Iniciando…"}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
