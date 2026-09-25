// Test accounts on Supabase. They are created once, already confirmed (see
// supabase/test-users.sql), and emptied before each test through the normal API,
// so tests start from a fresh account without sending any email.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
const env = { ...readEnv(new URL('../.env', import.meta.url)), ...readEnv(new URL('../.env.test.local', import.meta.url)), ...process.env };

export const TEST_EMAIL = (env.E2E_USERS ?? 'e2e-1@hashlite.test').split(',')[0];
export const TEST_PASSWORD = env.E2E_PASSWORD;

/** Deletes every document, folder and image of the test account and forgets the welcome document. */
export async function resetTestAccount(email = TEST_EMAIL) {
  if (!TEST_PASSWORD) throw new Error('Set E2E_PASSWORD (in .env.test.local) for the Supabase test users.');
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  const uid = data.user.id;
  await sb.from('documents').delete().eq('user_id', uid);
  await sb.from('folders').delete().eq('user_id', uid);
  const { data: files } = await sb.storage.from('images').list(uid, { limit: 1000 });
  if (files?.length) await sb.storage.from('images').remove(files.map((f) => `${uid}/${f.name}`));
  await sb.auth.updateUser({ data: { welcomed: false } });
  await sb.auth.signOut();
}
