import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { studyResultSchema, guideInputSchema } from '../packages/shared/contracts.js';
import { createProvider } from '../packages/server/providers.js';
import { loadEnvironment, readConfig } from '../packages/server/config.js';
import { classifyProviderError } from '../packages/server/retry.js';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    dataset: { type: 'string', default: 'fixtures/evaluation.json' },
    limit: { type: 'string', default: '5' },
  },
});
if (!['mock', 'gemini'].includes(values.provider ?? ''))
  throw new Error(
    'Explicitly choose --provider=mock or --provider=gemini. Gemini mode makes paid/quota-using API requests.',
  );
loadEnvironment();
const config = readConfig({ ...process.env, AI_PROVIDER: values.provider });
const dataset = z
  .array(guideInputSchema)
  .min(1)
  .parse(JSON.parse(await readFile(values.dataset!, 'utf8')));
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Use a limit from 1 to 50.');
const provider = createProvider(config);
const results: {
  title: string;
  complete: boolean;
  error?: string;
  tokens?: number | null;
}[] = [];
for (const item of dataset.slice(0, limit)) {
  try {
    const analysis = await provider.analyze(item, 1, AbortSignal.timeout(config.AI_TIMEOUT_MS));
    results.push({
      title: item.title,
      complete: studyResultSchema.safeParse(analysis.result).success,
      tokens: analysis.tokens,
    });
  } catch (error) {
    results.push({
      title: item.title,
      complete: false,
      error: classifyProviderError(error).code,
    });
  }
}
const successful = results.filter((result) => result.complete);
const report = {
  provider: config.AI_PROVIDER,
  model: config.AI_PROVIDER === 'mock' ? 'study-examples-v2' : config.GEMINI_MODEL,
  dataset: values.dataset,
  attempted: results.length,
  successful: successful.length,
  errors: results.length - successful.length,
  note: 'Checks schema and completeness only. Does not measure factual accuracy, educational quality, or learning outcomes. See docs/EVALUATION.md for manual review.',
  results,
};
await mkdir('test-results', { recursive: true });
const path = `test-results/evaluation-${Date.now()}.json`;
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined, file: path }, null, 2));
if (report.errors) process.exitCode = 1;
