import { createHash, randomUUID } from 'node:crypto';
import type {
  Attempt,
  JobMessage,
  ListQuery,
  Metrics,
  ProviderName,
  Guide,
  GuideDetail,
  GuideInput,
  GuidePage,
  StudyResult,
} from '../shared/contracts.js';
import { statuses } from '../shared/contracts.js';
import type { Database, Row, Sql } from './database.js';
import type { ProviderError } from './retry.js';

const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
const nullableIso = (value: unknown): string | null => (value ? iso(value) : null);
function guideFromRow(row: Row): Guide {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    mode: row.mode as GuideInput['mode'],
    subject: row.subject as GuideInput['subject'],
    demoScenario: row.demo_scenario as GuideInput['demoScenario'],
    status: row.status as Guide['status'],
    generation: Number(row.generation),
    attempts: Number(row.attempts),
    crashCount: Number(row.crash_count),
    result: row.result as StudyResult | null,
    provider: row.provider as ProviderName | null,
    model: row.model as string | null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: nullableIso(row.completed_at),
    firstStartedAt: nullableIso(row.first_started_at),
    nextAttemptAt: nullableIso(row.next_attempt_at),
    lastError: row.last_error as string | null,
  };
}

export async function enqueue(
  sql: Sql,
  guideId: string,
  generation: number,
  kind: 'process' | 'dead' = 'process',
  delayMs = 0,
  errorCode?: string,
) {
  const payload = { schemaVersion: 2, guideId, generation, ...(errorCode ? { errorCode } : {}) };
  await sql.query(
    `INSERT INTO study_outbox(id,guide_id,kind,generation,payload,available_at)
    VALUES($1,$2,$3,$4,$5::jsonb,clock_timestamp()+$6*interval '1 millisecond')`,
    [randomUUID(), guideId, kind, generation, JSON.stringify(payload), delayMs],
  );
}

export async function createGuide(db: Database, input: GuideInput, idempotencyKey: string): Promise<Guide> {
  const hash = createHash('sha256')
    .update(JSON.stringify([input.title, input.mode, input.subject, input.body, input.demoScenario]))
    .digest('hex');
  return db.transaction(async (sql) => {
    const inserted = await sql.query(
      `INSERT INTO study_guides(id,idempotency_key,request_hash,title,body,demo_scenario,mode,subject)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,
      [
        randomUUID(),
        idempotencyKey,
        hash,
        input.title,
        input.body,
        input.demoScenario,
        input.mode,
        input.subject,
      ],
    );
    if (inserted.rows[0]) {
      await enqueue(sql, String(inserted.rows[0].id), 1);
      return guideFromRow(inserted.rows[0]);
    }
    const existing = (
      await sql.query('SELECT * FROM study_guides WHERE idempotency_key=$1', [idempotencyKey])
    ).rows[0];
    if (!existing || existing.request_hash !== hash) throw new Error('idempotency_conflict');
    return guideFromRow(existing);
  });
}

export async function getGuide(db: Sql, id: string): Promise<GuideDetail | null> {
  const row = (await db.query('SELECT * FROM study_guides WHERE id=$1', [id])).rows[0];
  if (!row) return null;
  const records = await db.query('SELECT * FROM study_attempts WHERE guide_id=$1 ORDER BY started_at,fence', [
    id,
  ]);
  const history: Attempt[] = records.rows.map((attempt) => ({
    id: String(attempt.id),
    generation: Number(attempt.generation),
    fence: Number(attempt.fence),
    workerId: String(attempt.worker_id),
    startedAt: iso(attempt.started_at),
    endedAt: nullableIso(attempt.ended_at),
    outcome: String(attempt.outcome),
    errorCode: attempt.error_code as string | null,
    durationMs: attempt.duration_ms === null ? null : Number(attempt.duration_ms),
    tokens: attempt.tokens === null ? null : Number(attempt.tokens),
  }));
  return { ...guideFromRow(row), history };
}

export async function listGuides(db: Sql, filters: ListQuery): Promise<GuidePage> {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status=$${values.length}`);
  }
  if (filters.subject) {
    values.push(filters.subject);
    conditions.push(`subject=$${values.length}`);
  }
  if (filters.q) {
    values.push(`%${filters.q}%`);
    conditions.push(`(title ILIKE $${values.length} OR body ILIKE $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const count = await db.query(`SELECT count(*)::int AS total FROM study_guides ${where}`, values);
  const limit = values.length + 1;
  const rows = await db.query(
    `SELECT * FROM study_guides ${where} ORDER BY created_at DESC,id DESC LIMIT $${limit} OFFSET $${limit + 1}`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize],
  );
  return {
    items: rows.rows.map(guideFromRow),
    total: Number(count.rows[0].total),
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export interface Claim {
  guideId: string;
  generation: number;
  fence: number;
  input: GuideInput;
}
export async function claimGuide(
  db: Database,
  message: JobMessage,
  workerId: string,
  leaseMs: number,
): Promise<Claim | null> {
  return db.transaction(async (sql) => {
    const claimed = await sql.query(
      `UPDATE study_guides SET status='processing',fence=fence+1,attempts=GREATEST(attempts,generation),
      lease_until=clock_timestamp()+$3*interval '1 millisecond', next_attempt_at=NULL,
      first_started_at=COALESCE(first_started_at,clock_timestamp()),updated_at=clock_timestamp()
      WHERE id=$1 AND generation=$2 AND status IN ('pending','queued','retrying')
      AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) RETURNING *`,
      [message.guideId, message.generation, leaseMs],
    );
    const row = claimed.rows[0];
    if (!row) return null;
    const fence = Number(row.fence);
    await sql.query(
      'INSERT INTO study_attempts(id,guide_id,generation,fence,worker_id) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), message.guideId, message.generation, fence, workerId],
    );
    return {
      guideId: message.guideId,
      generation: message.generation,
      fence,
      input: {
        title: String(row.title),
        body: String(row.body),
        mode: row.mode as GuideInput['mode'],
        subject: row.subject as GuideInput['subject'],
        demoScenario: row.demo_scenario as GuideInput['demoScenario'],
      },
    };
  });
}

async function lockCurrent(sql: Sql, claim: Claim): Promise<Row | undefined> {
  return (
    await sql.query(
      `SELECT * FROM study_guides WHERE id=$1 AND generation=$2 AND fence=$3
    AND status='processing' AND lease_until>clock_timestamp() FOR UPDATE`,
      [claim.guideId, claim.generation, claim.fence],
    )
  ).rows[0];
}

export interface ResultMetadata {
  provider: ProviderName;
  model: string;
  durationMs: number;
  tokens: number | null;
}
export async function completeGuide(
  db: Database,
  claim: Claim,
  result: StudyResult,
  meta: ResultMetadata,
): Promise<boolean> {
  return db.transaction(async (sql) => {
    if (!(await lockCurrent(sql, claim))) return false;
    await sql.query(
      `UPDATE study_guides SET status='completed',result=$2::jsonb,provider=$3,model=$4,last_error=NULL,
      lease_until=NULL,next_attempt_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
      [claim.guideId, JSON.stringify(result), meta.provider, meta.model],
    );
    await sql.query(
      `UPDATE study_attempts SET outcome='completed',ended_at=clock_timestamp(),duration_ms=$3,tokens=$4
      WHERE guide_id=$1 AND fence=$2`,
      [claim.guideId, claim.fence, meta.durationMs, meta.tokens],
    );
    return true;
  });
}

export async function failGuide(
  db: Database,
  claim: Claim,
  error: ProviderError,
  delayMs: number,
  maxAttempts: number,
  durationMs: number,
): Promise<boolean> {
  return db.transaction(async (sql) => {
    if (!(await lockCurrent(sql, claim))) return false;
    const retry = error.retryable && claim.generation < maxAttempts;
    await sql.query(
      `UPDATE study_guides SET status=$2,generation=$3,last_error=$4,lease_until=NULL,updated_at=clock_timestamp(),
      next_attempt_at=CASE WHEN $5 THEN clock_timestamp()+$6*interval '1 millisecond' ELSE NULL END,
      completed_at=CASE WHEN $5 THEN NULL ELSE clock_timestamp() END WHERE id=$1`,
      [
        claim.guideId,
        retry ? 'retrying' : 'failed',
        retry ? claim.generation + 1 : claim.generation,
        error.code,
        retry,
        delayMs,
      ],
    );
    await sql.query(
      'UPDATE study_attempts SET outcome=$3,error_code=$4,ended_at=clock_timestamp(),duration_ms=$5 WHERE guide_id=$1 AND fence=$2',
      [claim.guideId, claim.fence, retry ? 'retrying' : 'failed', error.code, durationMs],
    );
    await enqueue(
      sql,
      claim.guideId,
      retry ? claim.generation + 1 : claim.generation,
      retry ? 'process' : 'dead',
      retry ? delayMs : 0,
      retry ? undefined : error.code,
    );
    return true;
  });
}

export async function recoverExpired(db: Database, maxRecoveries: number): Promise<number> {
  return db.transaction(async (sql) => {
    const expired =
      await sql.query(`SELECT * FROM study_guides WHERE status='processing' AND lease_until<=clock_timestamp()
      ORDER BY lease_until LIMIT 25 FOR UPDATE SKIP LOCKED`);
    for (const row of expired.rows) {
      const terminal = Number(row.crash_count) + 1 >= maxRecoveries;
      const errorCode = terminal ? 'crash_budget_exhausted' : 'worker_interrupted';
      await sql.query(
        `UPDATE study_guides SET crash_count=crash_count+1,fence=fence+1,status=$2,last_error=$3,
        lease_until=NULL,next_attempt_at=NULL,updated_at=clock_timestamp(),
        completed_at=CASE WHEN $4 THEN clock_timestamp() ELSE NULL END WHERE id=$1`,
        [row.id, terminal ? 'failed' : 'retrying', errorCode, terminal],
      );
      await sql.query(
        "UPDATE study_attempts SET outcome='interrupted',error_code=$3,ended_at=clock_timestamp() WHERE guide_id=$1 AND fence=$2",
        [row.id, row.fence, errorCode],
      );
      await enqueue(
        sql,
        String(row.id),
        Number(row.generation),
        terminal ? 'dead' : 'process',
        0,
        terminal ? errorCode : undefined,
      );
    }
    return expired.rowCount;
  });
}

export async function getMetrics(db: Sql): Promise<Metrics> {
  const groups = (await db.query('SELECT status,count(*)::int AS count FROM study_guides GROUP BY status'))
    .rows;
  const counts = Object.fromEntries(
    statuses.map((status) => [status, Number(groups.find((row) => row.status === status)?.count ?? 0)]),
  ) as Metrics['counts'];
  const latency = (
    await db.query(`SELECT
    percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM (completed_at-created_at))*1000) AS p50,
    percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM (completed_at-created_at))*1000) AS p95
    FROM study_guides WHERE status='completed'`)
  ).rows[0];
  const processing = (
    await db.query("SELECT avg(duration_ms) AS average FROM study_attempts WHERE outcome='completed'")
  ).rows[0];
  const pending = (
    await db.query('SELECT count(*)::int AS count FROM study_outbox WHERE published_at IS NULL')
  ).rows[0];
  const subjectCounts = await db.query(
    "SELECT subject AS subject,count(*)::int AS count FROM study_guides WHERE status='completed' GROUP BY subject ORDER BY count DESC",
  );
  return {
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    pendingPublications: Number(pending.count),
    p50CompletionMs: latency.p50 === null ? null : Number(latency.p50),
    p95CompletionMs: latency.p95 === null ? null : Number(latency.p95),
    averageProcessingMs: processing.average === null ? null : Number(processing.average),
    subjects: subjectCounts.rows.map((row) => ({
      subject: String(row.subject),
      count: Number(row.count),
    })),
  };
}
