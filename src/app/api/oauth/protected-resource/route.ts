import { protectedResourceMetadata } from "@/lib/connector/oauth";
import { publicOrigin } from "@/lib/google/origin";

/** /.well-known/oauth-protected-resource (a rewrite in next.config.ts): who guards /api/mcp (#221). */
export async function GET(request: Request) {
  // Career Studio: the endpoints are always there; each account turns its
  // connector on for itself, which the code and tokens are checked against.
  return Response.json(protectedResourceMetadata(publicOrigin(request)), { headers: { "access-control-allow-origin": "*" } });
}
