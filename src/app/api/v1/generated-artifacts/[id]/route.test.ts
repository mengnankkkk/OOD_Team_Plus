import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { DELETE, GET, PATCH } from "./route";
import { GET as GET_PREVIEW } from "./preview/route";

const url = "http://localhost/api/v1/generated-artifacts/art_1";
const context = { params: Promise.resolve({ id: "art_1" }) };

describe("generated artifact detail routes", () => {
  it("GET returns 404", async () => {
    expect((await GET(new NextRequest(url), context)).status).toBe(404);
  });

  it("PATCH returns 400 without If-Match", async () => {
    expect((await PATCH(new NextRequest(url, { method: "PATCH" }), context)).status).toBe(400);
  });

  it("PATCH returns 404 with If-Match", async () => {
    const req = new NextRequest(url, { method: "PATCH", body: JSON.stringify({ title: "Updated" }), headers: { "If-Match": "1" } });
    expect((await PATCH(req, context)).status).toBe(404);
  });

  it("DELETE returns 400 without If-Match", async () => {
    expect((await DELETE(new NextRequest(url, { method: "DELETE" }), context)).status).toBe(400);
  });

  it("preview returns 404", async () => {
    expect((await GET_PREVIEW(new NextRequest(`${url}/preview`), context)).status).toBe(404);
  });
});
