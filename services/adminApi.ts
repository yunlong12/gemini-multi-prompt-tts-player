import { AuthSession, Schedule, SchedulerConfig, ScheduleRun } from '../types';

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const startedAt = Date.now();
  const method = options.method || 'GET';
  console.info('[adminApi] request.start', {
    method,
    path,
    hasToken: Boolean(token),
  });
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
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
    throw new Error(`Invalid JSON response from ${path}`);
  }
  if (!response.ok) {
    console.error('[adminApi] request.error', {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      message: data?.message,
    });
    throw new Error(data?.message || `HTTP ${response.status}`);
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

export async function fetchSchedules(token: string): Promise<Schedule[]> {
  const data = await request<{ schedules: Schedule[] }>('/api/schedules', {}, token);
  return data.schedules;
}

export async function createSchedule(token: string, payload: Partial<Schedule>): Promise<Schedule> {
  const data = await request<{ schedule: Schedule }>(
    '/api/schedules',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
  return data.schedule;
}

export async function updateSchedule(token: string, id: string, payload: Partial<Schedule>): Promise<Schedule> {
  const data = await request<{ schedule: Schedule }>(
    `/api/schedules/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token
  );
  return data.schedule;
}

export async function deleteSchedule(token: string, id: string): Promise<void> {
  await request<void>(
    `/api/schedules/${id}`,
    {
      method: 'DELETE',
    },
    token
  );
}

export async function runScheduleNow(token: string, id: string): Promise<ScheduleRun> {
  const data = await request<{ run: ScheduleRun }>(
    `/api/schedules/${id}/run-now`,
    {
      method: 'POST',
    },
    token
  );
  return data.run;
}

export async function fetchRuns(token: string, limit = 50): Promise<ScheduleRun[]> {
  const data = await request<{ runs: ScheduleRun[] }>(`/api/runs?limit=${limit}`, {}, token);
  return data.runs;
}

export async function fetchSchedulerConfig(token: string): Promise<SchedulerConfig> {
  const data = await request<{ config: SchedulerConfig }>('/api/scheduler/config', {}, token);
  return data.config;
}

export async function updateSchedulerConfig(token: string, payload: { schedule: string; timeZone: string }): Promise<SchedulerConfig> {
  const data = await request<{ config: SchedulerConfig }>(
    '/api/scheduler/config',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token
  );
  return data.config;
}
