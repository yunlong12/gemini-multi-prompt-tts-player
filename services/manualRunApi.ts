import { GeminiToolOptions, ManualRun } from '../types';

function toApiError(message: string, status?: number): Error {
  const error = new Error(message);
  if (typeof status === 'number') {
    (error as Error & { status?: number }).status = status;
  }
  return error;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw toApiError(`Invalid JSON response from ${path}`, response.status);
  }

  if (!response.ok) {
    throw toApiError(data?.message || `HTTP ${response.status}`, response.status);
  }

  return data as T;
}

export async function createManualRuns(
  prompts: string[],
  ttsModel: string,
  toolOptions: GeminiToolOptions
): Promise<ManualRun[]> {
  const data = await request<{ runs: ManualRun[] }>('/api/manual-runs', {
    method: 'POST',
    body: JSON.stringify({
      prompts,
      ttsModel,
      ...toolOptions,
    }),
  });
  return data.runs;
}

export async function fetchManualRuns(limit = 50): Promise<ManualRun[]> {
  const data = await request<{ runs: ManualRun[] }>(`/api/manual-runs?limit=${limit}`);
  return data.runs;
}

export async function fetchManualRun(id: string): Promise<ManualRun> {
  const data = await request<{ run: ManualRun }>(`/api/manual-runs/${id}`);
  return data.run;
}

export async function deleteManualRun(id: string): Promise<void> {
  await request<void>(`/api/manual-runs/${id}`, {
    method: 'DELETE',
  });
}
