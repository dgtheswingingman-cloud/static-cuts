// Static Cuts MCP server (Streamable HTTP, stateless, JSON responses).
//
// ChatGPT connects here as a custom connector. Sign-in is OAuth 2.1 through
// Supabase Auth: unauthenticated requests get a 401 pointing at
// /.well-known/oauth-protected-resource, which names Supabase as the
// authorization server. See docs/chatgpt-routines.md for setup.

import { authenticate, protectedResourceMetadataUrl } from "@/lib/mcp/auth";
import { SERVER_INSTRUCTIONS, TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "static-cuts", title: "Static Cuts", version: "0.1.0" };

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Expose-Headers": "www-authenticate, mcp-session-id",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

function unauthorized(req: Request) {
  return json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to Static Cuts to use this connector." } },
    401,
    { "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(req)}"` }
  );
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handle(msg: JsonRpcRequest, auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
            name, title, description, inputSchema, annotations: { title, ...annotations },
          })),
        },
      };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const data = await tool.run(auth.db, params?.arguments ?? {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(data) }],
            structuredContent: data && typeof data === "object" && !Array.isArray(data) ? data : { result: data },
            isError: false,
          },
        };
      } catch (e: any) {
        // Tool errors are reported to the model, not as protocol errors, so
        // it can correct its input and retry.
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `Error: ${e?.message ?? String(e)}` }], isError: true },
        };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized(req);

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      responses.push(rpcError((msg as any)?.id, -32600, "Invalid request"));
      continue;
    }
    // Notifications (no id) get no response body.
    if (msg.id === undefined || msg.id === null) continue;
    responses.push(await handle(msg, auth));
  }

  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(Array.isArray(body) ? responses : responses[0]);
}

// This server is stateless and never pushes messages, so there is no SSE stream.
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized(req);
  return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS_HEADERS } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS_HEADERS } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
