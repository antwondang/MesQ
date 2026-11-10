import type { Database } from './database.js';

export interface Publisher {
  publish(kind: 'process' | 'dead', payload: unknown, id: string): Promise<void>;
}

// Publishing is inside the DB transaction. A crash after confirmation and before
// COMMIT can duplicate a delivery; stable job IDs and fenced claims handle that.
export async function dispatchOutbox(db: Database, publisher: Publisher, limit = 25): Promise<number> {
  let dispatched = 0;
  while (dispatched < limit) {
    const didPublish = await db.transaction(async (sql) => {
      const event = (
        await sql.query(`SELECT * FROM study_outbox WHERE published_at IS NULL AND available_at<=clock_timestamp()
        ORDER BY available_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`)
      ).rows[0];
      if (!event) return false;
      await publisher.publish(event.kind as 'process' | 'dead', event.payload, String(event.id));
      await sql.query('UPDATE study_outbox SET published_at=clock_timestamp() WHERE id=$1', [event.id]);
      if (event.kind === 'process') {
        await sql.query(
          `UPDATE study_guides SET status='queued',queued_at=COALESCE(queued_at,clock_timestamp()),updated_at=clock_timestamp()
          WHERE id=$1 AND generation=$2 AND status IN ('pending','retrying')`,
          [event.guide_id, event.generation],
        );
      }
      return true;
    });
    if (!didPublish) break;
    dispatched++;
  }
  return dispatched;
}
