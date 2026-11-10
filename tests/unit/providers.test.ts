import { studyFixture } from '../study-fixture.js';
import { describe, expect, it } from 'vitest';
import { createProvider } from '../../packages/server/providers.js';
import { readConfig } from '../../packages/server/config.js';
import type { GuideInput } from '../../packages/shared/contracts.js';

const guide: GuideInput = {
  title: 'MIPS registers',
  body: 'MIPS arithmetic operates on registers. Load and store instructions access memory.',
  demoScenario: 'normal',
  mode: 'notes',
  subject: 'computer-science',
};
describe('AI provider boundary', () => {
  it('labels mock output and simulates a transient failure only on the first attempt', async () => {
    const provider = createProvider(readConfig({ AI_PROVIDER: 'mock', MOCK_DELAY_MS: '0' }));
    const result = await provider.analyze(guide, 1, new AbortController().signal);
    expect(result.provider).toBe('mock');
    expect(result.result.questions).toHaveLength(3);
    await expect(
      provider.analyze({ ...guide, demoScenario: 'transient' }, 1, new AbortController().signal),
    ).rejects.toMatchObject({ retryable: true });
    await expect(
      provider.analyze({ ...guide, demoScenario: 'transient' }, 2, new AbortController().signal),
    ).resolves.toMatchObject({ provider: 'mock' });
  });
  it('uses the real Gemini SDK request/response path with a fake network response', async () => {
    let requestBody = '';
    const fakeFetch: typeof fetch = async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(studyFixture),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { totalTokenCount: 120 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const provider = createProvider(
      readConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' }),
      fakeFetch,
    );
    const result = await provider.analyze(guide, 1, new AbortController().signal);
    expect(result.tokens).toBe(120);
    expect(result.result.questions).toHaveLength(3);
    expect(requestBody).toContain('application/json');
    expect(requestBody).toContain('MIPS registers');
    expect(requestBody).toContain('untrusted study content');
    expect(JSON.parse(requestBody).generationConfig.maxOutputTokens).toBe(8192);
    expect(JSON.parse(JSON.parse(requestBody).contents[0].parts[0].text).mode).toBe('notes');
  });
  it('honors Retry-After without hidden SDK retries', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: 429, message: 'quota limit' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '12' },
      });
    };
    const provider = createProvider(
      readConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' }),
      fakeFetch,
    );
    await expect(provider.analyze(guide, 1, new AbortController().signal)).rejects.toMatchObject({
      code: 'provider_rate_limit',
      retryAfterMs: 12000,
    });
    expect(calls).toBe(1);
  });
  it('rejects schema-invalid model output', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"category":"made-up"}' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const provider = createProvider(
      readConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' }),
      fakeFetch,
    );
    await expect(provider.analyze(guide, 1, new AbortController().signal)).rejects.toMatchObject({
      code: 'provider_invalid_output',
    });
  });
  it('honors Google RetryInfo when no Retry-After header is present', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'quota exceeded',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '45s' }],
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    const provider = createProvider(
      readConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' }),
      fakeFetch,
    );
    await expect(provider.analyze(guide, 1, new AbortController().signal)).rejects.toMatchObject({
      retryAfterMs: 45000,
    });
  });
});

it('keeps arbitrary mock topics labeled as templates', async () => {
  const provider = createProvider(readConfig({ MOCK_DELAY_MS: '0' }));
  const response = await provider.analyze(
    { ...guide, title: 'Organic chemistry', mode: 'topic', body: '' },
    1,
    new AbortController().signal,
  );
  expect(response.result.summary).toContain('Study template');
  expect(response.result.gaps[0]).toContain('Mock mode cannot');
});
it('handles truncated model output through bounded retries', async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(studyFixture) }] }, finishReason: 'MAX_TOKENS' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  const provider = createProvider(
    readConfig({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'test-model', GEMINI_API_KEY: 'test-key' }),
    fakeFetch,
  );
  await expect(provider.analyze(guide, 1, new AbortController().signal)).rejects.toMatchObject({
    code: 'provider_truncated_output',
    retryable: true,
  });
});
