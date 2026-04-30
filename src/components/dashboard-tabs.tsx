"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriorityPieChart } from "@/components/priority-pie-chart";
import { AuditIssue, AuditCategory, AuditPriority } from "@/types/audit";

const categoryStyles: Record<AuditCategory, string> = {
  UX: "text-violet-600 border-violet-200 bg-violet-50",
  UI: "text-indigo-600 border-indigo-200 bg-indigo-50",
  Accessibility: "text-teal-600 border-teal-200 bg-teal-50",
  Functional: "text-rose-600 border-rose-200 bg-rose-50",
  Performance: "text-orange-600 border-orange-200 bg-orange-50",
};

const categoryLabels: Record<AuditCategory, string> = {
  UX: "UX",
  UI: "UI",
  Accessibility: "Accesibilidad",
  Functional: "Funcional",
  Performance: "Rendimiento",
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

const PIE_COLORS: Record<AuditPriority, string> = {
  critical: "#7c3aed",
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#94a3b8",
};

export interface DashboardTab {
  key: string;
  label: string;
  site: string;
  issues: AuditIssue[];
}

function getTopIssues(issues: AuditIssue[], count = 5): AuditIssue[] {
  const order: Record<AuditPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...issues].sort((a, b) => order[a.priority] - order[b.priority]).slice(0, count);
}

function getPieSlices(issues: AuditIssue[]) {
  return [
    { label: "Crítica", value: issues.filter((i) => i.priority === "critical").length, color: PIE_COLORS.critical },
    { label: "Alta", value: issues.filter((i) => i.priority === "high").length, color: PIE_COLORS.high },
    { label: "Media", value: issues.filter((i) => i.priority === "medium").length, color: PIE_COLORS.medium },
    { label: "Baja", value: issues.filter((i) => i.priority === "low").length, color: PIE_COLORS.low },
  ];
}

export function DashboardTabs({ tabs }: { tabs: DashboardTab[] }) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key ?? "");
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  const topIssues = active ? getTopIssues(active.issues) : [];
  const pieSlices = active ? getPieSlices(active.issues) : [];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border -mx-6 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveKey(tab.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeKey === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-5 grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6 items-stretch">
        {/* Top 5 issues table */}
        <div className="flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            5 incidencias más relevantes
          </p>
          {topIssues.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Sin incidencias registradas
            </p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden flex-1">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="text-xs font-medium">Título</TableHead>
                    <TableHead className="w-32 text-xs font-medium">Categoría</TableHead>
                    <TableHead className="w-24 text-xs font-medium">Prioridad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topIssues.map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/${active.site}/issues/${issue.id}`}
                          className="text-sm font-medium text-foreground leading-snug hover:underline line-clamp-2"
                        >
                          {issue.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium ${categoryStyles[issue.category]}`}
                        >
                          {categoryLabels[issue.category]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium ${priorityStyles[issue.priority]}`}
                        >
                          {priorityLabels[issue.priority]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Pie chart */}
        <div className="flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Distribución por prioridad
          </p>
          <div className="rounded-lg border border-border p-4 flex flex-col flex-1 items-center justify-center">
            <PriorityPieChart slices={pieSlices} />
          </div>
        </div>
      </div>
    </div>
  );
}
