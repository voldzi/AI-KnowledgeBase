import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") || "";

const nextConfig: NextConfig = {
  basePath,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
  logging: {
    incomingRequests: {
      ignore: [/\/api\/documents\/source\/(?:content|preview)(?:\?|$)/],
    },
  },
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false
};

export default nextConfig;
