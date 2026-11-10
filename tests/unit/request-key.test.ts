import { afterEach, expect, it, vi } from 'vitest';
import { createRequestKey } from '../../apps/web/src/api.js';

afterEach(() => vi.unstubAllGlobals());
it('creates an idempotency key on HTTP origins where randomUUID is unavailable', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(42) });
  expect(createRequestKey()).toBe('2a'.repeat(16));
});
