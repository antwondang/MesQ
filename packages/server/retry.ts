export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function retryHint(error: Record<string, unknown>): number | undefined {
  const headers = error.headers as { get?: (name: string) => string | null } | undefined;
  const headerDelay = parseRetryAfter(headers?.get?.('retry-after'));
  if (headerDelay !== undefined) return headerDelay;
  let details = error.errorDetails;
  // The Google SDK's ApiError can carry the JSON error body in message.
  // Read only the retry metadata; never log or persist that raw body.
  if (!Array.isArray(details) && typeof error.message === 'string') {
    try {
      const body = JSON.parse(error.message) as { error?: { details?: unknown } };
      details = body.error?.details;
    } catch {
      /* Non-JSON error messages do not contain structured retry guidance. */
    }
  }
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (
        detail &&
        detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' &&
        typeof detail.retryDelay === 'string' &&
        /^\d+(\.\d+)?s$/.test(detail.retryDelay)
      ) {
        return parseFloat(detail.retryDelay) * 1000;
      }
    }
  }
  return undefined;
}

export function classifyProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const candidate = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const status = Number(candidate.status ?? candidate.statusCode);
  if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError')
    return new ProviderError('provider_timeout', true);
  if (status === 408) return new ProviderError('provider_timeout', true, retryHint(candidate));
  if (status === 429) return new ProviderError('provider_rate_limit', true, retryHint(candidate));
  if (status >= 500 && status <= 599)
    return new ProviderError('provider_unavailable', true, retryHint(candidate));
  if (status === 401 || status === 403) return new ProviderError('provider_credentials', false);
  if (status >= 400 && status < 500) return new ProviderError('provider_request_rejected', false);
  // Do not persist the SDK's raw error; it may include private request content.
  return new ProviderError('provider_network_error', true);
}

export function retryDelayMs(attempt: number, baseMs: number, hint?: number, random = Math.random): number {
  const base = Math.min(60000, baseMs * 2 ** Math.min(20, Math.max(0, attempt - 1)));
  const delay = base + Math.floor(base * 0.2 * random());
  return Math.max(delay, hint !== undefined && Number.isFinite(hint) ? hint : 0);
}
