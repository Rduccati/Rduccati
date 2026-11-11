/** Gọi API: tự gắn token, chuẩn hóa lỗi tiếng Việt */
const TOKEN_KEY = 'watchpos_token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

function qs(params?: Record<string, any>) {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
}

export async function request<T = any>(method: string, url: string, body?: any, params?: Record<string, any>): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch('/api' + url + qs(params), { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ WATCH POS. Kiểm tra server đã chạy chưa.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !url.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Lỗi ${res.status}`, data);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string, params?: Record<string, any>) => request<T>('GET', url, undefined, params),
  post: <T = any>(url: string, body?: any) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: any) => request<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  /** Tải file (Excel, JSON) có xác thực */
  download: async (url: string, params?: Record<string, any>, fallbackName = 'download') => {
    const res = await fetch('/api' + url + qs(params), { headers: { Authorization: 'Bearer ' + (tokenStore.get() ?? '') } });
    if (!res.ok) {
      let msg = `Lỗi ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    saveBlob(blob, m ? decodeURIComponent(m[1]) : fallbackName);
  },
  upload: <T = any>(url: string, file: File, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.append('file', file);
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return request<T>('POST', url, fd);
  },
};

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
