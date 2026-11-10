import { studyFixture } from '../study-fixture.js';
import { describe, expect, it } from 'vitest';
import { guideInputSchema, studyResultSchema, messageSchema } from '../../packages/shared/contracts.js';
import {
  ProviderError,
  retryDelayMs,
  classifyProviderError,
  parseRetryAfter,
} from '../../packages/server/retry.js';

describe('study input and output boundaries', () => {
  it('requires notes but accepts a topic with no notes', () => {
    expect(guideInputSchema.parse({ title: '  MIPS  ', mode: 'topic' })).toMatchObject({
      title: 'MIPS',
      body: '',
      subject: 'other',
    });
    expect(guideInputSchema.safeParse({ title: 'MIPS', mode: 'notes', body: '   ' }).success).toBe(false);
    expect(guideInputSchema.safeParse({ title: ' ', mode: 'topic' }).success).toBe(false);
    expect(guideInputSchema.safeParse({ title: 'MIPS', mode: 'topic', body: 'x'.repeat(8001) }).success).toBe(
      false,
    );
    expect(guideInputSchema.safeParse({ title: 'MIPS', mode: 'topic', status: 'completed' }).success).toBe(
      false,
    );
  });
  it('rejects obsolete support output, empty answers and unbounded question lists', () => {
    expect(
      studyResultSchema.safeParse({ category: 'billing', summary: 'old', suggestedReply: 'old' }).success,
    ).toBe(false);
    expect(studyResultSchema.safeParse(studyFixture).success).toBe(true);
    expect(
      studyResultSchema.safeParse({
        ...studyFixture,
        questions: [{ ...studyFixture.questions[0], answer: ' ' }, ...studyFixture.questions.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      studyResultSchema.safeParse({ ...studyFixture, questions: Array(6).fill(studyFixture.questions[0]) })
        .success,
    ).toBe(false);
    expect(studyResultSchema.safeParse({ ...studyFixture, concepts: [] }).success).toBe(false);
  });
});

describe('retry decisions', () => {
  it('retries rate limiting and service failures but not invalid credentials', () => {
    expect(classifyProviderError({ status: 429 }).retryable).toBe(true);
    expect(classifyProviderError({ status: 503 }).retryable).toBe(true);
    expect(classifyProviderError({ status: 408 }).retryable).toBe(true);
    expect(classifyProviderError({ status: 401 }).retryable).toBe(false);
    expect(classifyProviderError({ status: 403 }).retryable).toBe(false);
  });
  it('uses exponential backoff, caps the base delay, and honors Retry-After', () => {
    expect(retryDelayMs(1, 1000, undefined, () => 0)).toBe(1000);
    expect(retryDelayMs(2, 1000, undefined, () => 0)).toBe(2000);
    expect(retryDelayMs(30, 1000, undefined, () => 0)).toBe(60000);
    expect(retryDelayMs(1, 1000, 90000, () => 0)).toBe(90000);
  });
  it('parses retry delays and preserves sanitized provider errors', () => {
    expect(parseRetryAfter('5', 0)).toBe(5000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 1000)).toBe(9000);
    expect(parseRetryAfter('invalid', 0)).toBeUndefined();
    const error = new ProviderError('mock_transient', true, 100);
    expect(classifyProviderError(error)).toBe(error);
    expect(classifyProviderError(new Error('private guide details')).message).not.toContain('private');
  });
});

it('rejects old support messages instead of treating them as study jobs', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  expect(messageSchema.safeParse({ schemaVersion: 1, ticketId: id, generation: 1 }).success).toBe(false);
  expect(messageSchema.safeParse({ schemaVersion: 2, guideId: id, generation: 1 }).success).toBe(true);
});
