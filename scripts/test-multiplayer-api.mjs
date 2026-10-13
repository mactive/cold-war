import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const checks = [],
  ip = "2001:db8:" + Math.floor(Math.random() * 60000).toString(16) + "::1";
async function req(path, { p, body, method, status = 200, headers = {} } = {}) {
  const r = await fetch(base + "/api/" + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(base.includes("127.0.0.1") ? { "CF-Connecting-IP": ip } : {}),
      ...(p ? { Authorization: "Bearer " + p.token } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return { data, headers: r.headers };
}
const a = (await req("player", { body: { name: "验收·API房主" }, status: 201 }))
    .data,
  b = (await req("player", { body: { name: "验收·API访客" }, status: 201 }))
    .data,
  c = (await req("player", { body: { name: "验收·API旁观者" }, status: 201 }))
    .data;
let r = (await req("rooms", { p: a, body: {}, status: 201 })).data;
const roomId = r.id;
await req("rooms/" + roomId, { status: 401 });
await req("rooms/" + roomId, { p: c, status: 403 });
checks.push("anonymous and nonmember state reads denied");
r = (await req("rooms/" + roomId + "/join", { p: b, body: {} })).data;
assert.notEqual(r.players[0].faction, r.players[1].faction);
assert.equal(r.state.players[0].faction, r.players[1].faction);
assert.equal(r.state.rng, undefined);
assert.ok(r.state.players.every((p) => p.deck.every((c) => c === null)));
assert.ok(r.state.players[1].hand.every((c) => !c.cardId));
checks.push("opposed random factions and per-player hidden information");
await req("rooms/" + roomId + "/join", { p: c, body: {}, status: 409 });
async function action(p, action, extra = {}) {
  const latest = (await req("rooms/" + roomId, { p })).data;
  return (
    await req("rooms/" + roomId + "/actions", {
      p,
      body: {
        revision: latest.revision,
        requestId: crypto.randomUUID(),
        action,
        ...extra,
      },
    })
  ).data;
}
await action(a, { kind: "mulligan", replace: [] });
r = await action(b, { kind: "mulligan", replace: [] });
assert.equal(r.status, "play");
checks.push("independent mulligan transitions to battle");
let av = (await req("rooms/" + roomId, { p: a })).data;
const active = av.state.active === 0 ? a : b,
  other = active === a ? b : a;
await req("rooms/" + roomId + "/actions", {
  p: other,
  body: {
    revision: av.revision,
    requestId: crypto.randomUUID(),
    action: { kind: "end" },
  },
  status: 400,
});
const body = {
  revision: av.revision,
  requestId: crypto.randomUUID(),
  action: { kind: "end" },
  prediction: { hp: [-999, -999], k: 900, points: [500, 500] },
};
const first = (await req("rooms/" + roomId + "/actions", { p: active, body }))
  .data;
const duplicate = (
  await req("rooms/" + roomId + "/actions", { p: active, body })
).data;
assert.equal(first.revision, duplicate.revision);
assert.deepEqual(first.state, duplicate.state);
await req("rooms/" + roomId + "/actions", {
  p: active,
  body: { ...body, action: { kind: "resign" } },
  status: 409,
});
await req("rooms/" + roomId + "/actions", {
  p: other,
  body: { ...body, requestId: crypto.randomUUID() },
  status: 409,
});
checks.push(
  "out-of-turn/stale/tampered requests, idempotent duplicate settlement",
);
av = (await req("rooms/" + roomId, { p: other })).data;
const concurrent = await Promise.all(
  [0, 1].map(() =>
    fetch(base + "/api/rooms/" + roomId + "/actions", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        Authorization: "Bearer " + other.token,
      },
      body: JSON.stringify({
        revision: av.revision,
        requestId: crypto.randomUUID(),
        action: { kind: "end" },
      }),
    }),
  ),
);
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
checks.push("concurrent commands commit exactly one state/log revision");
const creds = JSON.parse(fs.readFileSync(".local/cms-admin.json", "utf8"));
const login = await req("admin/login", {
  body: { username: "admin", password: creds.password },
});
const cookie = login.headers.get("set-cookie").split(";")[0];
const adminHeaders = { Cookie: cookie };
for (let i = 0; i < 3; i++) {
  const current = (await req("rooms/" + roomId, { p: a })).data;
  const actor = current.state.active === 0 ? a : b;
  const [acted, verified] = await Promise.all([
    action(actor, { kind: "end" }),
    req("admin/rooms/" + roomId + "/verify", { headers: adminHeaders }),
  ]);
  assert.equal(verified.data.verified, true);
}
checks.push(
  "live replay is pinned to a consistent revision during concurrent moves",
);
const unchanged = (
  await req(
    "rooms/" +
      roomId +
      "?since=" +
      (await req("rooms/" + roomId, { p: a })).data.revision,
    { p: a },
  )
).data;
assert.equal(unchanged.unchanged, true);
await req("player/logout", { p: b, body: {} });
await req("player", { p: b, status: 401 });
r = (await req("rooms/" + roomId, { p: a })).data;
assert.equal(r.status, "finished");
assert.equal(r.state.winner, 0);
assert.deepEqual(r.score, [3, 0]);
assert.equal((await req("player", { p: a })).data.stats.points, 3);
checks.push("logout revokes identity, forfeits match, server-derived scoring");
const detail = (await req("admin/rooms/" + roomId, { headers: adminHeaders }))
  .data;
assert.ok(detail.rejections.length >= 3);
assert.ok(detail.events.some((e) => e.payload.predictionMatch === false));
assert.ok(detail.events.every((e) => e.payload.requestId));
const verify = (
  await req("admin/rooms/" + roomId + "/verify", { headers: adminHeaders })
).data;
assert.equal(verify.verified, true);
checks.push(
  "admin audit: accepted/rejected log storage and full deterministic replay",
);
await req("admin/rooms", { status: 401 });
await req("player/logout", { p: a, body: {} });
await req("player/logout", { p: c, body: {} });
const report = { base, roomId, checks, verify };
fs.writeFileSync(
  "output/playtest/multiplayer-api-report.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
