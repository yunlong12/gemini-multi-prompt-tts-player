import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import App from '../../App';
import { savePersistedState } from '../../utils/storage';
import { MockApiOptions, createMockApi } from './fakeApi';

interface RenderAppOptions extends MockApiOptions {
  persistedState?: Parameters<typeof savePersistedState>[0];
}

export const renderApp = async (options: RenderAppOptions = {}) => {
  if (options.persistedState) {
    await savePersistedState(options.persistedState);
  }

  const api = createMockApi(options);
  vi.stubGlobal('fetch', api.fetchMock);

  const result = render(<App />);

  return {
    ...result,
    api,
  };
};
