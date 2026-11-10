import type { JobMessage } from '../shared/contracts.js';
import { studyResultSchema } from '../shared/contracts.js';
import type { Database } from './database.js';
import type { Config } from './config.js';
import { log } from './config.js';
import { claimGuide, completeGuide, failGuide } from './repository.js';
import type { AiProvider } from './providers.js';
import { classifyProviderError, ProviderError, retryDelayMs } from './retry.js';

export async function processMessage(
  db: Database,
  provider: AiProvider,
  message: JobMessage,
  workerId: string,
  config: Config,
  shutdown?: AbortSignal,
): Promise<void> {
  const claim = await claimGuide(db, message, workerId, config.LEASE_MS);
  if (!claim) return; // Completed, actively leased, premature, or obsolete delivery.
  const started = performance.now();
  const timeout = new AbortController();
  const signal = shutdown ? AbortSignal.any([shutdown, timeout.signal]) : timeout.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeout.abort();
      reject(new ProviderError('provider_timeout', true));
    }, config.AI_TIMEOUT_MS);
  });
  log('job_started', { guideId: claim.guideId, generation: claim.generation, workerId });
  try {
    let analysis;
    try {
      analysis = await Promise.race([provider.analyze(claim.input, claim.generation, signal), deadline]);
      if (!studyResultSchema.safeParse(analysis.result).success)
        throw new ProviderError('provider_invalid_output', true);
    } catch (error) {
      if (shutdown?.aborted) throw error; // Lease recovery owns interrupted work.
      const failure = classifyProviderError(error);
      await failGuide(
        db,
        claim,
        failure,
        retryDelayMs(claim.generation, config.RETRY_BASE_MS, failure.retryAfterMs),
        config.MAX_ATTEMPTS,
        Math.round(performance.now() - started),
      );
      log('job_attempt_failed', {
        guideId: claim.guideId,
        generation: claim.generation,
        code: failure.code,
      });
      return;
    }
    // Database errors must propagate to the broker handler, not become AI retries.
    const committed = await completeGuide(db, claim, analysis.result, {
      ...analysis,
      durationMs: Math.round(performance.now() - started),
    });
    log(committed ? 'job_completed' : 'job_stale_result_ignored', {
      guideId: claim.guideId,
      generation: claim.generation,
    });
  } finally {
    clearTimeout(timer);
  }
}
