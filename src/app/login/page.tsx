"use client";

import { useActionState } from "react";
import { Smartphone } from "lucide-react";
import { loginAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [error, action, pending] = useActionState(loginAction, null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 px-4">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">UX Audit</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Acceso de administrador
            </p>
          </div>
        </div>

        {/* Form */}
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="username"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Usuario
            </Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="password"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Contraseña
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-9 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Accediendo…" : "Iniciar sesión"}
          </Button>
        </form>
      </div>
    </div>
  );
}
