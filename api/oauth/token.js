// Vercel function: the OAuth token endpoint at /api/oauth/token (public clients, PKCE).
// Grants: authorization_code (with code_verifier) and refresh_token (rotating).
import { rpc, DbError } from '../../mcp/db.js';
import { json, preflight, readParams } from '../../mcp/http.js';

const error = (code, description, status = 400) => json({ error: code, error_description: description }, status);

export async function POST(request) {
  const p = await readParams(request);
  try {
    if (p.grant_type === 'authorization_code') {
      if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) {
        return error('invalid_request', 'code, code_verifier, client_id and redirect_uri are required.');
      }
      return json(await rpc('oauth_exchange_code', { p_code: p.code, p_verifier: p.code_verifier, p_client_id: p.client_id, p_redirect_uri: p.redirect_uri }));
    }
    if (p.grant_type === 'refresh_token') {
      if (!p.refresh_token || !p.client_id) return error('invalid_request', 'refresh_token and client_id are required.');
      return json(await rpc('oauth_refresh', { p_refresh_token: p.refresh_token, p_client_id: p.client_id }));
    }
    return error('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  } catch (err) {
    if (err instanceof DbError && err.code === 'HL400') return error(err.detail ?? 'invalid_grant', err.message);
    return error('server_error', 'The token could not be issued.', 500);
  }
}

export const OPTIONS = preflight;
