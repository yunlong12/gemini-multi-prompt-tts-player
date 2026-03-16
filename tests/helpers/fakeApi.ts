import { ManualRun, Schedule, SchedulerConfig, ScheduleRun } from '../../types';
import { vi } from 'vitest';

type RouteHandler = (request: Request, state: MockApiState) => Response | Promise<Response>;

export interface MockApiState {
  authenticated: boolean;
  session: { expiresAt: string } | null;
  manualRuns: ManualRun[];
  schedules: Schedule[];
  runs: ScheduleRun[];
  schedulerConfig: SchedulerConfig;
  requests: Array<{ method: string; path: string; body: unknown }>;
}

export interface MockApiOptions {
  authenticated?: boolean;
  session?: { expiresAt: string } | null;
  manualRuns?: ManualRun[];
  schedules?: Schedule[];
  runs?: ScheduleRun[];
  schedulerConfig?: SchedulerConfig;
  handlers?: Record<string, RouteHandler>;
}

const AUDIO_BYTES = new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 65, 86, 69]).buffer;

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

const noContent = () => new Response(null, { status: 204 });

const unauthorized = () => json({ message: 'unauthorized' }, { status: 401 });

const getRouteKey = (method: string, pathname: string) => `${method.toUpperCase()} ${pathname}`;

const readJsonBody = async (request: Request) => {
  const text = await request.text();
  return text ? JSON.parse(text) : {};
};

export const createMockApi = (options: MockApiOptions = {}) => {
  const state: MockApiState = {
    authenticated: options.authenticated ?? false,
    session: options.session ?? (options.authenticated ? { expiresAt: '2026-03-16T10:00:00.000Z' } : null),
    manualRuns: [...(options.manualRuns || [])],
    schedules: [...(options.schedules || [])],
    runs: [...(options.runs || [])],
    schedulerConfig:
      options.schedulerConfig ||
      ({
        jobName: 'schedule-runner',
        location: 'europe-west1',
        schedule: '*/5 * * * *',
        timeZone: 'Europe/Paris',
        uri: 'https://example.com/job',
        state: 'ENABLED',
      } as SchedulerConfig),
    requests: [],
  };

  const defaultHandlers: Record<string, RouteHandler> = {
    'GET /api/auth/session': async () => (state.authenticated && state.session ? json(state.session) : unauthorized()),
    'POST /api/auth/login': async (request) => {
      const body = (await readJsonBody(request)) as { password?: string };
      if (body.password === 'secret') {
        state.authenticated = true;
        state.session = { expiresAt: '2026-03-16T10:00:00.000Z' };
        return json(state.session);
      }
      return json({ message: 'Invalid password' }, { status: 401 });
    },
    'POST /api/auth/logout': async () => {
      state.authenticated = false;
      state.session = null;
      return noContent();
    },
    'GET /api/manual-runs': async () => (state.authenticated ? json({ runs: state.manualRuns }) : unauthorized()),
    'POST /api/manual-runs': async (request) => {
      if (!state.authenticated) return unauthorized();
      const body = (await readJsonBody(request)) as {
        prompts?: string[];
        ttsModel?: string;
        enableGoogleSearch?: boolean;
        enableUrlContext?: boolean;
      };
      const created = (body.prompts || []).map((prompt, index) => ({
        id: `manual-created-${state.manualRuns.length + index + 1}`,
        prompt,
        status: 'queued',
        generatedText: '',
        groundingLinks: [],
        ttsModel: body.ttsModel || 'gemini-2.5-pro-preview-tts',
        toolOptions: {
          enableGoogleSearch: body.enableGoogleSearch ?? true,
          enableUrlContext: body.enableUrlContext ?? false,
        },
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-15T10:00:00.000Z',
      })) as ManualRun[];
      state.manualRuns = [...created, ...state.manualRuns];
      return json({ runs: created }, { status: 201 });
    },
    'DELETE /api/manual-runs/:id': async (_request, currentState) => {
      if (!currentState.authenticated) return unauthorized();
      return noContent();
    },
    'GET /api/schedules': async () => (state.authenticated ? json({ schedules: state.schedules }) : unauthorized()),
    'POST /api/schedules': async (request) => {
      if (!state.authenticated) return unauthorized();
      const body = (await readJsonBody(request)) as Partial<Schedule>;
      const created = {
        ...body,
        id: `schedule-${state.schedules.length + 1}`,
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-15T10:00:00.000Z',
        nextRunAt: '2026-03-16T08:00:00.000Z',
      } as Schedule;
      state.schedules = [...state.schedules, created];
      return json({ schedule: created });
    },
    'PUT /api/scheduler/config': async (request) => {
      if (!state.authenticated) return unauthorized();
      const body = (await readJsonBody(request)) as { schedule: string; timeZone: string };
      state.schedulerConfig = {
        ...state.schedulerConfig,
        schedule: body.schedule,
        timeZone: body.timeZone,
      };
      return json({ config: state.schedulerConfig });
    },
    'GET /api/scheduler/config': async () => (state.authenticated ? json({ config: state.schedulerConfig }) : unauthorized()),
    'GET /api/runs': async () => (state.authenticated ? json({ runs: state.runs }) : unauthorized()),
  };

  const resolveDynamicRoute = (method: string, pathname: string): string | null => {
    if (method === 'DELETE' && pathname.startsWith('/api/manual-runs/')) return 'DELETE /api/manual-runs/:id';
    if (method === 'PUT' && pathname.startsWith('/api/schedules/')) return 'PUT /api/schedules/:id';
    if (method === 'DELETE' && pathname.startsWith('/api/schedules/')) return 'DELETE /api/schedules/:id';
    if (method === 'POST' && pathname.endsWith('/run-now') && pathname.startsWith('/api/schedules/')) return 'POST /api/schedules/:id/run-now';
    if (method === 'DELETE' && pathname.startsWith('/api/runs/')) return 'DELETE /api/runs/:id';
    if (method === 'GET' && pathname.startsWith('/api/artifacts/')) return 'GET /api/artifacts/:path';
    return null;
  };

  defaultHandlers['PUT /api/schedules/:id'] = async (request) => {
    if (!state.authenticated) return unauthorized();
    const body = (await readJsonBody(request)) as Partial<Schedule>;
    const id = new URL(request.url).pathname.split('/').pop() as string;
    const current = state.schedules.find((entry) => entry.id === id);
    const updated = { ...current, ...body, id, updatedAt: '2026-03-15T11:00:00.000Z' } as Schedule;
    state.schedules = state.schedules.map((entry) => (entry.id === id ? updated : entry));
    return json({ schedule: updated });
  };
  defaultHandlers['DELETE /api/schedules/:id'] = async (request) => {
    if (!state.authenticated) return unauthorized();
    const id = new URL(request.url).pathname.split('/').pop() as string;
    state.schedules = state.schedules.filter((entry) => entry.id !== id);
    return noContent();
  };
  defaultHandlers['POST /api/schedules/:id/run-now'] = async (request) => {
    if (!state.authenticated) return unauthorized();
    const parts = new URL(request.url).pathname.split('/');
    const id = parts[parts.length - 2] as string;
    const createdRun = {
      id: `run-${state.runs.length + 1}`,
      scheduleId: id,
      startedAt: '2026-03-15T10:30:00.000Z',
      finishedAt: '2026-03-15T10:30:30.000Z',
      status: 'success',
      triggeredBy: 'manual',
      resolvedPrompt: `Triggered ${id}`,
      generatedText: 'Run now output',
      groundingLinks: [],
      audioPath: `audio/${id}.wav`,
    } as ScheduleRun;
    state.runs = [createdRun, ...state.runs];
    return json({ run: createdRun });
  };
  defaultHandlers['DELETE /api/runs/:id'] = async (request) => {
    if (!state.authenticated) return unauthorized();
    const id = new URL(request.url).pathname.split('/').pop() as string;
    state.runs = state.runs.filter((entry) => entry.id !== id);
    return noContent();
  };
  defaultHandlers['GET /api/artifacts/:path'] = async () =>
    new Response(AUDIO_BYTES.slice(0), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
      },
    });

  const handlers = {
    ...defaultHandlers,
    ...(options.handlers || {}),
  };

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const absoluteUrl = rawUrl.startsWith('http') ? rawUrl : `http://localhost${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const request = input instanceof Request ? input : new Request(absoluteUrl, init);
    const url = new URL(request.url, 'http://localhost');
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? await request.clone().text() : '';
    state.requests.push({
      method: request.method.toUpperCase(),
      path: `${url.pathname}${url.search}`,
      body: body ? JSON.parse(body) : undefined,
    });

    const directKey = getRouteKey(request.method, url.pathname);
    const dynamicKey = resolveDynamicRoute(request.method.toUpperCase(), url.pathname);
    const handler = handlers[directKey] || (dynamicKey ? handlers[dynamicKey] : undefined);
    if (!handler) {
      return json({ message: `Unhandled ${request.method} ${url.pathname}` }, { status: 500 });
    }
    return handler(request, state);
  };

  return {
    state,
    fetchMock: vi.fn(fetchMock),
  };
};
