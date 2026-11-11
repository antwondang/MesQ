import { createHash, randomUUID } from 'node:crypto';
import type { Database, Row, Sql } from './database.js';
import {
  applicationInputSchema,
  statusLabels,
  type Activity,
  type Application,
  type ApplicationDetail,
  type ApplicationInput,
  type ApplicationList,
  type ApplicationPatch,
  type ListQuery,
  type Summary,
} from '../shared/contracts.js';

export class RepositoryError extends Error {
  constructor(
    public code: 'not_found' | 'conflict' | 'idempotency_conflict',
    message: string,
  ) {
    super(message);
  }
}
interface ApplicationRow extends Row {
  id: string;
  payload: ApplicationInput;
  version: number;
  request_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
}
const timestamp = (value: Date | string) => new Date(value).toISOString();
function fromRow(row: ApplicationRow): Application {
  return {
    ...row.payload,
    id: row.id,
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}
async function activity(tx: Sql, id: string, description: string) {
  await tx.query('INSERT INTO internship_activity(id,application_id,description) VALUES($1,$2,$3)', [
    randomUUID(),
    id,
    description,
  ]);
}
export async function createApplication(
  db: Database,
  input: ApplicationInput,
  key: string,
): Promise<Application> {
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.transaction(async (tx) => {
    const inserted = await tx.query<ApplicationRow>(
      'INSERT INTO internship_applications(id,payload,request_key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(request_key) DO NOTHING RETURNING *',
      [randomUUID(), JSON.stringify(input), key, hash],
    );
    if (inserted.rows[0]) {
      await activity(tx, inserted.rows[0].id, `Added to ${statusLabels[input.status]}`);
      return fromRow(inserted.rows[0]);
    }
    const existing = (
      await tx.query<ApplicationRow>('SELECT * FROM internship_applications WHERE request_key=$1', [key])
    ).rows[0];
    if (existing.request_hash !== hash)
      throw new RepositoryError(
        'idempotency_conflict',
        'This request was already used for different content. Close and reopen the form to start a new application.',
      );
    return fromRow(existing);
  });
}
export async function getApplication(db: Database, id: string): Promise<ApplicationDetail> {
  const row = (await db.query<ApplicationRow>('SELECT * FROM internship_applications WHERE id=$1', [id]))
    .rows[0];
  if (!row) throw new RepositoryError('not_found', 'Application not found.');
  const events = await db.query<{ id: string; description: string; created_at: Date | string }>(
    'SELECT id,description,created_at FROM internship_activity WHERE application_id=$1 ORDER BY created_at DESC,id DESC',
    [id],
  );
  const history: Activity[] = events.rows.map((event) => ({
    id: event.id,
    description: event.description,
    createdAt: timestamp(event.created_at),
  }));
  return { ...fromRow(row), history };
}
export async function updateApplication(
  db: Database,
  id: string,
  patch: ApplicationPatch,
): Promise<Application> {
  return db.transaction(async (tx) => {
    const row = (
      await tx.query<ApplicationRow>('SELECT * FROM internship_applications WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!row) throw new RepositoryError('not_found', 'Application not found.');
    const { version, ...changes } = patch;
    if (row.version !== version)
      throw new RepositoryError(
        'conflict',
        'This application changed in another tab. Close and reopen it to load the latest version.',
      );
    const payload = applicationInputSchema.parse({ ...row.payload, ...changes });
    const result = await tx.query<ApplicationRow>(
      'UPDATE internship_applications SET payload=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
      [id, JSON.stringify(payload)],
    );
    const descriptions: string[] = [];
    if (payload.status !== row.payload.status)
      descriptions.push(`Moved from ${statusLabels[row.payload.status]} to ${statusLabels[payload.status]}`);
    if (payload.archived !== row.payload.archived)
      descriptions.push(payload.archived ? 'Archived application' : 'Restored application');
    await activity(tx, id, descriptions.join(' · ') || 'Updated application details');
    return fromRow(result.rows[0]);
  });
}
export async function deleteApplication(db: Database, id: string, version: number) {
  await db.transaction(async (tx) => {
    const row = (
      await tx.query<ApplicationRow>('SELECT * FROM internship_applications WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!row) throw new RepositoryError('not_found', 'Application not found.');
    if (row.version !== version)
      throw new RepositoryError(
        'conflict',
        'This application changed in another tab. Close and reopen it before deleting.',
      );
    await tx.query('DELETE FROM internship_applications WHERE id=$1', [id]);
  });
}
// Dates are ISO calendar strings, so sorting them never changes with server timezone.
const dueExpression = `LEAST(NULLIF(payload->>'nextActionDate',''), CASE WHEN payload->>'status'='saved' THEN NULLIF(payload->>'deadline','') END)`;
function filters(query: ListQuery) {
  const values: unknown[] = [query.view === 'archive'];
  const clauses = [`(payload->>'archived')::boolean=$1`];
  if (query.status) {
    values.push(query.status);
    clauses.push(`payload->>'status'=$${values.length}`);
  }
  if (query.q) {
    values.push(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(
      `(payload->>'company' ILIKE $${values.length} OR payload->>'role' ILIKE $${values.length} OR payload->>'location' ILIKE $${values.length})`,
    );
  }
  if (query.view === 'upcoming')
    clauses.push(`payload->>'status' NOT IN ('rejected','withdrawn') AND ${dueExpression} IS NOT NULL`);
  return {
    where: clauses.join(' AND '),
    values,
    order: query.view === 'upcoming' ? `${dueExpression} ASC,id` : 'updated_at DESC,id',
  };
}
export async function listApplications(db: Database, query: ListQuery): Promise<ApplicationList> {
  const { where, values, order } = filters(query);
  const total = (
    await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM internship_applications WHERE ${where}`,
      values,
    )
  ).rows[0].count;
  const result = await db.query<ApplicationRow>(
    `SELECT * FROM internship_applications WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, query.pageSize, (query.page - 1) * query.pageSize],
  );
  return { items: result.rows.map(fromRow), total, page: query.page, pageSize: query.pageSize };
}
export async function exportApplications(db: Database, query: ListQuery): Promise<string> {
  const { where, values, order } = filters(query);
  const rows = (
    await db.query<ApplicationRow>(
      `SELECT * FROM internship_applications WHERE ${where} ORDER BY ${order}`,
      values,
    )
  ).rows.map(fromRow);
  const columns: (keyof ApplicationInput)[] = [
    'company',
    'role',
    'status',
    'location',
    'url',
    'appliedDate',
    'deadline',
    'nextAction',
    'nextActionDate',
    'notes',
    'archived',
  ];
  const header = [
    'Company',
    'Role',
    'Status',
    'Location',
    'Job URL',
    'Applied date',
    'Deadline',
    'Next action',
    'Next action date',
    'Notes',
    'Archived',
  ];
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (/^(\s*[=+\-@]|[\t\r\n])/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      header,
      ...rows.map((row) => columns.map((key) => (key === 'status' ? statusLabels[row.status] : row[key]))),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}
export async function getSummary(db: Database): Promise<Summary> {
  const result = await db.query<Summary & Row>(`SELECT
    count(*) FILTER (WHERE payload->>'archived'='false')::int AS total,
    count(*) FILTER (WHERE payload->>'archived'='false' AND payload->>'status' IN ('applied','assessment','interview'))::int AS active,
    count(*) FILTER (WHERE payload->>'archived'='false' AND payload->>'status'='interview')::int AS interviews,
    count(*) FILTER (WHERE payload->>'archived'='false' AND payload->>'status'='offer')::int AS offers,
    count(*) FILTER (WHERE payload->>'archived'='true')::int AS archived
    FROM internship_applications`);
  return result.rows[0];
}
