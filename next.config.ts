import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OAuth discovery documents for the ChatGPT connector (/api/mcp).
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/well-known/oauth-protected-resource/:path*" },
      { source: "/.well-known/oauth-protected-resource", destination: "/well-known/oauth-protected-resource" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/well-known/oauth-authorization-server/:path*" },
      { source: "/.well-known/oauth-authorization-server", destination: "/well-known/oauth-authorization-server" },
    ];
  },
};

export default nextConfig;
