import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET, PUT } from "./route";

describe("/api/v1/notification-preference", () => {
  it("GET returns the default preference", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.mode).toBe("IMPORTANT_ONLY");
  });

  it("PUT rejects invalid preference bodies", async () => {
    const res = await PUT(new NextRequest("http://localhost/api/v1/notification-preference", { method: "PUT", body: JSON.stringify({ mode: "ALWAYS" }) }));
    expect(res.status).toBe(400);
  });

  it("PUT accepts valid preference bodies", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/api/v1/notification-preference", {
        method: "PUT",
        body: JSON.stringify({ mode: "DAILY_DIGEST", quietHoursStart: "22:00", quietHoursEnd: "07:00" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mode).toBe("DAILY_DIGEST");
  });
});
