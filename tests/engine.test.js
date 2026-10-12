import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../src/game/engine.js";
import { runAITurn, autoChoices } from "../src/game/ai.js";
function setup() {
  const s = E.createGame({ seed: 7, skipMulligan: true });
  s.players.forEach((p) => {
    p.hand = [];
    p.rear = [];
    p.maxK = p.k = 12;
  });
  s.front = [];
  return s;
}
function hand(s, id, p = 0) {
  const c = { uid: "c" + s.nextId++, cardId: id, armed: false };
  s.players[p].hand.push(c);
  return c;
}
function unit(s, id, p = 0, row = "rear") {
  return E.addUnit(s, id, p, { row, ready: true });
}
function spell(s, id, targets = []) {
  const h = hand(s, id);
  assert.equal(E.play(s, h.uid, targets), true, id + " plays");
}
test("CSV import provides exactly 80 unique cards and legal 39-card starter decks", () => {
  assert.equal(E.cards.length, 80);
  for (const f of ["N", "W"]) {
    assert.equal(E.cards.filter((c) => c.id[0] === f).length, 40);
    assert.equal(E.validateDeck(E.defaultDeck(f), f), null);
  }
  assert.notEqual(E.validateDeck(Array(39).fill("N-13"), "N"), null);
});
test("deployment and actions share resources; normal units wait; blitz tank can move and attack", () => {
  const s = setup();
  const h = hand(s, "N-11");
  E.play(s, h.uid);
  const t = s.players[0].rear[0];
  assert.equal(s.players[0].k, 8);
  assert.equal(E.canMove(s, t), false);
  const b = hand(s, "N-14");
  E.play(s, b.uid);
  const blitz = s.players[0].rear[1];
  assert.equal(E.move(s, blitz.uid), true);
  assert.equal(E.attack(s, blitz.uid, "hq1"), true);
  assert.equal(s.players[0].k, 1);
  assert.equal(s.players[1].hp, 16);
});
test("infantry cannot attack after moving; occupied enemy front blocks movement", () => {
  const s = setup(),
    u = unit(s, "N-02");
  assert.equal(E.move(s, u.uid), true);
  assert.equal(E.attack(s, u.uid, "hq1"), false);
  s.active = 1;
  const v = unit(s, "W-02", 1);
  assert.equal(E.canMove(s, v), false);
});
test("support line and token generation obey capacity limits", () => {
  const s = setup();
  for (let i = 0; i < 3; i++) unit(s, "N-01");
  spell(s, "N-26");
  assert.equal(s.players[0].rear.length, 4);
  const h = hand(s, "N-01");
  assert.equal(E.canPlay(s, 0, h), false);
  E.assertState(s);
});
test("guard protects adjacent HQ and units, artillery bypasses guard", () => {
  const s = setup(),
    guard = unit(s, "W-01", 1),
    other = unit(s, "W-03", 1),
    tank = unit(s, "N-11", 0, "front"),
    gun = unit(s, "N-15");
  const ts = E.attackTargets(s, tank).map((t) => t.uid);
  assert(ts.includes(guard.uid));
  assert(!ts.includes(other.uid));
  assert(!ts.includes("hq1"));
  assert(E.attackTargets(s, gun).some((t) => t.uid === "hq1"));
});
test("adjacent frontline guards remain attackable by a support tank and fighter", () => {
  const s = setup(),
    left = unit(s, "W-01", 1, "front"),
    middle = unit(s, "W-01", 1, "front"),
    reserve = unit(s, "W-T1", 1, "front"),
    rear = unit(s, "W-03", 1),
    tank = unit(s, "N-10"),
    fighter = unit(s, "N-19");
  left.hp = 1;
  middle.hp = 2;
  tank.hp = tank.maxHp = 4;
  assert.deepEqual(
    E.attackTargets(s, tank).map((t) => t.uid),
    [left.uid, middle.uid],
  );
  const airTargets = E.attackTargets(s, fighter).map((t) => t.uid);
  for (const id of [left.uid, middle.uid, rear.uid, "hq1"])
    assert(airTargets.includes(id));
  assert(!airTargets.includes(reserve.uid));
  assert.equal(E.attack(s, tank.uid, reserve.uid), false);
  assert.equal(s.players[0].k, 12);
  assert.equal(E.attack(s, tank.uid, middle.uid), true);
  assert.equal(E.find(s, middle.uid), null);
  assert.equal(tank.hp, 3);
  assert.equal(s.players[0].k, 11);
  // Removing the middle guard closes the gap; the surviving guard protects the reserve.
  assert(!E.attackTargets(s, fighter).some((t) => t.uid === reserve.uid));
  E.assertState(s);
});
test("rear guards do not guard one another and their smoke still prevents attacks", () => {
  const s = setup(),
    left = unit(s, "W-01", 1),
    right = unit(s, "W-01", 1),
    fighter = unit(s, "N-19");
  assert.deepEqual(
    E.attackTargets(s, fighter).map((t) => t.uid),
    [left.uid, right.uid],
  );
  left.smoke = true;
  assert.deepEqual(
    E.attackTargets(s, fighter).map((t) => t.uid),
    [right.uid],
  );
  assert(!E.attackTargets(s, fighter).some((t) => t.hq));
});
test("smoke prevents unit targeting; order damage bypasses armor and smoke", () => {
  const s = setup(),
    hidden = unit(s, "W-10", 1),
    gun = unit(s, "N-15");
  assert(!E.attackTargets(s, gun).some((t) => t.uid === hidden.uid));
  spell(s, "N-31", [[hidden.uid]]);
  assert.equal(E.find(s, hidden.uid), null);
  const tank = unit(s, "W-13", 1);
  spell(s, "N-31", [[tank.uid]]);
  assert.equal(E.find(s, tank.uid), null);
});
test("armor reduces battle damage and artillery receives no return fire", () => {
  const s = setup(),
    target = unit(s, "W-13", 1),
    gun = unit(s, "N-15");
  E.attack(s, gun.uid, target.uid);
  assert.equal(target.hp, 3);
  assert.equal(gun.hp, 3);
});
test("fighters shield their row from bombers until removed", () => {
  const s = setup(),
    fighter = unit(s, "W-22", 1),
    bomber = unit(s, "N-23");
  assert.equal(E.attackTargets(s, bomber).length, 0);
  fighter.smoke = true;
  assert(E.attackTargets(s, bomber).some((t) => t.hq));
});
test("ambush kills attacker first; shock suppresses ambush for first attack", () => {
  const s = setup(),
    defender = unit(s, "W-06", 1),
    attacker = unit(s, "N-02", 0, "front");
  E.attack(s, attacker.uid, defender.uid);
  assert.equal(E.find(s, attacker.uid), null);
  assert.equal(defender.hp, 2);
  const tank = unit(s, "N-12", 0, "front");
  defender.ambush = true;
  E.attack(s, tank.uid, defender.uid);
  assert.equal(tank.hp, 6);
  assert.equal(tank.shock, false);
});
test("lock damage bonus ends at the end of the casting turn", () => {
  const s = setup(),
    tank = unit(s, "W-17", 1),
    friendly = unit(s, "N-11");
  spell(s, "N-34", [[tank.uid], [friendly.uid]]);
  assert(E.locked(s, tank));
  spell(s, "N-31", [[tank.uid]]);
  assert.equal(tank.hp, 1);
  E.endTurn(s);
  assert(!E.locked(s, tank));
});
test("pin lasts through enemy turn; temporary attack buffs expire", () => {
  const s = setup(),
    target = unit(s, "W-01", 1);
  spell(s, "N-35", [[target.uid]]);
  assert.equal(E.attackValue(s, target), 0);
  E.endTurn(s);
  assert.equal(E.attackValue(s, target), 0);
  E.endTurn(s);
  assert.equal(E.attackValue(s, target), 1);
  const h = hand(s, "W-10");
  E.play(s, h.uid, [[target.uid]]);
  E.endTurn(s);
  assert.equal(E.canAct(s, target), false);
  E.endTurn(s);
  E.endTurn(s);
  assert.equal(E.canAct(s, target), true);
});
test("withdraw resets damage and buffs; mind control preserves permanent damage/buffs and cannot act", () => {
  const s = setup(),
    u = unit(s, "N-11");
  u.hp = 2;
  u.attack = 9;
  spell(s, "W-31", [[u.uid]]);
  const h = s.players[0].hand.find((c) => c.cardId === "N-11");
  E.play(s, h.uid);
  assert.equal(s.players[0].rear[0].attack, 4);
  const enemy = unit(s, "W-03", 1);
  enemy.hp = 2;
  s.players[0].k = 12;
  spell(s, "W-36", [[enemy.uid]]);
  assert.equal(enemy.p, 0);
  assert.equal(enemy.hp, 2);
  assert.equal(E.canMove(s, enemy), false);
});
test("death summons reserve but returning a card does not", () => {
  const s = setup(),
    u = unit(s, "W-04", 1);
  spell(s, "N-31", [[u.uid]]);
  assert(s.players[1].rear.some((x) => x.cardId === "W-T1"));
  const own = unit(s, "W-11");
  spell(s, "W-31", [[own.uid]]);
  assert(!s.players[0].rear.some((x) => x.cardId === "W-T1"));
});
function arm(s, id, p = 1) {
  const h = hand(s, id, p);
  h.armed = true;
  h.armedSeq = s.nextId;
  return h;
}
test("counter N-37 cancels deployment effect but preserves body", () => {
  const s = setup();
  arm(s, "N-37");
  const ally = unit(s, "N-19");
  spell(s, "N-20", []);
  assert.equal(s.players[0].rear.length, 2);
  assert.equal(s.players[1].hand.length, 1);
});
test("counter N-38 returns defender before combat; attacker pays", () => {
  const s = setup();
  arm(s, "N-38");
  const defender = unit(s, "W-03", 1),
    attacker = unit(s, "N-11", 0, "front");
  E.attack(s, attacker.uid, defender.uid);
  assert.equal(E.find(s, defender.uid), null);
  assert(s.players[1].hand.some((c) => c.cardId === "W-03"));
  assert.equal(s.players[0].k, 11);
  assert.equal(attacker.hp, 5);
});
test("counter N-39 destroys fragile plane before damage", () => {
  const s = setup();
  arm(s, "N-39");
  const air = unit(s, "N-19");
  air.hp = 3;
  E.attack(s, air.uid, "hq1");
  assert.equal(s.players[1].hp, 20);
  assert.equal(E.find(s, air.uid), null);
});
test("order cancellation consumes resources but cancels all effects", () => {
  const s = setup(),
    u = unit(s, "W-03", 1);
  arm(s, "N-40");
  spell(s, "N-36", [[u.uid]]);
  assert.equal(u.hp, 4);
  assert.equal(s.players[0].maxK, 12);
  assert.equal(s.players[0].k, 7);
  arm(s, "W-38");
  spell(s, "N-31", [[u.uid]]);
  assert.equal(u.hp, 4);
});
test("counter W-37 stops tank after movement only for current turn", () => {
  const s = setup();
  arm(s, "W-37");
  const u = unit(s, "N-14");
  E.move(s, u.uid);
  assert.equal(E.attack(s, u.uid, "hq1"), false);
  E.endTurn(s);
  E.endTurn(s);
  assert.equal(E.canAct(s, u), true);
});
test("counter W-39 intercepts aircraft on deployment; surviving body resolves", () => {
  const s = setup();
  arm(s, "W-39");
  const t = unit(s, "W-03", 1);
  spell(s, "N-19", [[t.uid]]);
  assert.equal(s.players[0].rear[0].hp, 1);
  assert(E.locked(s, t));
});
test("counter W-40 cancels only reveal, not satellite lock or draw", () => {
  const s = setup();
  arm(s, "W-40");
  hand(s, "W-01", 1);
  const t = unit(s, "W-03", 1);
  const start = s.players[1].hand.length;
  spell(s, "N-33", [[t.uid]]);
  assert.equal(s.players[1].hand.length, start + 1);
  assert(!s.players[1].hand.some((h) => h.revealed));
  assert(E.locked(s, t));
  assert.equal(s.players[0].hand.length, 1);
});
test("fatigue grows; overflow never increases hand count", () => {
  const s = setup();
  s.players[0].deck = [];
  E.draw(s, 0, 3);
  assert.equal(s.players[0].hp, 14);
  const s2 = setup();
  for (let i = 0; i < 9; i++) hand(s2, "N-01");
  const n = s2.players[0].deck.length;
  E.draw(s2, 0);
  assert.equal(s2.players[0].hand.length, 9);
  assert.equal(s2.players[0].deck.length, n - 1);
});
test("invalid action is rejected without mutating the state", () => {
  const s = setup();
  const h = hand(s, "N-31");
  const before = JSON.stringify(s);
  assert.equal(E.play(s, h.uid, [["hq1"]]), false);
  assert.equal(JSON.stringify(s), before);
});
test("all 80 cards can be played in valid representative states without broken invariants", () => {
  for (const c of E.cards) {
    const s = setup();
    s.players[0].k = s.players[0].maxK = 24;
    const friendly1 = unit(s, "N-02"),
      friendly2 = unit(s, "N-19"),
      friendly3 = unit(s, "W-13", 0, "front");
    const enemy1 = unit(s, "W-03", 1),
      enemy2 = unit(s, "W-18", 1),
      enemy3 = unit(s, "W-22", 1);
    enemy1.lockUntil = s.seq;
    if (c.id === "W-05") {
      s.front = [];
      const e = unit(s, "W-03", 1, "front");
    }
    if (c.id === "W-29") hand(s, "W-13");
    const h = hand(s, c.id);
    assert(E.canPlay(s, 0, h), c.id + " playable");
    assert(E.play(s, h.uid, autoChoices(s, 0, h)), c.id + " resolves");
    E.assertState(s);
  }
});
test("seeded matches replay identically and complete with invariant checks", () => {
  function run() {
    const s = E.createGame({ seed: 987, skipMulligan: true });
    while (s.phase === "play" && s.seq < 160) {
      runAITurn(s);
      E.assertState(s);
    }
    assert.notEqual(s.winner, null);
    return s;
  }
  assert.deepEqual(run(), run());
});
test("air-land battle permanently buffs both units but its free operations expire", () => {
  const s = setup(),
    tank = unit(s, "N-10"),
    plane = unit(s, "N-19");
  spell(s, "N-29", [[tank.uid], [plane.uid]]);
  assert.equal(tank.attack, 4);
  assert.equal(tank.maxHp, 4);
  assert.equal(E.operationCost(s, tank), 0);
  E.endTurn(s);
  assert.equal(E.operationCost(s, tank), 1);
  assert.equal(tank.attack, 4);
});
test("submarine deployment tax applies to only first unit of the next enemy turn", () => {
  const s = setup();
  spell(s, "W-34");
  assert.equal(s.players[1].hp, 17);
  E.endTurn(s);
  const first = hand(s, "W-01", 1),
    second = hand(s, "W-01", 1);
  assert.equal(E.playCost(s, 1, first), 3);
  assert(E.play(s, first.uid));
  assert.equal(E.playCost(s, 1, second), 1);
});
test("splash snapshots neighbors and death cleanup makes room for reserves", () => {
  const s = setup(),
    left = unit(s, "W-04", 1),
    center = unit(s, "W-03", 1),
    right = unit(s, "W-11", 1);
  left.hp = 1;
  right.hp = 1;
  spell(s, "W-33", [[center.uid]]);
  assert.equal(s.players[1].rear.length, 2);
  assert(s.players[1].rear.every((u) => u.cardId === "W-T1" && u.hp === 1));
  E.assertState(s);
});
