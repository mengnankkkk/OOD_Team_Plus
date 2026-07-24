import { getDatabase, isoNow } from "@/server/http/context";

export async function recoverInterruptedRuns(): Promise<number> {
  const db = getDatabase();
  const result = db.prepare("UPDATE agent_runs SET status = 'interrupted', completed_at = ? WHERE status IN ('running', 'queued')").run(isoNow());
  db.close();
  return result.changes;
}
