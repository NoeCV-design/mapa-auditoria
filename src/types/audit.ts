export type AuditCategory = "UX" | "UI" | "Accessibility" | "Functional" | "Performance";
export type AuditPriority = "low" | "medium" | "high" | "critical";
export type AuditStatus = "todo" | "in_progress" | "done";
export type AuditWebsite = "MAPA" | "Alimentos" | "Caminos";
export type AuditResolution = "390x844" | "414x896" | "ambas";
/** Pipeline that generated the issue — used to trace false positives back to
 *  their origin (visual AI vs deterministic DOM/axe/lighthouse checks). */
export type AuditSource = "visual" | "functional" | "structural" | "axe" | "lighthouse" | "manual";

export interface AuditIssue {
  id: string;
  /** Notion page UUID — needed for update/delete operations. */
  pageId?: string;
  title: string;
  website: AuditWebsite;
  category: AuditCategory;
  priority: AuditPriority;
  status: AuditStatus;
  url: string;
  screenshot?: string;
  problem: string;
  solution: string;
  impact: string;
  resolution?: AuditResolution;
  source?: AuditSource;
}
