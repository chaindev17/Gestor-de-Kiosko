let sessionToken = null;
let backendMode = null; // null = unknown, 'server' | 'static'
let staticModulePromise = null;

try {
  sessionToken = window.localStorage.getItem('kiosko_token') || null;
} catch {
  sessionToken = null;
}

export function setSessionToken(token) {
  sessionToken = token || null;
  try {
    if (token) window.localStorage.setItem('kiosko_token', token);
    else window.localStorage.removeItem('kiosko_token');
  } catch {
    // ignore storage errors
  }
}

async function detectBackendMode() {
  if (backendMode) return backendMode;
  try {
    const res = await fetch('/api/health', { method: 'GET', credentials: 'include' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const json = await res.json();
      if (json?.status === 'ok') {
        backendMode = 'server';
        return backendMode;
      }
    }
  } catch {
    // No backend reachable (e.g. GitHub Pages static deployment)
  }
  backendMode = 'static';
  return backendMode;
}

async function runStatic(method, path, body) {
  if (!staticModulePromise) {
    staticModulePromise = import('./staticPlatform.js');
  }
  const { handleStaticPlatformApi } = await staticModulePromise;
  return handleStaticPlatformApi(method, path, body);
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const mode = await detectBackendMode();

  if (mode === 'static') {
    const parsedBody =
      typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
    return runStatic(method, path, parsedBody);
  }

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    method,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() };

  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => apiRequest(path, { method: 'GET' }),
  post: (path, body) => apiRequest(path, { method: 'POST', body }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body }),
  delete: (path) => apiRequest(path, { method: 'DELETE' }),
};
