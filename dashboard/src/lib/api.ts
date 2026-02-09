const API_BASE = '/api/v1';

let apiKey = localStorage.getItem('revback_api_key') || '';

export function setApiKey(key: string) {
  apiKey = key;
  localStorage.setItem('revback_api_key', key);
}

export function getApiKey(): string {
  return apiKey;
}

export async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

// SWR fetcher
export const fetcher = <T>(path: string) => apiFetch<T>(path);
