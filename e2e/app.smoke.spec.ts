import { expect, test } from '@playwright/test';

type ApiState = {
  authenticated: boolean;
  session: { expiresAt: string } | null;
  manualRuns: Array<any>;
  schedules: Array<any>;
  runs: Array<any>;
  schedulerConfig: any;
};

const buildState = (): ApiState => ({
  authenticated: false,
  session: null,
  manualRuns: [],
  schedules: [
    {
      id: 'schedule-1',
      name: 'Morning Briefing',
      promptTemplate: 'Summarize {{today}}.',
      enableGoogleSearch: true,
      enableUrlContext: false,
      enabled: true,
      timezone: 'Europe/Paris',
      frequency: 'daily',
      timeOfDay: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      intervalMinutes: 1440,
      ttsModel: 'gemini-2.5-pro-preview-tts',
      outputPrefix: 'daily-briefings',
      nextRunAt: new Date(Date.now() + 3600000).toISOString(),
      lastStatus: 'success',
      lastError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  runs: [],
  schedulerConfig: {
    jobName: 'schedule-runner',
    location: 'europe-west1',
    schedule: '*/5 * * * *',
    timeZone: 'Europe/Paris',
    uri: 'https://example.com/job',
    state: 'ENABLED',
  },
});

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const attachApiMock = async (page: Parameters<typeof test.beforeEach>[0]['page']) => {
  const state = buildState();

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === '/api/auth/session' && method === 'GET') {
      if (!state.authenticated || !state.session) {
        await route.fulfill(json({ message: 'unauthorized' }, 401));
        return;
      }
      await route.fulfill(json(state.session));
      return;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = request.postDataJSON() as { password?: string };
      if (body.password !== 'secret') {
        await route.fulfill(json({ message: 'Invalid password' }, 401));
        return;
      }
      state.authenticated = true;
      state.session = {
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      await route.fulfill(json(state.session));
      return;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      state.authenticated = false;
      state.session = null;
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (pathname === '/api/manual-runs' && method === 'GET') {
      await route.fulfill(json({ runs: state.manualRuns }));
      return;
    }

    if (pathname === '/api/manual-runs' && method === 'POST') {
      const body = request.postDataJSON() as {
        prompts?: string[];
        ttsModel?: string;
        enableGoogleSearch?: boolean;
        enableUrlContext?: boolean;
      };
      const runs = (body.prompts || []).map((prompt, index) => ({
        id: `manual-${state.manualRuns.length + index + 1}`,
        prompt,
        status: 'queued',
        generatedText: '',
        groundingLinks: [],
        ttsModel: body.ttsModel || 'gemini-2.5-pro-preview-tts',
        toolOptions: {
          enableGoogleSearch: body.enableGoogleSearch ?? true,
          enableUrlContext: body.enableUrlContext ?? false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      state.manualRuns = [...runs, ...state.manualRuns];
      await route.fulfill(json({ runs }, 201));
      return;
    }

    if (pathname === '/api/schedules' && method === 'GET') {
      await route.fulfill(json({ schedules: state.schedules }));
      return;
    }

    if (pathname === '/api/runs' && method === 'GET') {
      await route.fulfill(json({ runs: state.runs }));
      return;
    }

    if (pathname === '/api/scheduler/config' && method === 'GET') {
      await route.fulfill(json({ config: state.schedulerConfig }));
      return;
    }

    if (pathname === '/api/scheduler/config' && method === 'PUT') {
      const body = request.postDataJSON() as { schedule: string; timeZone: string };
      state.schedulerConfig = {
        ...state.schedulerConfig,
        schedule: body.schedule,
        timeZone: body.timeZone,
      };
      await route.fulfill(json({ config: state.schedulerConfig }));
      return;
    }

    if (pathname === '/api/schedules/schedule-1/run-now' && method === 'POST') {
      const run = {
        id: `run-${state.runs.length + 1}`,
        scheduleId: 'schedule-1',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'success',
        triggeredBy: 'manual',
        resolvedPrompt: 'Triggered schedule-1',
        generatedText: 'Run now output',
        groundingLinks: [],
        audioPath: 'audio/schedule-1.wav',
      };
      state.runs = [run, ...state.runs];
      await route.fulfill(json({ run }));
      return;
    }

    if (pathname.startsWith('/api/artifacts/') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: 'RIFF',
      });
      return;
    }

    await route.fulfill(json({ message: `Unhandled ${method} ${pathname}` }, 500));
  });
};

test.beforeEach(async ({ page }) => {
  await attachApiMock(page);
});

test('shows the login gate when unauthenticated', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  await expect(page.getByText(/sign in to enter the app/i)).toBeVisible();
});

test('signs in and submits a manual prompt', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('Admin password').fill('secret');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('heading', { name: /input prompts/i })).toBeVisible();
  await page.getByPlaceholder(/who won the 2024 super bowl/i).fill('First prompt');
  await page.getByRole('button', { name: /generate & prepare audio/i }).click();

  await expect(page.getByText(/add to queue/i)).toBeVisible();
});

test('keeps schedule actions clickable after login', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('Admin password').fill('secret');
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.getByRole('button', { name: /^schedules$/i }).click();
  await expect(page.getByText(/schedule manager/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /refresh schedules/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /run now/i })).toBeVisible();

  await page.getByRole('button', { name: /run now/i }).click();
  await expect(page.getByRole('heading', { name: /scheduled runs/i })).toBeVisible();
});
