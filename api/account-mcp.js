// Vercel function: the account connector at https://hashlite.io/api/account-mcp.
// Needs an OAuth access token (Authorization: Bearer …). Without a valid one it answers 401
// and points to the OAuth metadata, which is how MCP clients such as Claude start the login.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createAccountServer } from '../mcp/account.js';
import { rpc, DbError } from '../mcp/db.js';
import { CORS, json, preflight, originOf } from '../mcp/http.js';

function unauthorized(request, description) {
  const metadata = `${originOf(request)}/.well-known/oauth-protected-resource/api/account-mcp`;
  return json({ error: 'invalid_token', error_description: description }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${metadata}", error="invalid_token", error_description="${description}"`,
  });
}

export async function handle(request) {
  if (request.method === 'OPTIONS') return preflight();
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return unauthorized(request, 'Sign in to Hashlite to use this connector.');
  try {
    await rpc('mcp_list', { p_token: token, p_limit: 1 }); // checks the token
  } catch (err) {
    if (err instanceof DbError && err.code === 'HL401') return unauthorized(request, 'The access token is invalid or has expired.');
    return json({ error: 'temporarily_unavailable', error_description: err.message }, 503);
  }
  const server = createAccountServer(token);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
