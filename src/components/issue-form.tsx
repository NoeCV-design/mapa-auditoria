"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { createIssue } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AuditPriority, AuditWebsite } from "@/types/audit";

const WEBSITES: AuditWebsite[] = ["MAPA", "Alimentos", "Caminos"];
const CATEGORIES = ["UX", "UI", "Accessibility", "Functional"] as const;

// Etiquetas de prioridad (consistentes con dashboard-tabs, issues-list y
// la vista de detalle). El orden visual y los `value` son distintos, así
// que el <SelectValue> necesita mapear para pintar el label correcto.
const PRIORITY_LABELS: Record<AuditPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

type ResOption = "390x844" | "414x896";

function ResolutionPicker() {
  const [selected, setSelected] = useState<Set<ResOption>>(new Set(["390x844"]));
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle(opt: ResOption) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) {
        if (next.size === 1) return prev; // always keep at least one
        next.delete(opt);
      } else {
        next.add(opt);
      }
      return next;
    });
  }

  const value = selected.size === 2 ? "ambas" : [...selected][0];
  const label =
    selected.size === 2
      ? "Ambas (390×844 y 414×896)"
      : selected.has("390x844")
      ? "390×844 (iPhone 13)"
      : "414×896 (iPhone XR)";

  const options: { value: ResOption; label: string }[] = [
    { value: "390x844", label: "390×844 (iPhone 13)" },
    { value: "414x896", label: "414×896 (iPhone XR)" },
  ];

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name="resolution" value={value} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span>{label}</span>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-md">
          {options.map((opt) => {
            const checked = selected.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input">
                  {checked && <Check className="h-3 w-3" />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type CaptureMode = "auto" | "upload";

function ScreenshotPicker() {
  const [mode, setMode] = useState<CaptureMode>("auto");
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode("auto")}
          className={cn(
            "px-3 py-1 rounded-md transition-colors",
            mode === "auto" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Capturar desde URL
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={cn(
            "px-3 py-1 rounded-md transition-colors",
            mode === "upload" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Subir archivo
        </button>
      </div>

      {mode === "auto" ? (
        <p className="text-xs text-muted-foreground">
          Se capturará automáticamente desde la URL indicada (viewport iPhone 13).
        </p>
      ) : (
        <>
          <Input
            name="screenshotFile"
            type="file"
            accept="image/png,image/jpeg"
            className="h-9 text-sm file:mr-3 file:text-xs file:text-muted-foreground"
            required
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          {fileName && (
            <p className="text-xs text-muted-foreground truncate">Archivo: {fileName}</p>
          )}
        </>
      )}
    </div>
  );
}

export function IssueForm({ defaultWebsite }: { defaultWebsite?: AuditWebsite }) {
  const [, action, pending] = useActionState(async (_: unknown, formData: FormData) => {
    await createIssue(formData);
  }, null);

  return (
    <form action={action} className="space-y-5 max-w-xl">
      {/* Website */}
      <Field label="Web">
        <Select name="website" defaultValue={defaultWebsite ?? "MAPA"} required>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEBSITES.map((w) => (
              <SelectItem key={w} value={w}>{w}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* URL */}
      <Field label="URL de la pantalla">
        <Input
          name="pageUrl"
          type="url"
          placeholder="https://www.mapa.gob.es/es/alimentacion/"
          className="h-9 text-sm font-mono"
          required
        />
      </Field>

      {/* Captura: auto desde URL o archivo subido */}
      <Field label="Captura de pantalla">
        <ScreenshotPicker />
      </Field>

      {/* Title */}
      <Field label="Título">
        <Input name="title" placeholder="Título breve y descriptivo" className="h-9 text-sm" required />
      </Field>

      {/* Resolution */}
      <Field label="Resolución">
        <ResolutionPicker />
      </Field>

      {/* Category + Priority */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Categoría">
          <Select name="category" defaultValue="UX" required>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Prioridad">
          <Select name="priority" defaultValue="medium" required>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue>
                {(value: unknown) =>
                  typeof value === "string" && value in PRIORITY_LABELS
                    ? PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS]
                    : ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRIORITY_LABELS) as (keyof typeof PRIORITY_LABELS)[]).map((v) => (
                <SelectItem key={v} value={v}>
                  {PRIORITY_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Problem */}
      <Field label="Problema">
        <Textarea
          name="problem"
          placeholder="¿Qué está mal?"
          rows={3}
          className="text-sm"
          required
        />
      </Field>

      {/* Impact */}
      <Field label="Impacto">
        <Textarea
          name="impact"
          placeholder="¿Por qué importa?"
          rows={2}
          className="text-sm"
          required
        />
      </Field>

      {/* Solution */}
      <Field label="Solución">
        <Textarea
          name="solution"
          placeholder="¿Cómo solucionarlo?"
          rows={3}
          className="text-sm"
          required
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Capturando screenshot y guardando…" : "Añadir incidencia"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </Label>
      {children}
    </div>
  );
}
