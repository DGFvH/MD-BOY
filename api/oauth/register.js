// Vercel function: OAuth dynamic client registration (RFC 7591) at /api/oauth/register.
import { rpc, DbError } from '../../mcp/db.js';
import { json, preflight } from '../../mcp/http.js';

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === 'string')) {
    return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' }, 400);
  }
  try {
    const clientId = await rpc('oauth_register_client', { p_name: String(body.client_name ?? ''), p_redirect_uris: uris });
    return json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: body.client_name ?? 'An application',
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'documents',
    }, 201);
  } catch (err) {
    if (err instanceof DbError && err.code === 'HL400') return json({ error: err.detail ?? 'invalid_client_metadata', error_description: err.message }, 400);
    return json({ error: 'server_error', error_description: 'Registration failed.' }, 500);
  }
}

export const OPTIONS = preflight;
