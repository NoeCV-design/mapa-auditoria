"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, LogOut, Settings, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { logoutAction } from "@/app/login/actions";

const sites = [
  {
    label: "MAPA",
    href: "/dashboard/mapa",
    abbr: "MA",
    color: "bg-blue-100 text-blue-700",
  },
  {
    label: "Alimentos de España",
    href: "/dashboard/alimentos",
    abbr: "ADE",
    color: "bg-green-100 text-green-700",
  },
  {
    label: "Caminos Naturales",
    href: "/dashboard/caminos",
    abbr: "CCNN",
    color: "bg-orange-100 text-orange-700",
  },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-sidebar flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Smartphone className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground">UX Audit</span>
        </Link>
        <p className="text-xs text-muted-foreground mt-1">Revisión mobile</p>
      </div>

      <Separator />

      {/* Sites */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <p className="px-3 pb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Webs
        </p>
        {sites.map((site) => {
          const isActive = pathname.startsWith(site.href);
          return (
            <Link
              key={site.href}
              href={site.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <span className={cn("w-8 h-6 rounded text-[9px] font-bold flex items-center justify-center shrink-0 px-1", site.color)}>
                {site.abbr}
              </span>
              {site.label}
            </Link>
          );
        })}
      </nav>

      {/* Admin section */}
      <Separator />
      {isAdmin ? (
        <div className="px-3 py-4 space-y-1">
          <p className="px-3 pb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Settings className="w-3 h-3" />
            Administrador
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0 text-muted-foreground" />
              Cerrar sesión
            </button>
          </form>
        </div>
      ) : (
        <div className="px-3 py-4">
          <Link
            href="/login"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Lock className="w-4 h-4 shrink-0" />
            Acceso administrador
          </Link>
        </div>
      )}
    </aside>
  );
}
