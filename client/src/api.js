// The Hashlite data layer, on Supabase. The rest of the app only uses this object,
// with the same shapes and error statuses the old REST API had:
// 0 offline, 400 bad input, 401 signed out, 404 missing, 409 changed elsewhere,
// 410 in the trash, 413 over the storage limit.
import { supabase, SUPABASE_URL } from './supabase.js';
import { createZip, exportEntries } from './zip.js';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Set while we sign out on purpose (sign-out, account deletion), so that isn't
// mistaken for an expired session.
let signingOut = false;
async function quietly(fn) {
  signingOut = true;
  try {
    return await fn();
  } finally {
    setTimeout(() => (signingOut = false), 0);
  }
}

const META = 'id, folder_id, title, version, created_at, updated_at, deleted_at, share_token';
const FULL = `${META}, content`;
const OUR_CODES = { HL400: 400, HL401: 401, HL404: 404, HL409: 409, HL410: 410, HL413: 413 };

// Turns a Supabase error into an ApiError.
function fail(error, status) {
  if (error instanceof ApiError) return error;
  if (status === 0 || /FetchError|Failed to fetch|NetworkError|Load failed/i.test(error?.message ?? '')) {
    return new ApiError(0, 'You appear to be offline.');
  }
  const code = error?.code ?? '';
  if (OUR_CODES[code]) {
    let current;
    try {
      current = error.details ? JSON.parse(error.details) : undefined;
    } catch {
      current = undefined;
    }
    return new ApiError(OUR_CODES[code], error.message, current ? { current } : {});
  }
  if (code === '23503') return new ApiError(400, 'That folder no longer exists.');
  if (code === '23514' || code === '22001') return new ApiError(400, 'That is too long or not allowed.');
  if (status === 401 || /^PGRST30/.test(code) || /JWT/i.test(error?.message ?? '')) {
    onUnauthorized();
    return new ApiError(401, 'Please sign in.');
  }
  return new ApiError(status || 500, error?.message || 'Something went wrong.');
}

// Runs a Supabase query and returns its data, or throws an ApiError.
async function run(query) {
  let res;
  try {
    res = await query;
  } catch (err) {
    throw fail(err, 0);
  }
  if (res.error) throw fail(res.error, res.status);
  return res.data;
}

// The signed-in user. Without a session, queries would quietly run as a visitor and
// return nothing, so every call checks first.
async function currentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    onUnauthorized();
    throw new ApiError(401, 'Please sign in.');
  }
  return user;
}

const clean = (doc) => {
  if (!doc) return doc;
  const { search, user_id, ...rest } = doc;
  return rest;
};

const authError = (error) => {
  if (!error) return null;
  if (error.status === 0 || /fetch|network/i.test(error.message)) return new ApiError(0, 'You appear to be offline.');
  if (/invalid login credentials/i.test(error.message)) return new ApiError(401, 'Incorrect email or password.');
  if (/email not confirmed/i.test(error.message)) return new ApiError(403, 'Please confirm your email address first. Check your inbox for the link.');
  if (error.status === 429) return new ApiError(429, 'Too many attempts. Try again later.');
  return new ApiError(error.status || 400, error.message);
};

const appUrl = () => `${location.origin}/app`;
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const api = {
  // ---- Account ----
  config: async () => ({ registration: true }),

  async me() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw new ApiError(401, 'Please sign in.');
    return { user: { id: user.id, email: user.email, welcomed: !!user.user_metadata?.welcomed } };
  },

  /** Remembers (on the account, so on every device) that the welcome document was made. */
  async markWelcomed() {
    const { error } = await supabase.auth.updateUser({ data: { welcomed: true } });
    if (error) throw authError(error);
  },

  /** Calls fn when someone arrives from a "reset your password" email. */
  onPasswordRecovery(fn) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setTimeout(fn, 0);
    });
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw authError(error);
    return { user: { id: data.user.id, email: data.user.email, welcomed: !!data.user.user_metadata?.welcomed } };
  },

  /** Resolves { user } when signed in straight away, or { confirm: true } when the email must be confirmed first. */
  async register(email, password) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: appUrl() },
    });
    if (error) throw authError(error);
    if (!data.session) return { confirm: true };
    return { user: { id: data.user.id, email: data.user.email } };
  },

  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
    if (error) throw authError(error);
  },

  async setNewPassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw authError(error);
  },

  async logout() {
    const { error } = await quietly(() => supabase.auth.signOut({ scope: 'local' }));
    if (error && error.status !== 401) throw authError(error);
  },

  async changePassword(currentPassword, newPassword) {
    const user = await currentUser();
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (check.error) {
      const err = authError(check.error);
      throw err.status === 401 ? new ApiError(400, 'Current password is incorrect.') : err;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw authError(error);
    await supabase.auth.signOut({ scope: 'others' });
    return { ok: true };
  },

  async deleteAccount(password) {
    const user = await currentUser();
    const check = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (check.error) {
      const err = authError(check.error);
      throw err.status === 401 ? new ApiError(400, 'That password is incorrect.') : err;
    }
    // Images first (the database can't remove storage files), then everything else.
    const bucket = supabase.storage.from('images');
    for (;;) {
      const files = await run(bucket.list(user.id, { limit: 100 }));
      if (!files?.length) break;
      await run(bucket.remove(files.map((f) => `${user.id}/${f.name}`)));
      if (files.length < 100) break;
    }
    await run(supabase.rpc('delete_my_account'));
    await quietly(() => supabase.auth.signOut({ scope: 'local' }));
    return { ok: true };
  },

  /** A .zip of every document outside the trash, in its folders. */
  async exportZip() {
    await currentUser();
    const [folders, documents] = await Promise.all([
      run(supabase.from('folders').select('id, parent_id, name, created_at')),
      run(supabase.from('documents').select('folder_id, title, content, updated_at').is('deleted_at', null)),
    ]);
    return createZip(exportEntries(folders, documents));
  },

  // ---- Documents ----
  async listDocs() {
    await currentUser();
    const documents = await run(supabase.from('documents').select(META).is('deleted_at', null).order('updated_at', { ascending: false }));
    return { documents };
  },

  async searchDocs(q) {
    await currentUser();
    return { documents: await run(supabase.rpc('search_documents', { q })) };
  },

  async listTrash() {
    await currentUser();
    const documents = await run(supabase.from('documents').select(META).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }));
    return { documents };
  },

  async emptyTrash() {
    await currentUser();
    const rows = await run(supabase.from('documents').delete().not('deleted_at', 'is', null).select('id'));
    return { deleted: rows.length };
  },

  async getDoc(id) {
    await currentUser();
    const document = await run(supabase.from('documents').select(FULL).eq('id', id).maybeSingle());
    if (!document) throw new ApiError(404, 'Document not found.');
    return { document };
  },

  async createDoc({ title = 'Untitled', content = '', folder_id = null } = {}) {
    await currentUser();
    const document = await run(supabase.rpc('create_document', { p_title: title, p_content: content, p_folder_id: folder_id }));
    return { document: clean(document) };
  },

  /**
   * Saves { title?, content?, folder_id?, version?, snapshot? }. With { keepalive: true }
   * the request may outlive the page (used when a tab closes).
   */
  async saveDoc(id, patch, { keepalive = false } = {}) {
    const args = {
      p_id: id,
      p_title: patch.title ?? null,
      p_content: patch.content ?? null,
      p_folder_id: patch.folder_id ?? null,
      p_move: 'folder_id' in patch,
      p_version: patch.version ?? null,
      p_snapshot: !!patch.snapshot,
    };
    if (keepalive) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new ApiError(401, 'Please sign in.');
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_document`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(args),
      }).catch(() => null);
      if (!res) throw new ApiError(0, 'You appear to be offline.');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(body, res.status);
      return { document: clean(body) };
    }
    await currentUser();
    return { document: clean(await run(supabase.rpc('save_document', args))) };
  },

  async trashDoc(id) {
    await currentUser();
    const rows = await run(supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id'));
    if (!rows.length) throw new ApiError(404, 'Document not found.');
    return { ok: true };
  },

  async deleteDoc(id) {
    await currentUser();
    const rows = await run(supabase.from('documents').delete().eq('id', id).select('id'));
    if (!rows.length) throw new ApiError(404, 'Document not found.');
    return { ok: true };
  },

  async restoreDoc(id) {
    await currentUser();
    const document = await run(supabase.from('documents').update({ deleted_at: null }).eq('id', id).select(FULL).maybeSingle());
    if (!document) throw new ApiError(404, 'Document not found.');
    return { document };
  },

  // ---- Share links ----
  async shareDoc(id) {
    await currentUser();
    const doc = await run(supabase.from('documents').select('share_token').eq('id', id).is('deleted_at', null).maybeSingle());
    if (!doc) throw new ApiError(404, 'Document not found.');
    const token = doc.share_token ?? randomToken();
    if (!doc.share_token) await run(supabase.from('documents').update({ share_token: token }).eq('id', id));
    return { token, url: `/s/${token}` };
  },

  async unshareDoc(id) {
    await currentUser();
    await run(supabase.from('documents').update({ share_token: null }).eq('id', id));
    return { ok: true };
  },

  // ---- Images ----
  async uploadImage(file) {
    const user = await currentUser();
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[file.type];
    if (!ext) throw new ApiError(415, 'Only PNG, JPEG, GIF and WebP images can be uploaded.');
    if (file.size > 5 * 1024 * 1024) throw new ApiError(413, 'Images can be at most 5 MB.');
    const path = `${user.id}/${randomToken()}.${ext}`;
    const bucket = supabase.storage.from('images');
    await run(bucket.upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false }));
    return { url: bucket.getPublicUrl(path).data.publicUrl };
  },

  // ---- Version history ----
  async listRevisions(id) {
    await currentUser();
    const revisions = await run(supabase.from('revision_list').select('id, title, size, created_at').eq('document_id', id).order('id', { ascending: false }));
    return { revisions };
  },

  async getRevision(id, rid) {
    await currentUser();
    const revision = await run(supabase.from('revisions').select('id, title, content, created_at').eq('document_id', id).eq('id', rid).maybeSingle());
    if (!revision) throw new ApiError(404, 'Revision not found.');
    return { revision };
  },

  async restoreRevision(id, rid) {
    await currentUser();
    return { document: clean(await run(supabase.rpc('restore_revision', { p_doc: id, p_rev: rid }))) };
  },

  // ---- Folders ----
  async listFolders() {
    await currentUser();
    return { folders: await run(supabase.from('folders').select('id, parent_id, name, created_at').order('name')) };
  },

  async createFolder(name, parent_id = null) {
    await currentUser();
    const folder = await run(supabase.from('folders').insert({ name: String(name).trim().slice(0, 120), parent_id }).select('id, parent_id, name, created_at').single());
    return { folder };
  },

  async updateFolder(id, patch) {
    await currentUser();
    const changes = {};
    if (patch.name !== undefined) changes.name = String(patch.name).trim().slice(0, 120);
    if (patch.parent_id !== undefined) changes.parent_id = patch.parent_id;
    const folder = await run(supabase.from('folders').update(changes).eq('id', id).select('id, parent_id, name, created_at').maybeSingle());
    if (!folder) throw new ApiError(404, 'Folder not found.');
    return { folder };
  },

  async deleteFolder(id) {
    await currentUser();
    await run(supabase.from('folders').delete().eq('id', id));
    return { ok: true };
  },
};

// Signed out in another tab, or the session could not be refreshed.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && !signingOut) onUnauthorized();
});
