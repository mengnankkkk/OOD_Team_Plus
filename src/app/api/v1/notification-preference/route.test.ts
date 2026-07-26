import { describe, expect, it } from "vitest";

import { authenticatedRequest } from "@tests/helpers/auth";
import { GET, PUT } from "./route";

describe("/api/v1/notification-preference", () => {
  it("GET returns the default preference", async () => {
    const res = await GET(authenticatedRequest("http://localhost/api/v1/notification-preference"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.mode).toBe("IMPORTANT_ONLY");
  });

  it("PUT rejects invalid preference bodies", async () => {
    const res = await PUT(authenticatedRequest("http://localhost/api/v1/notification-preference", {
      method: "PUT",
      headers: { "accept-language": "en-US", "cookie": "mw_locale=en-US" },
      body: JSON.stringify({ mode: "ALWAYS" }),
    }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-language")).toBe("en-US");
    expect((await res.json()).error.message).toBe("The request parameters are invalid.");
  });

  it.each([
    { mode: "IMPORTANT_ONLY", quietHoursStart: "9:00", quietHoursEnd: "18:00" },
    { mode: "IMPORTANT_ONLY", quietHoursStart: "09:00", quietHoursEnd: null },
    { mode: "DAILY_DIGEST", quietHoursStart: "abc", quietHoursEnd: "07:00" },
  ])("PUT rejects malformed or incomplete quiet hours", async (body) => {
    const res = await PUT(authenticatedRequest(
      "http://localhost/api/v1/notification-preference",
      { method: "PUT", body: JSON.stringify(body) },
    ));
    expect(res.status).toBe(422);
  });

  it("PUT accepts valid preference bodies", async () => {
    const res = await PUT(
      authenticatedRequest("http://localhost/api/v1/notification-preference", {
        method: "PUT",
        body: JSON.stringify({ mode: "DAILY_DIGEST", quietHoursStart: "22:00", quietHoursEnd: "07:00" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mode).toBe("DAILY_DIGEST");
  });
});
