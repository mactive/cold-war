import test from "node:test";
import assert from "node:assert/strict";
import { builtInContent } from "../src/content/runtime.js";
import {
  rulesFor,
  applyCommand,
  cleanAction,
  playerView,
  orientAction,
  summary,
} from "../src/game/multiplayer.js";
test("isolated rules instances preserve each room catalog without mutable request state", () => {
  const a = builtInContent(),
    b = builtInContent();
  b.data.cards.find((c) => c.id === "N-11").attack = 9;
  const ea = rulesFor(a),
    eb = rulesFor(b),
    sa = ea.createGame(),
    sb = eb.createGame();
  assert.equal(ea.makeUnit(sa, "N-11", 0).attack, 4);
  assert.equal(eb.makeUnit(sb, "N-11", 0).attack, 9);
  assert.equal(ea.makeUnit(sa, "N-11", 0).attack, 4);
});
test("both players ready independently; invalid and duplicate mulligans are rejected", () => {
  const E = rulesFor(builtInContent()),
    s = E.createGame({ multiplayer: true, firstPlayer: 1, seed: 42 });
  assert.throws(() => applyCommand(E, s, 1, { kind: "end" }));
  assert.throws(() =>
    applyCommand(E, s, 1, {
      kind: "mulligan",
      replace: [s.players[0].hand[0].uid],
    }),
  );
  applyCommand(E, s, 1, { kind: "mulligan", replace: [] });
  assert.equal(s.phase, "mulligan");
  assert.throws(() => applyCommand(E, s, 1, { kind: "mulligan", replace: [] }));
  applyCommand(E, s, 0, { kind: "mulligan", replace: [] });
  assert.equal(s.active, 1);
  assert.equal(s.phase, "play");
  assert.throws(() => applyCommand(E, s, 0, { kind: "end" }));
});
test("player views conceal shuffle, draw order, unknown hand, counter flags and enemy resources", () => {
  const E = rulesFor(builtInContent()),
    s = E.createGame({ multiplayer: true, seed: 99 });
  s.players[0].hand[0].armed = true;
  s.players[0].hand[1].revealed = true;
  const v = playerView(s, 1);
  assert.equal(v.rng, undefined);
  assert.equal(v.nextId, undefined);
  assert.ok(v.players.every((p) => p.deck.every((c) => c === null)));
  assert.equal(v.players[1].hand[0].cardId, undefined);
  assert.equal(v.players[1].hand[0].armed, undefined);
  assert.equal(v.players[1].hand[1].cardId, s.players[0].hand[1].cardId);
  assert.equal(v.players[1].k, 0);
  assert.equal(v.players[0].hand[0].cardId, s.players[1].hand[0].cardId);
});
test("seat-one board and HQ targeting normalize reversibly, with deterministic replay", () => {
  const E = rulesFor(builtInContent()),
    s = E.createGame({ multiplayer: true, firstPlayer: 1, seed: 20 });
  applyCommand(E, s, 0, { kind: "mulligan", replace: [] });
  applyCommand(E, s, 1, { kind: "mulligan", replace: [] });
  s.players[1].k = 12;
  const u = E.addUnit(s, "W-13", 1, { row: "front", ready: true });
  const v = playerView(s, 1);
  assert.equal(v.front[0].p, 0);
  assert.equal(v.active, 0);
  const a = { kind: "attack", uid: u.uid, target: "hq1" },
    mapped = orientAction(a, 1);
  assert.equal(mapped.target, "hq0");
  assert.deepEqual(orientAction(mapped, 1), a);
  const replay = structuredClone(s);
  applyCommand(E, s, 1, mapped);
  applyCommand(E, replay, 1, mapped);
  assert.deepEqual(s, replay);
  assert.equal(summary(s, 1).hp[1], 16);
});
test("command validation and result scoring reject tampering and settle resignation once", () => {
  for (const a of [
    { kind: "setHp", hp: 0 },
    { kind: "move", uid: "x", pos: 0 },
    { kind: "play", uid: "c1", choices: [["u1", "u1"]] },
    { kind: "move", uid: "u1", pos: -1 },
  ])
    assert.throws(() => cleanAction(a));
  const E = rulesFor(builtInContent()),
    s = E.createGame({ multiplayer: true });
  applyCommand(E, s, 1, { kind: "resign" });
  assert.deepEqual(summary(s, 0).points, [3, 0]);
  assert.throws(() => applyCommand(E, s, 0, { kind: "end" }));
});
