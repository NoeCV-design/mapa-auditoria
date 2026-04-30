"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";

export async function loginAction(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const username = (formData.get("username") as string)?.trim();
  const password = formData.get("password") as string;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    await createSession();
    redirect("/");
  }

  return "Usuario o contraseña incorrectos.";
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
