import { authorizationServerMetadata } from "@/lib/connector/oauth";
import { publicOrigin } from "@/lib/google/origin";

/** /.well-known/oauth-authorization-server (a rewrite in next.config.ts): how Claude signs in (#221). */
export async function GET(request: Request) {
  // Career Studio: the endpoints are always there; each account turns its
  // connector on for itself, which the code and tokens are checked against.
  return Response.json(authorizationServerMetadata(publicOrigin(request)), { headers: { "access-control-allow-origin": "*" } });
}
