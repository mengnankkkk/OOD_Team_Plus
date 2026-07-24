import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, isoNow } from "@/server/http/context";
import { PATCH } from "./route";

const url = "http://localhost/api/v1/notifications/notif_1";

beforeEach(() => {
  const db = getDatabase();
  db.prepare("DELETE FROM notifications WHERE id='notif_1'").run();
  db.prepare(`INSERT INTO notifications
    (id,user_id,severity,title,body_text,source_type,created_at,updated_at,row_version)
    VALUES ('notif_1','demo-user','important','Risk alert','Review the portfolio','test',?,?,1)`).run(isoNow(), isoNow());
  db.close();
});

describe("/api/v1/notifications/[id]", () => {
  it("PATCH requires If-Match", async () => {
    const res = await PATCH(
      new NextRequest(url, { method: "PATCH", body: JSON.stringify({ action: "MARK_READ" }) }),
      { params: Promise.resolve({ id: "notif_1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("PATCH validates action values", async () => {
    const res = await PATCH(
      new NextRequest(url, {
        method: "PATCH",
        body: JSON.stringify({ action: "INVALID" }),
        headers: { "If-Match": "1" },
      }),
      { params: Promise.resolve({ id: "notif_1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("PATCH marks notifications as read without leaving them unread", async () => {
    const res = await PATCH(
      new NextRequest(url, {
        method: "PATCH",
        body: JSON.stringify({ action: "MARK_READ" }),
        headers: { "If-Match": "1" },
      }),
      { params: Promise.resolve({ id: "notif_1" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("read");
    expect(body.data.unread).toBe(false);
  });
});
