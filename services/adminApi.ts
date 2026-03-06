import { AuthSession, Schedule, SchedulerConfig, ScheduleRun } from '../types';

function toApiError(message: string, status?: number): Error {
  const error = new Error(message);
  if (typeof status === 'number') {
    (error as Error & { status?: number }).status = status;
  }
  return error;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const startedAt = Date.now();
  const method = options.method || 'GET';
  console.info('[adminApi] request.start', {
    method,
    path,
  });

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers,
    });
  } catch (error) {
    console.error('[adminApi] request.network_error', {
      method,
      path,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }

  if (response.status === 204) {
    console.info('[adminApi] request.success', {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return undefined as T;
  }

  let data: any;
  try {
    data = await response.json();
  } catch (error) {
    console.error('[adminApi] request.parse_error', {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw toApiError(`Invalid JSON response from ${path}`, response.status);
  }

  if (!response.ok) {
    console.error('[adminApi] request.error', {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      message: data?.message,
    });
    throw toApiError(data?.message || `HTTP ${response.status}`, response.status);
  }

  console.info('[adminApi] request.success', {
    method,
    path,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return data as T;
}

export async function login(password: string): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function fetchAuthSession(): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/session');
}

export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function fetchSchedules(): Promise<Schedule[]> {
  const data = await request<{ schedules: Schedule[] }>('/api/schedules');
  return data.schedules;
}

export async function createSchedule(payload: Partial<Schedule>): Promise<Schedule> {
  const data = await request<{ schedule: Schedule }>('/api/schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.schedule;
}

export async function updateSchedule(id: string, payload: Partial<Schedule>): Promise<Schedule> {
  const data = await request<{ schedule: Schedule }>(`/api/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return data.schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  await request<void>(`/api/schedules/${id}`, {
    method: 'DELETE',
  });
}

export async function runScheduleNow(id: string): Promise<ScheduleRun> {
  const data = await request<{ run: ScheduleRun }>(`/api/schedules/${id}/run-now`, {
    method: 'POST',
  });
  return data.run;
}

export async function fetchRuns(limit = 50): Promise<ScheduleRun[]> {
  const data = await request<{ runs: ScheduleRun[] }>(`/api/runs?limit=${limit}`);
  return data.runs;
}

export async function fetchSchedulerConfig(): Promise<SchedulerConfig> {
  const data = await request<{ config: SchedulerConfig }>('/api/scheduler/config');
  return data.config;
}

export async function updateSchedulerConfig(payload: { schedule: string; timeZone: string }): Promise<SchedulerConfig> {
  const data = await request<{ config: SchedulerConfig }>('/api/scheduler/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return data.config;
}
