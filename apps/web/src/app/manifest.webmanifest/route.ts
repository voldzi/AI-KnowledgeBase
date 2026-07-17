import { NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";

export const dynamic = "force-dynamic";

export function GET() {
  if (getAklConfig().webProfile !== "chat") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(
    {
      id: "/",
      name: "AKB Chat",
      short_name: "AKB Chat",
      description: "Bezpečný znalostní asistent AKB",
      lang: "cs",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#f4f7f8",
      theme_color: "#0f766e",
      icons: [
        {
          src: "/icons/akb-chat-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/akb-chat-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/akb-chat-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    {
      headers: {
        "cache-control": "public, max-age=300, must-revalidate",
        "content-type": "application/manifest+json; charset=utf-8",
      },
    },
  );
}
