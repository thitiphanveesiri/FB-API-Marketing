import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectToken } from "./fbToken";

const graph = (routes: Record<string, unknown>) => async (url: string) => {
  const path = new URL(url).pathname.replace(/^\/v[\d.]+\//, "");
  const body = routes[path] ?? { error: { message: `no route ${path}`, code: 100 } };
  return { ok: !(body as { error?: unknown }).error, status: 200, json: async () => body };
};
const userMe = { "me": { error: { code: 100, message: "(#100) Tried accessing nonexisting field (category)" } } };

test("a Page that is only reachable through a Business portfolio is found", async () => {
  const info = await inspectToken("T", "https://g.test", graph({
    ...userMe, "me/accounts": { data: [] }, "me/assigned_pages": { data: [] },
    "me/businesses": { data: [{ id: "B1" }] }, "B1/owned_pages": { data: [{ id: "P1", name: "Clinic", access_token: "PT" }] }, "B1/client_pages": { data: [] },
  }));
  assert.equal(info.kind === "user" && info.pages[0]?.id, "P1");
});

test("when nothing is found the reason from Meta is kept", async () => {
  const info = await inspectToken("T", "https://g.test", graph({ ...userMe, "me/accounts": { error: { message: "(#200) Requires pages_show_list permission" } } }));
  assert.ok(info.kind === "user" && info.pages.length === 0 && /pages_show_list/.test(info.why ?? ""));
});

test("an app over its Meta call limit stops after one call and says to wait, not to re-issue the token", async () => {
  let calls = 0;
  const g = graph({ ...userMe, "me/accounts": { error: { code: 4, message: "(#4) Application request limit reached" } } });
  const info = await inspectToken("T", "https://g.test", async (u) => { calls++; return g(u); });
  assert.ok(info.kind === "user" && /รอประมาณ 1 ชั่วโมง/.test(info.why ?? ""));
  assert.equal(calls, 3); // me (probe), me (id,name), me/accounts: no assigned_pages / businesses calls
});
