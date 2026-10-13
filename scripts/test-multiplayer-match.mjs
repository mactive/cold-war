import assert from "node:assert/strict";
import fs from "node:fs";
import { installContent } from "../src/content/runtime.js";
import { chooseAction } from "../src/game/ai.js";
import { orientAction } from "../src/game/multiplayer.js";
const base = process.argv[2] ?? "http://127.0.0.1:8787",
  players = [];
async function api(path, p, body, headers = {}) {
  const r = await fetch(base + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(p ? { Authorization: "Bearer " + p.token } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Error(r.status + " " + JSON.stringify(d));
  return { data: d, headers: r.headers };
}
let id;
try {
  for (let i = 0; i < 2; i++)
    players.push(
      (await api("player", null, { name: "完整对局验收" + i })).data,
    );
  let room = (await api("rooms", players[0], {})).data;
  id = room.id;
  await api("rooms/" + id + "/join", players[1], {});
  async function send(p, action) {
    const r = (await api("rooms/" + id, p)).data;
    return (
      await api("rooms/" + id + "/actions", p, {
        revision: r.revision,
        requestId: crypto.randomUUID(),
        action: orientAction(action, r.seat),
      })
    ).data;
  }
  for (const p of players) await send(p, { kind: "mulligan", replace: [] });
  let actions = 0,
    attacks = 0,
    plays = 0;
  while (actions < 350) {
    const host = (await api("rooms/" + id, players[0])).data;
    if (host.status === "finished") {
      room = host;
      break;
    }
    const p = players[host.state.active],
      view = p === players[0] ? host : (await api("rooms/" + id, p)).data;
    installContent(view.state.content);
    const action = chooseAction(view.state);
    assert.ok(action);
    if (action.kind === "attack") attacks++;
    if (action.kind === "play") plays++;
    await send(p, action);
    actions++;
  }
  assert.equal(room.status, "finished");
  assert.ok(attacks > 0 && plays > 0);
  const creds = JSON.parse(fs.readFileSync(".local/cms-admin.json", "utf8")),
    login = await api("admin/login", null, {
      username: "admin",
      password: creds.password,
    });
  const verify = (
    await api("admin/rooms/" + id + "/verify", null, null, {
      Cookie: login.headers.get("set-cookie").split(";")[0],
    })
  ).data;
  assert.equal(verify.verified, true);
  const report = {
    base,
    roomId: id,
    actions,
    attacks,
    plays,
    turns: room.state.stats.turns,
    hq: room.state.players.map((p) => p.hp),
    winner: room.state.winner,
    score: room.score,
    verify,
  };
  fs.writeFileSync(
    "output/playtest/multiplayer-match-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  for (const p of players) {
    try {
      await api("player/logout", p, {});
    } catch {}
  }
}
