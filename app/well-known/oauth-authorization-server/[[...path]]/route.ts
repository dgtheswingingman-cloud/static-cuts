// Some MCP clients look for authorization server metadata on the resource's
// own origin instead of following the protected-resource document. Mirror
// Supabase Auth's metadata here so either discovery path works.

import { authorizationServer } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const issuer = new URL(authorizationServer());
  const metadataUrl = `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`;
  const res = await fetch(metadataUrl, { next: { revalidate: 300 } });
  if (!res.ok) {
    return Response.json({ error: "authorization server metadata unavailable" }, { status: 502 });
  }
  return new Response(await res.text(), {
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
