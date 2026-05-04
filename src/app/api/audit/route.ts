import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export async function POST(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: "La auditoría automática solo está disponible en local." },
      { status: 400 }
    );
  }

  const { url, website } = (await req.json()) as { url: string; website: string };
  if (!url || !website) {
    return NextResponse.json({ error: "url y website son requeridos" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const cwd = path.join(process.cwd());

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(
        "npx",
        ["tsx", "scripts/run-audit.ts", url, website],
        { cwd, env: { ...process.env }, shell: true }
      );

      proc.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()));
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()));
      });
      proc.on("close", (code) => {
        controller.enqueue(encoder.encode(`\n__EXIT__${code ?? 1}`));
        controller.close();
      });
      proc.on("error", (err) => {
        controller.enqueue(encoder.encode(`\nError: ${err.message}\n__EXIT__1`));
        controller.close();
      });
    },
  });

  return new NextResponse(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no" },
  });
}
