import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AppConfig, Guide, GuidePage } from '../packages/shared/contracts.js';
import { sampleGuides } from '../packages/shared/samples.js';

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'mock' },
    guides: { type: 'string', default: '100' },
    concurrency: { type: 'string', default: '10' },
    workers: { type: 'string' },
    'timeout-ms': { type: 'string', default: '600000' },
  },
});
const total = Number(values.guides),
  concurrency = Number(values.concurrency),
  timeout = Number(values['timeout-ms']);
if (
  !Number.isInteger(total) ||
  total < 1 ||
  total > 5000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 50 ||
  !Number.isFinite(timeout) ||
  timeout < 1000
)
  throw new Error('Use 1–5000 guides, 1–50 concurrent submissions, and a positive timeout.');
if (values.provider !== 'mock')
  throw new Error(
    'Infrastructure benchmarks use mock AI. Use evaluate for explicitly budgeted Gemini quality checks.',
  );
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
const config = await get<AppConfig>('/api/config');
if (config.provider !== 'mock') throw new Error('Switch the running server to mock mode first.');
const runId = randomUUID().slice(0, 8),
  titlePrefix = `Benchmark ${runId}`;
const accepted: { id: string; acceptanceMs: number }[] = [];
const started = performance.now();
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const index = next++;
      const sample = sampleGuides[index % 4];
      const start = performance.now();
      const response = await fetch(`${base}/api/guides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `benchmark-${runId}-${index}` },
        body: JSON.stringify({ ...sample, title: `${titlePrefix} ${index}: ${sample.title}` }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Submission failed: HTTP ${response.status}`);
      accepted.push({
        id: ((await response.json()) as { id: string }).id,
        acceptanceMs: performance.now() - start,
      });
    }
  }),
);
let guides: Guide[] = [];
while (performance.now() - started < timeout) {
  guides = [];
  for (let page = 1; page <= Math.ceil(total / 100); page++) {
    const result = await get<GuidePage>(
      `/api/guides?page=${page}&pageSize=100&q=${encodeURIComponent(titlePrefix)}`,
    );
    guides.push(...result.items);
  }
  const finished = guides.filter((t) => t.status === 'completed' || t.status === 'failed').length;
  if (finished === total) break;
  await sleep(1000);
}
const elapsedMs = performance.now() - started;
const percentile = (numbers: number[], p: number) =>
  numbers.length ? [...numbers].sort((a, b) => a - b)[Math.ceil(numbers.length * p) - 1] : null;
const completed = guides.filter((t) => t.status === 'completed');
const completionMs = completed.map((t) => Date.parse(t.completedAt!) - Date.parse(t.createdAt));
const report = {
  runId,
  createdAt: new Date().toISOString(),
  provider: config.provider,
  transport: config.transport,
  declaredWorkerCount: values.workers ? Number(values.workers) : null,
  guideCount: total,
  submissionConcurrency: concurrency,
  completed: completed.length,
  failed: guides.filter((t) => t.status === 'failed').length,
  pending: total - guides.filter((t) => ['completed', 'failed'].includes(t.status)).length,
  elapsedMs,
  observedCompletedPerMinute: completed.length / (elapsedMs / 60000),
  acceptanceP50Ms: percentile(
    accepted.map((t) => t.acceptanceMs),
    0.5,
  ),
  acceptanceP95Ms: percentile(
    accepted.map((t) => t.acceptanceMs),
    0.95,
  ),
  completionP50Ms: percentile(completionMs, 0.5),
  completionP95Ms: percentile(completionMs, 0.95),
  caveat:
    'Synthetic mock workload. Wall time includes submission and polling. Not Gemini performance. Worker count is operator-supplied.',
  samples: guides.map((t) => ({
    id: t.id,
    status: t.status,
    attempts: t.attempts,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    acceptanceMs: accepted.find((a) => a.id === t.id)?.acceptanceMs,
  })),
};
await mkdir('test-results', { recursive: true });
const path = `test-results/benchmark-${runId}.json`;
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, samples: undefined, file: path }, null, 2));
if (report.pending || report.failed) process.exitCode = 1;
