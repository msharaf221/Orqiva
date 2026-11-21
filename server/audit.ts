import { id, now, run } from './db';
import { currentRequestId } from './request_context';
import type { Actor } from './scope';

/**
 * Appends an immutable audit-trail row. Call it from inside the same transaction as the
 * mutation it describes, so a rollback never leaves a phantom audit entry behind.
 * The row is stamped with the current request id when one is active.
 */
export function audit(
  actor: Pick<Actor, 'id' | 'name'>,
  action: string,
  entity: string,
  entityId: string,
  details = '',
) {
  run(
    'INSERT INTO audit_logs(id,user_id,user_name,action,entity,entity_id,details,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id(),
    actor.id,
    actor.name,
    action,
    entity,
    entityId,
    details,
    currentRequestId(),
    now(),
  );
}
