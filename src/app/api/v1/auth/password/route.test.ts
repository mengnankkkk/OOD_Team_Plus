import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { authenticatedRequest } from "@tests/helpers/auth";
import { hashPassword } from "@/server/auth/service";
import { getDatabase } from "@/server/http/context";

import { PUT } from "./route";

describe("PUT /api/v1/auth/password", () => {
  it("returns a localized validation error", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/v1/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: "mw_locale=en-US", "accept-language": "en-US" },
      body: JSON.stringify({ currentPassword: "short", newPassword: "short" }),
    }));

    expect(response.status).toBe(422);
    expect(response.headers.get("content-language")).toBe("en-US");
    expect((await response.json()).error.message).toBe("The request parameters are invalid.");
  });

  it("returns a localized authentication error", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/v1/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: "mw_locale=en-US", "accept-language": "en-US" },
      body: JSON.stringify({ currentPassword: "current-password", newPassword: "new-password" }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("content-language")).toBe("en-US");
    expect((await response.json()).error.message).toBe("Authentication is required to continue.");
  });

  it("updates the password and returns a localized no-content response", async () => {
    const userId = "test-auth-user";
    const request = authenticatedRequest("http://localhost/api/v1/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: "mw_locale=zh-CN", "accept-language": "zh-CN" },
      body: JSON.stringify({ currentPassword: "current-password", newPassword: "new-password" }),
    });
    const db = getDatabase();
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword("current-password"), userId);
    db.close();

    const response = await PUT(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("content-language")).toBe("zh-CN");
  });
});
