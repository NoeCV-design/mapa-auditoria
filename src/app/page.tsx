import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, MonitorSmartphone } from "lucide-react";
import { fetchIssues } from "@/lib/notion";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { AuditCategory, AuditIssue } from "@/types/audit";

const CATEGORIES: AuditCategory[] = ["UX", "UI", "Performance", "Accessibility", "Functional"];

const categoryLabels: Record<AuditCategory, string> = {
  UX: "UX",
  UI: "UI",
  Performance: "Rendimiento",
  Accessibility: "Accesibilidad",
  Functional: "Funcional",
};

function computeCategoryBreakdown(issues: AuditIssue[]) {
  const total = issues.length;
  return CATEGORIES.map((cat) => {
    const count = issues.filter((i) => i.category === cat).length;
    return {
      label: categoryLabels[cat],
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  });
}

export default async function DashboardPage() {
  const [mapaIssues, alimentosIssues, caminosIssues] = await Promise.all([
    fetchIssues("MAPA"),
    fetchIssues("Alimentos"),
    fetchIssues("Caminos"),
  ]);

  const allIssues = [...mapaIssues, ...alimentosIssues, ...caminosIssues];

  const totalScreens = new Set(allIssues.map((i) => i.url).filter(Boolean)).size;
  const highCount = allIssues.filter((i) => i.priority === "high").length;
  const mediumCount = allIssues.filter((i) => i.priority === "medium").length;
  const lowCount = allIssues.filter((i) => i.priority === "low").length;

  const categoryBreakdown = computeCategoryBreakdown(allIssues);

  const tabs = [
    { key: "mapa", label: "MAPA", site: "mapa", issues: mapaIssues },
    { key: "alimentos", label: "Alimentos de España", site: "alimentos", issues: alimentosIssues },
    { key: "caminos", label: "Caminos Naturales", site: "caminos", issues: caminosIssues },
  ];

  return (
    <div className="flex flex-col flex-1">
      <PageHeader
        title="Dashboard"
        description="Visión general de la auditoría UX mobile — ET_0040.9"
      >
        
      </PageHeader>

      <div className="p-6 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Pantallas revisadas */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Pantallas revisadas
                  </p>
                  <p className="text-2xl font-bold text-foreground mt-1">{totalScreens}</p>
                </div>
                <MonitorSmartphone className="w-5 h-5 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          {/* Crítica */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Incidencias
                  </p>
                  <p className="text-2xl font-bold text-foreground mt-1">{highCount}</p>
                  <Badge
                    variant="outline"
                    className="mt-1.5 text-xs font-medium text-red-600 border-red-200 bg-red-50"
                  >
                    Crítica
                  </Badge>
                </div>
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
            </CardContent>
          </Card>

          {/* Alta */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Incidencias
                  </p>
                  <p className="text-2xl font-bold text-foreground mt-1">{mediumCount}</p>
                  <Badge
                    variant="outline"
                    className="mt-1.5 text-xs font-medium text-amber-600 border-amber-200 bg-amber-50"
                  >
                    Alta
                  </Badge>
                </div>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
            </CardContent>
          </Card>

          {/* Media */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Incidencias
                  </p>
                  <p className="text-2xl font-bold text-foreground mt-1">{lowCount}</p>
                  <Badge
                    variant="outline"
                    className="mt-1.5 text-xs font-medium text-muted-foreground border-border"
                  >
                    Media
                  </Badge>
                </div>
                <AlertTriangle className="w-5 h-5 text-slate-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Incidencias por web (tabs) */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-semibold">Incidencias por web</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DashboardTabs tabs={tabs} />
            </CardContent>
          </Card>

          {/* Incidencias por categoría */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Incidencias por categoría</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {categoryBreakdown.map((cat) => (
                <div key={cat.label}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-foreground font-medium">{cat.label}</span>
                    <span className="text-muted-foreground">
                      {cat.count > 0 ? `${cat.count} (${cat.pct}%)` : "—"}
                    </span>
                  </div>
                  <Progress value={cat.pct} className="h-1.5" />
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground pt-1">
                % del total de incidencias por categoría
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
