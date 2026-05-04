"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { reloadIssues } from "@/app/actions";

export function ReloadButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await reloadIssues();
      router.refresh();
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-foreground text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${isPending ? "animate-spin" : ""}`} />
      {isPending ? "Recargando…" : "Recargar"}
    </button>
  );
}
