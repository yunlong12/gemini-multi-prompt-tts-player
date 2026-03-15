import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ResultCard } from '../../components/ResultCard';
import { ItemStatus } from '../../types';

describe('ResultCard', () => {
  it('shows the expand toggle for long answers and toggles its label', async () => {
    const user = userEvent.setup();
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });

    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalAddEventListener = window.addEventListener;
    const originalRemoveEventListener = window.removeEventListener;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const addEventListenerMock = vi.fn();
    const removeEventListenerMock = vi.fn();

    window.requestAnimationFrame = requestAnimationFrameMock;
    window.addEventListener = addEventListenerMock;
    window.removeEventListener = removeEventListenerMock;

    try {
      render(
        <ResultCard
          item={{
            id: 'result-1',
            prompt: 'Prompt',
            answer: 'A'.repeat(600),
            audioBuffer: null,
            status: ItemStatus.READY,
            groundingLinks: [],
            timestamp: Date.now(),
          }}
          isActive={false}
        />
      );

      const toggle = screen.getByRole('button', { name: /expand text/i });
      const before = toggle.textContent;
      expect(toggle).toBeInTheDocument();
      await user.click(toggle);
      expect(toggle.textContent).not.toBe(before);
      expect(toggle).toHaveTextContent(/collapse text/i);
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.addEventListener = originalAddEventListener;
      window.removeEventListener = originalRemoveEventListener;
    }
  });

  it('renders a readable download action for audio parts', () => {
    render(
      <ResultCard
        item={{
          id: 'result-2',
          prompt: 'Prompt',
          answer: 'Short answer',
          audioBuffer: null,
          audioParts: [{ partIndex: 1, partCount: 1, text: 'Part text', audioPath: 'audio/part-1.wav' }],
          status: ItemStatus.READY,
          groundingLinks: [],
          timestamp: Date.now(),
        }}
        isActive={false}
      />
    );

    expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument();
  });
});
