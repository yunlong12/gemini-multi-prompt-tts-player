import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

class MockAudioBuffer {
  duration: number;
  sampleRate: number;
  length: number;
  numberOfChannels: number;

  constructor(duration = 1.5, sampleRate = 24000) {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.length = Math.floor(duration * sampleRate);
    this.numberOfChannels = 1;
  }

  getChannelData() {
    return new Float32Array(this.length);
  }
}

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect() {}
  start() {}
  stop() {}
}

class MockAudioContext {
  state: AudioContextState = 'running';
  sampleRate: number;
  currentTime = 0;
  destination = {};

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate || 24000;
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  createBufferSource() {
    const source = new MockAudioBufferSourceNode() as unknown as AudioBufferSourceNode;
    (globalThis as any).__mockAudioSources.push(source);
    return source;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = new MockAudioBuffer(length / sampleRate, sampleRate) as unknown as AudioBuffer;
    Object.defineProperty(buffer, 'numberOfChannels', {
      configurable: true,
      value: numberOfChannels,
    });
    Object.defineProperty(buffer, 'length', {
      configurable: true,
      value: length,
    });
    return buffer;
  }

  decodeAudioData() {
    return Promise.resolve(new MockAudioBuffer() as unknown as AudioBuffer);
  }
}

beforeEach(() => {
  (globalThis as any).__mockAudioSources = [];
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('webkitAudioContext', MockAudioContext);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('confirm', vi.fn(() => true));

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  indexedDB.deleteDatabase('GeminiAudioSummarizerDB');
  delete (globalThis as any).__mockAudioSources;
});
