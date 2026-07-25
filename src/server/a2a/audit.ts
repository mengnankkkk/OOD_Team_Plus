import { createId, getDatabase, isoNow } from "@/server/http/context";

export function writeA2AAudit(input: {
  clientId: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: "ACCEPTED" | "REPLAYED" | "SUCCEEDED" | "FAILED";
  metadata?: Record<string, unknown>;
}): void {
  const db = getDatabase();
  try {
    db.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_id,user_id,action,target_type,target_id,outcome,metadata_json,created_at)
      VALUES (?,'EXTERNAL_CLIENT',?,NULL,?,?,?,?,?,?)`).run(
      createId("audit"),
      input.clientId,
      input.action,
      input.targetType,
      input.targetId,
      input.outcome,
      JSON.stringify(input.metadata ?? {}),
      isoNow(),
    );
  } finally {
    db.close();
  }
}
