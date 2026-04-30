"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
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
import { issues } from "@/data/issues";
import { AuditCategory, AuditPriority, AuditStatus } from "@/types/audit";

const CATEGORIES: AuditCategory[] = [
  "UX",
  "UI",
  "Accessibility",
  "Functional",
];
const PRIORITIES: AuditPriority[] = ["low", "medium", "high"];
const STATUSES: AuditStatus[] = ["todo", "in_progress", "done"];

const priorityStyles: Record<AuditPriority, string> = {
  low: "text-muted-foreground border-border",
  medium: "text-amber-600 border-amber-200 bg-amber-50",
  high: "text-red-600 border-red-200 bg-red-50",
};

const statusStyles: Record<AuditStatus, string> = {
  todo: "text-muted-foreground border-border",
  in_progress: "text-blue-600 border-blue-200 bg-blue-50",
  done: "text-green-600 border-green-200 bg-green-50",
};

const statusLabels: Record<AuditStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};

const categoryStyles: Record<AuditCategory, string> = {
  UX: "text-violet-600 border-violet-200 bg-violet-50",
  UI: "text-indigo-600 border-indigo-200 bg-indigo-50",
  Accessibility: "text-teal-600 border-teal-200 bg-teal-50",
  Functional: "text-rose-600 border-rose-200 bg-rose-50",
};

const categoryLabels: Record<AuditCategory, string> = {
  UX: "UX",
  UI: "UI",
  Accessibility: "Accesibilidad",
  Functional: "Funcional",
};

type FilterAll = "all";

export default function IssuesPage() {
  const [category, setCategory] = useState<AuditCategory | FilterAll>("all");
  const [priority, setPriority] = useState<AuditPriority | FilterAll>("all");
  const [status, setStatus] = useState<AuditStatus | FilterAll>("all");

  const filtered = useMemo(
    () =>
      issues.filter(
        (i) =>
          (category === "all" || i.category === category) &&
          (priority === "all" || i.priority === priority) &&
          (status === "all" || i.status === status)
      ),
    [category, priority, status]
  );

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Issues" description={`${filtered.length} issue${filtered.length !== 1 ? "s" : ""}`}>
        <div className="flex items-center gap-2">
          <Select value={category} onValueChange={(v) => setCategory(v as AuditCategory | FilterAll)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={(v) => setPriority(v as AuditPriority | FilterAll)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(v) => setStatus(v as AuditStatus | FilterAll)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <div className="flex-1 p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-1">
            <span>No issues match the current filters.</span>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-24 text-xs font-medium">ID</TableHead>
                  <TableHead className="text-xs font-medium">Title</TableHead>
                  <TableHead className="w-36 text-xs font-medium">Category</TableHead>
                  <TableHead className="w-28 text-xs font-medium">Priority</TableHead>
                  <TableHead className="w-32 text-xs font-medium">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((issue) => (
                  <TableRow key={issue.id} className="group cursor-pointer">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <Link href={`/issues/${issue.id}`} className="block">
                        {issue.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/issues/${issue.id}`} className="block">
                        <p className="text-sm font-medium text-foreground leading-snug group-hover:underline">
                          {issue.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          {issue.url}
                        </p>
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
                        className={`text-xs font-medium capitalize ${priorityStyles[issue.priority]}`}
                      >
                        {issue.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs font-medium ${statusStyles[issue.status]}`}
                      >
                        {statusLabels[issue.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
