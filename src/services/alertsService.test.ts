import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAlerts } from "./alertsService";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/features/frontend-migration/api", () => ({
  apiGet: apiMocks.get,
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

describe("alerts service", () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
  });

  it("preserves the server unread count beyond the loaded page", async () => {
    apiMocks.get.mockResolvedValue({
      items: Array.from({ length: 40 }, (_, index) => ({
        id: `alert-${index}`,
        severity: "important",
        title: `Alert ${index}`,
        status: "unread",
        metadata: {},
        created_at: "2026-07-25T00:00:00.000Z",
      })),
      unreadCount: 55,
    });

    const result = await listAlerts("user-a", {
      statuses: ["unread", "read"],
    });

    expect(result.items).toHaveLength(40);
    expect(result.unreadCount).toBe(55);
  });
});
