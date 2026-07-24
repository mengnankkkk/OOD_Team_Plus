import { createHash, randomUUID } from "node:crypto";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:53523";
const username = process.env.SMOKE_USERNAME ?? process.env.ADMIN_USERNAME ?? "e2e_admin";
const password = process.env.SMOKE_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD ?? "e2e_admin_password_123";
const shouldReset = process.env.SMOKE_RESET !== "false";
let cookie = "";
let csrfToken = "";

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && typeof init.body !== "string") {
    headers.set("Content-Type", "application/json");
    init = { ...init, body: JSON.stringify(init.body) };
  }
  if (cookie) headers.set("Cookie", cookie);
  if (csrfToken && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const session = setCookies.find((value) => value.startsWith("mw_session="));
  const csrf = setCookies.find((value) => value.startsWith("mw_csrf="));
  if (session) cookie = [session, csrf].filter(Boolean).map((value) => value.split(";", 1)[0]).join("; ");
  if (csrf) csrfToken = decodeURIComponent(csrf.split(";", 1)[0].slice("mw_csrf=".length));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} ${response.status}: ${payload?.error?.message ?? "request failed"}`);
  return payload.data;
}

function idempotency() {
  return randomUUID();
}

function holdingsHash(items) {
  const normalized = items.map((item) => ({
    instrumentId: item.instrument_id,
    quantity: item.quantity_decimal,
    cost: item.cost_decimal,
    status: item.status,
  })).sort((left, right) => left.instrumentId.localeCompare(right.instrumentId));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function waitForOptions(workspaceId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await request(`/api/v1/simulation-workspaces/${workspaceId}/options`);
    if (data.status === "SUCCEEDED" || data.status === "FAILED") return data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("branch option generation timed out");
}

async function main() {
  await request("/api/v1/auth/login", { method: "POST", body: { username, password } });
  if (shouldReset) await request("/api/v1/demo/reset", { method: "POST" });
  const bootstrap = await request("/api/v1/demo/bootstrap", { method: "POST" });
  const holdingsBefore = await request("/api/v1/holdings");
  const beforeHash = holdingsHash(holdingsBefore.items);
  const workspace = await request("/api/v1/simulation-workspaces", {
    method: "POST",
    headers: { "Idempotency-Key": idempotency() },
    body: {
      label: "Branch smoke",
      objectiveText: "检查组合集中度和分支可回溯性",
      portfolioSnapshotId: bootstrap.portfolioSnapshotId,
    },
  });
  const queued = await request(`/api/v1/simulation-workspaces/${workspace.id}/options`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotency() },
    body: { objective: "降低组合集中度，同时保留现金缓冲" },
  });
  const options = await waitForOptions(workspace.id);
  if (options.status !== "SUCCEEDED" || options.items.length < 3) throw new Error(`option generation did not succeed: ${options.status}`);
  const selected = options.items.find((item) => item.analysis?.strategy === "BALANCED") ?? options.items[1];
  const child = await request(`/api/v1/simulation-workspaces/${workspace.id}/branches`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotency() },
    body: { parentBranchId: workspace.rootBranchId, optionId: selected.id, name: "Branch B" },
  });
  const rootSnapshot = await request(`/api/v1/simulation-workspaces/${workspace.id}/branches/${workspace.rootBranchId}/snapshot`);
  const childSnapshot = await request(`/api/v1/simulation-workspaces/${workspace.id}/branches/${child.branchId}/snapshot`);
  let current = await request(`/api/v1/simulation-workspaces/${workspace.id}`);
  const root = await request(`/api/v1/simulation-workspaces/${workspace.id}/active-branch`, {
    method: "PATCH",
    headers: { "If-Match": String(current.version) },
    body: { branchId: workspace.rootBranchId },
  });
  current = await request(`/api/v1/simulation-workspaces/${workspace.id}`);
  const childAgain = await request(`/api/v1/simulation-workspaces/${workspace.id}/active-branch`, {
    method: "PATCH",
    headers: { "If-Match": String(current.version) },
    body: { branchId: child.branchId },
  });
  const undone = await request(`/api/v1/simulation-workspaces/${workspace.id}/undo`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotency(), "If-Match": String(childAgain.version) },
  });
  const holdingsAfter = await request("/api/v1/holdings");
  const afterHash = holdingsHash(holdingsAfter.items);
  if (beforeHash !== afterHash) throw new Error("real holdings hash changed during simulation");
  console.log(`workspace id: ${workspace.id}`);
  console.log(`batch status/provider: ${options.status}/${options.provider ?? queued.status}`);
  console.log(`option count: ${options.items.length}`);
  console.log(`branch id: ${child.branchId}`);
  console.log(`root and child total assets: ${rootSnapshot.totalAssets} / ${childSnapshot.totalAssets}`);
  console.log(`active branch after switch: ${root.activeBranchId}`);
  console.log(`active branch after undo: ${undone.activeBranchId}`);
  console.log(`real holdings hash before/after: ${beforeHash} / ${afterHash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
