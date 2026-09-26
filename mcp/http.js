// Small helpers shared by the Vercel functions in api/.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate',
};

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...headers },
  });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** The site's own address, as the request reached it (https://hashlite.io in production). */
export const originOf = (request) => new URL(request.url).origin;

/** Reads a form-encoded or JSON body into a plain object. */
export async function readParams(request) {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await request.json().catch(() => ({}))) ?? {};
  return Object.fromEntries(new URLSearchParams(await request.text()));
}
