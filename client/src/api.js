// Small fetch wrapper for the Hashmark JSON API.

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

async function request(method, path, body, { keepalive = false, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      keepalive,
      // raw: send a File/Blob as it is (image uploads)
      headers: body === undefined ? {} : { 'Content-Type': raw ? body.type || 'application/octet-stream' : 'application/json' },
      body: body === undefined || raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data);
  }
  return data;
}

export const api = {
  config: () => request('GET', '/config'),
  me: () => request('GET', '/auth/me'),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  register: (email, password) => request('POST', '/auth/register', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  changePassword: (current_password, new_password) => request('POST', '/auth/password', { current_password, new_password }),
  deleteAccount: (password) => request('DELETE', '/auth/account', { password }),
  exportUrl: '/api/export', // a .zip of every document, downloaded with a plain link

  listDocs: () => request('GET', '/docs'),
  searchDocs: (q) => request('GET', `/docs?q=${encodeURIComponent(q)}`),
  listTrash: () => request('GET', '/docs?trash=1'),
  emptyTrash: () => request('DELETE', '/docs/trash'),
  getDoc: (id) => request('GET', `/docs/${id}`),
  createDoc: (doc) => request('POST', '/docs', doc),
  saveDoc: (id, patch, opts) => request('PUT', `/docs/${id}`, patch, opts),
  shareDoc: (id) => request('POST', `/docs/${id}/share`),
  unshareDoc: (id) => request('DELETE', `/docs/${id}/share`),
  uploadImage: (file) => request('POST', '/images', file, { raw: true }),
  trashDoc: (id) => request('DELETE', `/docs/${id}`),
  deleteDoc: (id) => request('DELETE', `/docs/${id}?permanent=1`),
  restoreDoc: (id) => request('POST', `/docs/${id}/restore`),
  listRevisions: (id) => request('GET', `/docs/${id}/revisions`),
  getRevision: (id, rid) => request('GET', `/docs/${id}/revisions/${rid}`),
  restoreRevision: (id, rid) => request('POST', `/docs/${id}/revisions/${rid}/restore`),

  listFolders: () => request('GET', '/folders'),
  createFolder: (name, parent_id = null) => request('POST', '/folders', { name, parent_id }),
  updateFolder: (id, patch) => request('PATCH', `/folders/${id}`, patch),
  deleteFolder: (id) => request('DELETE', `/folders/${id}`),
};
