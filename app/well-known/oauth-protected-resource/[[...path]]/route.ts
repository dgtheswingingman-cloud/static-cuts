// OAuth 2.0 Protected Resource Metadata (RFC 9728) for /api/mcp.
// Served at /.well-known/oauth-protected-resource (and the /api/mcp-suffixed
// form) via the rewrite in next.config.ts. Tells MCP clients like ChatGPT that
// Supabase Auth is the authorization server.

import { authorizationServer, mcpResource } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return Response.json(
    {
      resource: mcpResource(req),
      authorization_servers: [authorizationServer()],
      bearer_methods_supported: ["header"],
      resource_name: "Static Cuts",
      resource_documentation: new URL("/settings", mcpResource(req)).toString(),
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  );
}
