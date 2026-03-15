import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { makeManualRun, makeRun, makeSchedule, makeSchedulerConfig } from './helpers/fixtures';
import { renderApp } from './helpers/renderApp';

const waitForAuthenticatedShell = async () => {
  expect(await screen.findByRole('heading', { name: /input prompts/i })).toBeInTheDocument();
};

describe('App button regression coverage', () => {
  it('keeps sign in disabled until a password is entered and logs in successfully', async () => {
    const user = userEvent.setup();
    await renderApp();

    const signInButton = await screen.findByRole('button', { name: /sign in/i });
    expect(signInButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/admin password/i), 'secret');
    expect(signInButton).toBeEnabled();
    await user.click(signInButton);

    await waitForAuthenticatedShell();
    expect(screen.getByText(/gemini audio summarizer/i)).toBeInTheDocument();
  });

  it('shows login failure and rate-limit warning on rejected auth', async () => {
    const user = userEvent.setup();
    await renderApp({
      handlers: {
        'POST /api/auth/login': async () =>
          new Response(JSON.stringify({ message: 'Daily login limit reached: 100 attempts per day.' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    });

    await user.type(await screen.findByPlaceholderText(/admin password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/usage limit reached/i)).toBeInTheDocument();
    expect(screen.getAllByText(/daily login limit reached/i).length).toBeGreaterThan(0);
  });

  it('submits trimmed prompts with selected model and tool options', async () => {
    const user = userEvent.setup();
    const { api } = await renderApp({
      authenticated: true,
      manualRuns: [],
      schedules: [makeSchedule()],
      runs: [],
      schedulerConfig: makeSchedulerConfig(),
    });

    await waitForAuthenticatedShell();

    await user.click(screen.getByRole('button', { name: /google search on/i }));
    await user.click(screen.getByRole('button', { name: /url context off/i }));
    await user.selectOptions(screen.getByTitle(/select tts model/i), 'gemini-2.5-flash-preview-tts');
    await user.type(screen.getByPlaceholderText(/who won the 2024 super bowl/i), ' first prompt \n\n second prompt ');
    await user.click(screen.getByRole('button', { name: /generate & prepare audio/i }));

    await waitFor(() => {
      const createRequest = api.state.requests.find((entry) => entry.method === 'POST' && entry.path === '/api/manual-runs');
      expect(createRequest).toBeTruthy();
      expect(createRequest?.body).toMatchObject({
        prompts: ['first prompt', 'second prompt'],
        ttsModel: 'gemini-2.5-flash-preview-tts',
        enableGoogleSearch: false,
        enableUrlContext: true,
      });
    });
  });

  it('keeps existing manual results visible when manual submit is rate-limited', async () => {
    const user = userEvent.setup();
    await renderApp({
      authenticated: true,
      manualRuns: [makeManualRun()],
      schedules: [makeSchedule()],
      handlers: {
        'POST /api/manual-runs': async () =>
          new Response(JSON.stringify({ message: 'Daily text generation limit reached: 200 requests per day.' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    });

    await waitForAuthenticatedShell();
    expect(await screen.findByRole('heading', { name: 'Daily summary' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/who won the 2024 super bowl/i), 'new prompt');
    await user.click(screen.getByRole('button', { name: /generate & prepare audio/i }));

    expect((await screen.findAllByText(/daily text generation limit reached/i)).length).toBeGreaterThan(0);
    expect(screen.getByText('Daily summary')).toBeInTheDocument();
  });

  it('switches tabs, updates scheduler polling, refreshes schedules, and signs out', async () => {
    const user = userEvent.setup();
    const { api } = await renderApp({
      authenticated: true,
      schedules: [makeSchedule()],
      runs: [makeRun()],
      schedulerConfig: makeSchedulerConfig(),
    });

    await waitForAuthenticatedShell();

    await user.click(screen.getByRole('button', { name: /player/i }));
    expect(await screen.findByText(/audio list/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^runs$/i }));
    expect(await screen.findByRole('heading', { name: /scheduled runs/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^schedules$/i }));
    expect(await screen.findByText(/schedule manager/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/polling interval preset/i), '10');
    await user.click(screen.getByRole('button', { name: /update polling/i }));

    await waitFor(() => {
      const updateRequest = api.state.requests.find((entry) => entry.method === 'PUT' && entry.path === '/api/scheduler/config');
      expect(updateRequest?.body).toMatchObject({
        schedule: '*/10 * * * *',
        timeZone: 'Europe/Paris',
      });
    });

    await user.click(screen.getByRole('button', { name: /refresh schedules/i }));
    await waitFor(() => {
      expect(api.state.requests.filter((entry) => entry.method === 'GET' && entry.path.startsWith('/api/schedules')).length).toBeGreaterThan(1);
    });

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('lets schedule actions edit, update, run now, and delete', async () => {
    const user = userEvent.setup();
    const { api } = await renderApp({
      authenticated: true,
      schedules: [makeSchedule()],
      runs: [],
      schedulerConfig: makeSchedulerConfig(),
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /^schedules$/i }));
    expect(await screen.findByText(/schedule manager/i)).toBeInTheDocument();

    const scheduleCard = screen.getByText('Morning Briefing').closest('div[class*="rounded-[1.4rem]"]');
    expect(scheduleCard).toBeTruthy();

    await user.click(within(scheduleCard as HTMLElement).getByRole('button', { name: /schedule enabled/i }));
    await waitFor(() => {
      const toggleRequest = api.state.requests.find((entry) => entry.method === 'PUT' && entry.path === '/api/schedules/schedule-1' && entry.body && (entry.body as any).enabled === false);
      expect(toggleRequest).toBeTruthy();
    });
    expect(await screen.findByRole('button', { name: /schedule disabled/i })).toBeInTheDocument();

    await user.click(within(scheduleCard as HTMLElement).getByRole('button', { name: /^edit$/i }));
    const editForm = screen.getByRole('form', { name: /edit schedule morning briefing/i });
    expect(within(editForm).getByRole('button', { name: /update schedule/i })).toBeInTheDocument();
    expect(within(editForm).getByDisplayValue('Morning Briefing')).toBeInTheDocument();

    const nameInput = within(editForm).getByLabelText(/name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Briefing');
    await user.selectOptions(within(editForm).getByLabelText(/frequency/i), 'custom_interval');
    const intervalInput = within(editForm).getByLabelText(/interval minutes/i);
    fireEvent.change(intervalInput, { target: { value: '30' } });
    await user.click(within(editForm).getByRole('button', { name: /update schedule/i }));

    await waitFor(() => {
      const updateRequest = api.state.requests.find(
        (entry) => entry.method === 'PUT' && entry.path === '/api/schedules/schedule-1' && entry.body && (entry.body as any).name === 'Updated Briefing'
      );
      expect(updateRequest?.body).toMatchObject({ name: 'Updated Briefing', frequency: 'custom_interval', intervalMinutes: 30 });
    });

    await user.click(within(scheduleCard as HTMLElement).getByRole('button', { name: /run now/i }));
    expect(await screen.findByRole('heading', { name: /scheduled runs/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^schedules$/i }));
    const updatedCard = screen.getByText('Updated Briefing').closest('div[class*="rounded-[1.4rem]"]');
    expect(updatedCard).toBeTruthy();
    await user.click(within(updatedCard as HTMLElement).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(api.state.requests.some((entry) => entry.method === 'DELETE' && entry.path === '/api/schedules/schedule-1')).toBe(true);
    });
  });

  it('shows runs delete controls, opens inline confirmation, and deletes a single run', async () => {
    const user = userEvent.setup();
    const run = makeRun({ id: 'run-delete-1', resolvedPrompt: 'Delete me from runs' });
    const { api } = await renderApp({
      authenticated: true,
      schedules: [makeSchedule()],
      runs: [run],
      schedulerConfig: makeSchedulerConfig(),
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /^runs$/i }));

    expect(await screen.findByRole('heading', { name: /scheduled runs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /delete run delete me from runs/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete run delete me from runs/i }));

    expect(screen.getByText(/delete scheduled run/i)).toBeInTheDocument();
    expect(screen.getByText(/delete me from runs/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(api.state.requests.some((entry) => entry.method === 'DELETE' && entry.path === '/api/runs/run-delete-1')).toBe(true);
      expect(screen.queryByText(/delete me from runs/i)).not.toBeInTheDocument();
    });
  });

  it('supports selecting multiple runs and bulk deleting them from the toolbar', async () => {
    const user = userEvent.setup();
    const { api } = await renderApp({
      authenticated: true,
      schedules: [makeSchedule()],
      runs: [
        makeRun({ id: 'run-bulk-1', resolvedPrompt: 'First bulk run' }),
        makeRun({ id: 'run-bulk-2', resolvedPrompt: 'Second bulk run' }),
      ],
      schedulerConfig: makeSchedulerConfig(),
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /^runs$/i }));

    await user.click(screen.getByRole('button', { name: /select all runs/i }));
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeEnabled();
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete selected/i }));
    expect(screen.getByText(/delete 2 scheduled runs/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(api.state.requests.some((entry) => entry.method === 'DELETE' && entry.path === '/api/runs/run-bulk-1')).toBe(true);
      expect(api.state.requests.some((entry) => entry.method === 'DELETE' && entry.path === '/api/runs/run-bulk-2')).toBe(true);
      expect(screen.queryByText(/first bulk run/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/second bulk run/i)).not.toBeInTheDocument();
    });
  });

  it('shows scheduled runs in history even when they only exist in live runs data', async () => {
    const user = userEvent.setup();
    await renderApp({
      authenticated: true,
      manualRuns: [makeManualRun()],
      schedules: [makeSchedule()],
      runs: [
        makeRun({
          id: 'run-history-1',
          resolvedPrompt: 'Scheduled item visible in history',
          audioPath: '',
          audioDownloadUrl: '',
          audioParts: [{ partIndex: 1, partCount: 1, text: 'Segment text', audioPath: 'audio/run-history-1-part-1.wav' }],
        }),
      ],
      schedulerConfig: makeSchedulerConfig(),
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /^history$/i }));

    expect(await screen.findByText(/scheduled item visible in history/i)).toBeInTheDocument();
    expect(screen.getAllByText(/scheduled/i).length).toBeGreaterThan(0);
  });

  it('allows selecting a player item and exercising play, stop, and download controls', async () => {
    const user = userEvent.setup();
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};

    try {
      await renderApp({
        authenticated: true,
        manualRuns: [makeManualRun()],
        schedules: [makeSchedule()],
      });

      await waitForAuthenticatedShell();
      await user.click(screen.getByRole('button', { name: /player/i }));

      await user.click(screen.getByRole('button', { name: /daily summary/i }));
      const playButton = screen.getByRole('button', { name: /^play$/i });
      const stopButton = screen.getByRole('button', { name: /stop/i });
      const downloadButton = screen.getByRole('button', { name: /download/i });
      const playerCheckbox = screen.getByRole('checkbox', { name: /select player item daily summary/i });
      const playAllButton = screen.getByRole('button', { name: /play all selected/i });

      expect(downloadButton).toBeEnabled();
      expect(playAllButton).toBeDisabled();
      await user.click(playerCheckbox);
      expect(playAllButton).toBeEnabled();
      await user.click(playButton);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      });

      await user.click(stopButton);
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  it('starts bulk playback for a checked manual item and keeps it active after the next render tick', async () => {
    const user = userEvent.setup();

    await renderApp({
      authenticated: true,
      manualRuns: [makeManualRun({ prompt: 'Manual bulk playback item', audioDownloadUrl: '' })],
      schedules: [makeSchedule()],
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /player/i }));

    const playerCheckbox = screen.getByRole('checkbox', { name: /select player item manual bulk playback item/i });
    const playAllButton = screen.getByRole('button', { name: /play all selected/i });

    await user.click(playerCheckbox);
    await user.click(playAllButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /manual bulk playback item/i })).toBeInTheDocument();
    });

    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
  });

  it('starts bulk playback for a checked scheduled item', async () => {
    const user = userEvent.setup();
    const run = makeRun({ resolvedPrompt: 'Scheduled bulk playback item' });
    const { api } = await renderApp({
      authenticated: true,
      schedules: [makeSchedule()],
      runs: [run],
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /player/i }));

    await user.click(screen.getByRole('checkbox', { name: /select player item scheduled bulk playback item/i }));
    await user.click(screen.getByRole('button', { name: /play all selected/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /scheduled bulk playback item/i })).toBeInTheDocument();
      expect(api.state.requests.some((entry) => entry.method === 'GET' && entry.path === '/api/artifacts/audio%2Frun-1.wav')).toBe(true);
    });
  });

  it('skips checked non-playable items and still starts the first playable checked item', async () => {
    const user = userEvent.setup();
    const { api } = await renderApp({
      authenticated: true,
      manualRuns: [
        makeManualRun({ id: 'manual-playable', prompt: 'Playable checked item', audioPath: 'audio/manual-playable.wav' }),
        makeManualRun({
          id: 'manual-unplayable',
          prompt: 'Unchecked audio file item',
          audioPath: '',
          audioDownloadUrl: '',
          audioParts: [{ partIndex: 1, partCount: 1, text: 'Part exists but file is unavailable.' }],
        }),
      ],
      schedules: [makeSchedule()],
    });

    await waitForAuthenticatedShell();
    await user.click(screen.getByRole('button', { name: /player/i }));

    await user.click(screen.getByRole('checkbox', { name: /select player item playable checked item/i }));
    await user.click(screen.getByRole('checkbox', { name: /select player item unchecked audio file item/i }));
    await user.click(screen.getByRole('button', { name: /play all selected/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /playable checked item/i })).toBeInTheDocument();
    });

    expect(api.state.requests.some((entry) => entry.method === 'GET' && entry.path === '/api/artifacts/audio%2Fmanual-playable.wav')).toBe(true);
  });
});
