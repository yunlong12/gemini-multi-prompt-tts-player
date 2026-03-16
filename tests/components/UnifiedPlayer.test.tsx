import React, { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { UnifiedPlayer } from '../../components/UnifiedPlayer';
import { ItemStatus, PlayerUiState, ProcessItem, ScheduleRun } from '../../types';

const initialPlayerUiState = (): PlayerUiState => ({
  checkedPlayerItemIds: {},
  selectedPlayerItemId: null,
  expandedAudioPartKeys: {},
  currentlyPlayingPlayerItemId: null,
  currentlyPlayingPartIndex: null,
  playerProgress: 0,
  playerDuration: 0,
  isPlayerPlaying: false,
  isPlayingSequence: false,
  queue: [],
  queueIndex: 0,
  pauseOffset: 0,
});

const makeManualItem = (id: string, prompt: string): ProcessItem => ({
  id,
  prompt,
  answer: `${prompt} answer`,
  audioBuffer: null,
  audioPath: `audio/${id}.wav`,
  audioDownloadUrl: `/api/artifacts/audio/${id}.wav`,
  status: ItemStatus.READY,
  groundingLinks: [],
  timestamp: Date.parse('2026-03-16T10:02:00.000Z'),
});

const makeRun = (id: string, prompt: string): ScheduleRun => ({
  id,
  scheduleId: 'schedule-1',
  startedAt: '2026-03-16T10:01:00.000Z',
  finishedAt: '2026-03-16T10:01:05.000Z',
  status: 'success',
  triggeredBy: 'scheduler',
  resolvedPrompt: prompt,
  generatedText: `${prompt} output`,
  groundingLinks: [],
  audioPath: `audio/${id}.wav`,
});

const PlayerHarness: React.FC<{
  items: ProcessItem[];
  runs: ScheduleRun[];
}> = ({ items, runs }) => {
  const [playerUiState, setPlayerUiState] = useState<PlayerUiState>(() => initialPlayerUiState());
  const [persistedScheduledRuns, setPersistedScheduledRuns] = useState({});
  const [manualItems, setManualItems] = useState(items);
  const createBuffer = () => new AudioContext({ sampleRate: 24000 }).createBuffer(1, 24000, 24000);

  useEffect(() => {
    setManualItems(items);
  }, [items]);

  return (
    <UnifiedPlayer
      items={manualItems}
      runs={runs}
      playerUiState={playerUiState}
      setPlayerUiState={setPlayerUiState}
      persistedScheduledRuns={persistedScheduledRuns}
      setPersistedScheduledRuns={setPersistedScheduledRuns}
      setItems={setManualItems}
      setSelectedItemId={vi.fn()}
      addLog={vi.fn()}
      autoplayRequestId={null}
      onAutoplayRequestHandled={vi.fn()}
      scheduledAudioBuffersById={{}}
      scheduledAudioLoadStateById={{}}
      scheduledAudioErrorsById={{}}
      loadManualRunAudio={vi.fn(async () => createBuffer())}
      loadScheduledRunAudio={vi.fn(async () => createBuffer())}
    />
  );
};

describe('UnifiedPlayer queue reconciliation', () => {
  it('keeps mixed play-all playback active when unrelated player items are added during playback', async () => {
    const user = userEvent.setup();
    const initialManual = makeManualItem('manual-1', 'Manual queue item');
    const scheduledRun = makeRun('run-1', 'Scheduled queue item');
    const addedManual = makeManualItem('manual-2', 'Background refresh item');

    const { rerender } = render(<PlayerHarness items={[initialManual]} runs={[scheduledRun]} />);

    await user.click(screen.getByRole('checkbox', { name: /select player item manual queue item/i }));
    await user.click(screen.getByRole('checkbox', { name: /select player item scheduled queue item/i }));
    await user.click(screen.getByRole('button', { name: /play all selected/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /manual queue item/i })).toBeInTheDocument();
    });

    rerender(<PlayerHarness items={[addedManual, initialManual]} runs={[scheduledRun]} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
    });

    const sources = (globalThis as any).__mockAudioSources as Array<{ onended?: (() => void) | null }>;
    sources[sources.length - 1]?.onended?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /scheduled queue item/i })).toBeInTheDocument();
    });
  });

  it('keeps manual play-all playback active when the manual list refreshes during playback', async () => {
    const user = userEvent.setup();
    const firstManual = makeManualItem('manual-1', 'First manual item');
    const secondManual = makeManualItem('manual-2', 'Second manual item');
    const refreshedManual = makeManualItem('manual-3', 'Refreshed manual item');

    const { rerender } = render(<PlayerHarness items={[firstManual, secondManual]} runs={[]} />);

    await user.click(screen.getByRole('checkbox', { name: /select player item first manual item/i }));
    await user.click(screen.getByRole('checkbox', { name: /select player item second manual item/i }));
    await user.click(screen.getByRole('button', { name: /play all selected/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /first manual item/i })).toBeInTheDocument();
    });

    rerender(<PlayerHarness items={[refreshedManual, firstManual, secondManual]} runs={[]} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
    });

    const sources = (globalThis as any).__mockAudioSources as Array<{ onended?: (() => void) | null }>;
    sources[sources.length - 1]?.onended?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /second manual item/i })).toBeInTheDocument();
    });
  });
});
