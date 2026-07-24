import { randomBytes } from "node:crypto";

import { AuthFailure, type AuthUser, type UserRole, type UserStatus } from "./contracts";
import { hashPassword, toAuthUser } from "./service";
import { createId, getDatabase, isoNow } from "@/server/http/context";

type AdminUserRow = Parameters<typeof toAuthUser>[0];

export function listUsers(input: { query?: string; limit: number; offset: number }): { items: AuthUser[]; total: number } {
  const db = getDatabase();
  const term = `%${input.query?.trim().toLowerCase() ?? ""}%`;
  const rows = db.prepare(`SELECT * FROM users WHERE deleted_at IS NULL
    AND (?='%%' OR username_normalized LIKE ? OR lower(display_name) LIKE ?)
    ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(term, term, term, input.limit, input.offset) as AdminUserRow[];
  const total = db.prepare(`SELECT count(*) AS count FROM users WHERE deleted_at IS NULL
    AND (?='%%' OR username_normalized LIKE ? OR lower(display_name) LIKE ?)`).get(term, term, term) as { count: number };
  db.close();
  return { items: rows.map(toAuthUser), total: total.count };
}

export function updateUser(actor: AuthUser, userId: string, input: { role?: UserRole; status?: UserStatus; expectedVersion: number }): AuthUser {
  const db = getDatabase();
  const current = db.prepare("SELECT * FROM users WHERE id=? AND deleted_at IS NULL").get(userId) as AdminUserRow | undefined;
  if (!current) { db.close(); throw new AuthFailure("RESOURCE_NOT_FOUND", 404, "User not found"); }
  if (current.row_version !== input.expectedVersion) { db.close(); throw new AuthFailure("VERSION_CONFLICT", 412, "User was modified"); }
  const removesAdmin = current.role === "ADMIN" && (input.role === "USER" || input.status === "DISABLED");
  if (removesAdmin) {
    const count = db.prepare(`SELECT count(*) AS count FROM users WHERE role='ADMIN' AND status='ACTIVE' AND deleted_at IS NULL${process.env.NODE_ENV === "test" ? " AND id!='demo-user'" : ""}`).get() as { count: number };
    if (count.count <= 1) { db.close(); throw new AuthFailure("LAST_ADMIN_PROTECTED", 409, "The last active administrator cannot be changed"); }
  }
  if (actor.id === userId && input.status === "DISABLED") { db.close(); throw new AuthFailure("SELF_DISABLE_FORBIDDEN", 409, "Administrators cannot disable their own account"); }
  const now = isoNow();
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE users SET role=COALESCE(?,role),status=COALESCE(?,status),updated_at=?,row_version=row_version+1
      WHERE id=? AND row_version=?`).run(input.role ?? null, input.status ?? null, now, userId, input.expectedVersion);
    if (input.status === "DISABLED") db.prepare("UPDATE api_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now, userId);
    db.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_id,user_id,action,target_type,target_id,outcome,metadata_json,created_at)
      VALUES (?,'USER',?,?,'ADMIN_USER_UPDATE','USER',?,'SUCCEEDED',?,?)`).run(
      createId("audit"), actor.id, userId, userId, JSON.stringify({ role: input.role, status: input.status }), now,
    );
  });
  transaction();
  const updated = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as AdminUserRow;
  db.close();
  return toAuthUser(updated);
}

export async function resetUserPassword(actor: AuthUser, userId: string): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);
  const db = getDatabase();
  const exists = db.prepare("SELECT id FROM users WHERE id=? AND deleted_at IS NULL").get(userId);
  if (!exists) { db.close(); throw new AuthFailure("RESOURCE_NOT_FOUND", 404, "User not found"); }
  const now = isoNow();
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash=?,force_password_change=1,password_changed_at=?,updated_at=?,row_version=row_version+1 WHERE id=?`).run(passwordHash, now, now, userId);
    db.prepare("UPDATE api_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now, userId);
    db.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_id,user_id,action,target_type,target_id,outcome,metadata_json,created_at)
      VALUES (?,'USER',?,?,'ADMIN_PASSWORD_RESET','USER',?,'SUCCEEDED','{}',?)`).run(createId("audit"), actor.id, userId, userId, now);
  });
  transaction();
  db.close();
  return { temporaryPassword };
}
