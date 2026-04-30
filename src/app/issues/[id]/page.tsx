import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, ImageOff, AlertTriangle, Lightbulb, Target } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { issues } from "@/data/issues";
import { AuditCategory, AuditPriority, AuditStatus } from "@/types/audit";

const priorityStyles: Record<AuditPriority, string> = {
  low: "text-muted-foreground border-border",
  medium: "text-amber-600 border-amber-200 bg-amber-50",
  high: "text-red-600 border-red-200 bg-red-50",
  critical: "text-purple-700 border-purple-300 bg-purple-50",
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
  Performance: "text-orange-600 border-orange-200 bg-orange-50",
  Accessibility: "text-teal-600 border-teal-200 bg-teal-50",
  Functional: "text-rose-600 border-rose-200 bg-rose-50",
};

export function generateStaticParams() {
  return issues.map((i) => ({ id: i.id }));
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const issue = issues.find((i) => i.id === id);

  if (!issue) notFound();

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title={issue.id} description={issue.url}>
        <Link
          href="/issues"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to issues
        </Link>
      </PageHeader>

      <div className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Screenshot */}
          <Card className="overflow-hidden p-0">
            <div className="aspect-video bg-muted flex items-center justify-center border-b border-border">
              {issue.screenshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={issue.screenshot}
                  alt={`Screenshot for ${issue.title}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <ImageOff className="w-8 h-8" />
                  <span className="text-xs">No screenshot available</span>
                </div>
              )}
            </div>
          </Card>

          {/* Title + meta */}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-6">
              <h1 className="text-2xl font-semibold text-foreground leading-tight">
                {issue.title}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`text-xs font-medium ${categoryStyles[issue.category]}`}>
                {issue.category}
              </Badge>
              <Badge variant="outline" className={`text-xs font-medium capitalize ${priorityStyles[issue.priority]}`}>
                {issue.priority} priority
              </Badge>
              <Badge variant="outline" className={`text-xs font-medium ${statusStyles[issue.status]}`}>
                {statusLabels[issue.status]}
              </Badge>
              <Separator orientation="vertical" className="h-4 mx-1" />
              <a
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                {issue.url}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <Separator />

          {/* Content sections */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Problem
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground leading-relaxed">{issue.problem}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Target className="w-4 h-4 text-amber-500" />
                  Impact
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground leading-relaxed">{issue.impact}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb className="w-4 h-4 text-green-500" />
                  Solution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground leading-relaxed">{issue.solution}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
