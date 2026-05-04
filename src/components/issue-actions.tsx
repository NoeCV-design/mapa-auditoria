"use client";

import { useState, useActionState, useTransition, useRef } from "react";
import { Pencil, Trash2, X, Loader2, CheckCircle2, ImagePlus } from "lucide-react";
import { updateIssue, deleteIssue } from "@/app/actions";
import type { AuditIssue, AuditCategory, AuditPriority, AuditStatus, AuditResolution } from "@/types/audit";

const CATEGORIES: AuditCategory[] = ["UX", "UI", "Accesibilidad", "Funcional"];
const CATEGORY_LABELS: Record<AuditCategory, string> = {
  UX: "UX",
  UI: "UI",
  Accesibilidad: "Accesibilidad",
  Funcional: "Funcional",
};
const PRIORITY_LABELS: Record<AuditPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};
const STATUS_LABELS: Record<AuditStatus, string> = {
  todo: "Pendiente",
  in_progress: "En progreso",
  done: "Hecho",
};
const RESOLUTION_LABELS: Record<AuditResolution, string> = {
  "390x844": "390×844 (iPhone 13)",
  "414x896": "414×896 (iPhone XR)",
  "ambas": "Ambas resoluciones",
};

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const selectCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

export function IssueActions({
  issue,
  site,
}: {
  issue: AuditIssue;
  site: string;
}) {
  const [mode, setMode] = useState<"idle" | "edit" | "delete">("idle");
  const [updateState, updateAction, updatePending] = useActionState(updateIssue, null);
  const [deletePending, startDelete] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // After a successful update the server returns null and invalidates cache.
  // Next.js re-renders the RSC; the client just shows a brief success state.
  const updateSuccess = updateState === null && !updatePending && mode === "edit";

  function handleCloseEdit() {
    setMode("idle");
  }

  return (
    <div className="space-y-3">
      {/* Action bar */}
      {mode === "idle" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </button>
          <button
            type="button"
            onClick={() => setMode("delete")}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Eliminar
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {mode === "delete" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-700">
            ¿Eliminar esta incidencia? La acción no se puede deshacer.
          </p>
          <div className="flex items-center gap-2">
            <form
              action={(fd) => {
                startDelete(async () => {
                  await deleteIssue(fd);
                });
              }}
            >
              <input type="hidden" name="pageId" value={issue.pageId ?? ""} />
              <input type="hidden" name="site" value={site} />
              <button
                type="submit"
                disabled={deletePending}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deletePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deletePending ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Edit form */}
      {mode === "edit" && (
        <div className="rounded-md border border-border bg-background p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Editar incidencia</h3>
            <button
              type="button"
              onClick={handleCloseEdit}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {updateState && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {updateState}
            </div>
          )}

          {updateSuccess && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Guardado correctamente
            </div>
          )}

          <form action={updateAction} className="space-y-4">
            <input type="hidden" name="pageId" value={issue.pageId ?? ""} />
            <input type="hidden" name="website" value={issue.website} />

            {/* Título */}
            <div>
              <label className={labelCls}>Título</label>
              <input
                name="title"
                required
                defaultValue={issue.title}
                className={inputCls}
              />
            </div>

            {/* Categoría / Prioridad / Estado */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Categoría</label>
                <select name="category" defaultValue={issue.category} className={selectCls}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Prioridad</label>
                <select name="priority" defaultValue={issue.priority} className={selectCls}>
                  {(["low", "medium", "high", "critical"] as AuditPriority[]).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Estado</label>
                <select name="status" defaultValue={issue.status} className={selectCls}>
                  {(["todo", "in_progress", "done"] as AuditStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Resolución */}
            <div>
              <label className={labelCls}>Resolución</label>
              <select name="resolution" defaultValue={issue.resolution ?? "ambas"} className={selectCls}>
                {(["390x844", "414x896", "ambas"] as AuditResolution[]).map((r) => (
                  <option key={r} value={r}>{RESOLUTION_LABELS[r]}</option>
                ))}
              </select>
            </div>

            {/* Screenshot */}
            <div>
              <label className={labelCls}>Screenshot</label>
              {/* Ruta actual */}
              {issue.screenshot && (
                <p className="mb-1.5 truncate rounded-md border border-input bg-muted px-3 py-1.5 text-xs font-mono text-muted-foreground">
                  {issue.screenshot}
                </p>
              )}
              {/* Preview de la nueva imagen seleccionada */}
              {previewUrl && (
                <div className="mb-2 overflow-hidden rounded-md border border-border" style={{ maxHeight: 180 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Preview" className="w-full object-contain" />
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                <ImagePlus className="w-3.5 h-3.5" />
                {previewUrl ? "Cambiar imagen" : "Subir nueva imagen"}
                <input
                  ref={fileInputRef}
                  type="file"
                  name="screenshotFile"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setPreviewUrl(URL.createObjectURL(file));
                  }}
                />
              </label>
              {previewUrl && (
                <button
                  type="button"
                  className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setPreviewUrl(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  Quitar
                </button>
              )}
            </div>

            {/* Problema */}
            <div>
              <label className={labelCls}>Problema</label>
              <textarea
                name="problem"
                required
                rows={4}
                defaultValue={issue.problem}
                className={`${inputCls} resize-y`}
              />
            </div>

            {/* Impacto */}
            <div>
              <label className={labelCls}>Impacto</label>
              <textarea
                name="impact"
                required
                rows={2}
                defaultValue={issue.impact}
                className={`${inputCls} resize-y`}
              />
            </div>

            {/* Solución */}
            <div>
              <label className={labelCls}>Solución</label>
              <textarea
                name="solution"
                required
                rows={3}
                defaultValue={issue.solution}
                className={`${inputCls} resize-y`}
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={updatePending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {updatePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {updatePending ? "Guardando…" : "Guardar cambios"}
              </button>
              <button
                type="button"
                onClick={handleCloseEdit}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
