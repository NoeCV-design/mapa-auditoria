import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const blobUrl = req.nextUrl.searchParams.get("url");
  if (!blobUrl) return new NextResponse("Missing url", { status: 400 });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return new NextResponse("Blob token not configured", { status: 500 });

  const upstream = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!upstream.ok) {
    return new NextResponse("Blob not found", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/png";
  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
