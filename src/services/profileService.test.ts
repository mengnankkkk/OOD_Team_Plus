import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

import { apiGet } from "@/features/frontend-migration/api";
import { fetchCurrentProfile } from "./profileService";

describe("fetchCurrentProfile", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it("preserves an explicit incomplete onboarding status from the server", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      status: "COMPLETE",
      hasGoal: true,
      onboardingCompleted: false,
      preferences: {},
    });

    const profile = await fetchCurrentProfile("legacy-user");

    expect(profile.onboardingCompleted).toBe(false);
  });

  it("keeps the legacy fallback only when the server omits onboarding status", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      status: "COMPLETE",
      hasGoal: true,
      preferences: {},
    });

    const profile = await fetchCurrentProfile("legacy-user");

    expect(profile.onboardingCompleted).toBe(true);
  });
});
