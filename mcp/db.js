// Calls Hashlite's database functions over Supabase's REST API with the public (publishable)
// key. No secret is needed: the functions check their own inputs (client ids, PKCE codes,
// access tokens) and act only for the user a token belongs to.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vqyhrsjyyuespscyjzpd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_jUWXGB7AaQLMcWmPddsSfQ_SltDh3rE';

export class DbError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code; // Postgres error code, e.g. HL401 (bad token), HL404, HL409, HL400
    this.detail = detail; // for HL400: the OAuth error code (invalid_grant, …)
  }
}

export async function rpc(name, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new DbError(503, 'NETWORK', 'Hashlite’s database could not be reached. Try again in a moment.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DbError(res.status, body?.code ?? String(res.status), body?.message ?? 'Database error.', body?.details ?? null);
  }
  return body;
}
