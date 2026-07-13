import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") || "";

const nextConfig: NextConfig = {
  basePath,
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
