import { createEngine } from "./engine-core.js";
export function rulesFor(content) {
  const data = content.data;
  return createEngine({
    catalog: Object.fromEntries(
      [...data.cards, ...data.tokens].map((c) => [c.id, c]),
    ),
    cards: data.cards,
    starterDecks: data.decks,
    contentSnapshot: () => structuredClone(content),
  });
}
export function cleanAction(a) {
  if (!a || typeof a !== "object" || Array.isArray(a))
    throw Error("操作格式无效");
  const out = { kind: a.kind };
  if (
    !["mulligan", "play", "move", "attack", "end", "disarm", "resign"].includes(
      a.kind,
    )
  )
    throw Error("未知操作");
  const uid = (x) =>
    typeof x === "string" && /^(?:[cu]\d{1,12}|hq[01])$/.test(x);
  if (["play", "move", "attack", "disarm"].includes(a.kind)) {
    if (!uid(a.uid)) throw Error("卡牌或单位编号无效");
    out.uid = a.uid;
  }
  if (a.kind === "attack") {
    if (!uid(a.target)) throw Error("攻击目标无效");
    out.target = a.target;
  }
  if (a.kind === "play") {
    if (
      !Array.isArray(a.choices ?? []) ||
      (a.choices ?? []).length > 5 ||
      (a.choices ?? []).some(
        (g) =>
          !Array.isArray(g) ||
          g.length > 10 ||
          g.some((x) => !uid(x)) ||
          new Set(g).size !== g.length,
      )
    )
      throw Error("目标组无效");
    out.choices = a.choices ?? [];
  }
  if (["move", "play"].includes(a.kind) && a.pos !== undefined) {
    if (!Number.isInteger(a.pos) || a.pos < 0 || a.pos > 4)
      throw Error("位置无效");
    out.pos = a.pos;
  }
  if (a.kind === "mulligan") {
    if (
      !Array.isArray(a.replace) ||
      a.replace.length > 5 ||
      a.replace.some((x) => !uid(x)) ||
      new Set(a.replace).size !== a.replace.length
    )
      throw Error("换牌无效");
    out.replace = a.replace;
  }
  return out;
}
export function applyCommand(E, s, p, a) {
  if (s.winner !== null) throw Error("对局已经结束");
  if (a.kind === "resign") {
    s.winner = 1 - p;
    s.phase = "finished";
    s.logs.push({
      kind: "info",
      seq: s.seq,
      text: `${p === 0 ? "我方" : "敌方"}认输。`,
    });
    return;
  }
  if (a.kind === "mulligan") {
    if (!E.readyPlayer(s, p, a.replace)) throw Error("已整备或换牌无效");
    return;
  }
  if (s.phase !== "play" || s.active !== p) throw Error("尚未轮到你行动");
  let ok = false;
  if (a.kind === "play") ok = E.play(s, a.uid, a.choices, a.pos);
  if (a.kind === "move") ok = E.move(s, a.uid, a.pos);
  if (a.kind === "attack") ok = E.attack(s, a.uid, a.target);
  if (a.kind === "disarm") ok = E.disarm(s, a.uid);
  if (a.kind === "end") ok = E.endTurn(s);
  if (!ok) throw Error("资源、目标或行动次数不满足规则");
  E.assertState(s);
}
export const resultPoints = (s) =>
  s.winner === null
    ? [0, 0]
    : s.winner === "draw"
      ? [1, 1]
      : s.winner === 0
        ? [3, 0]
        : [0, 3];
export function summary(s, p = 0) {
  return {
    hp: [s.players[p].hp, s.players[1 - p].hp],
    k: s.players[p].k,
    points: p ? resultPoints(s).reverse() : resultPoints(s),
  };
}
const swapID = (x) => (x === "hq0" ? "hq1" : x === "hq1" ? "hq0" : x);
export function orientAction(action, seat) {
  const a = structuredClone(action);
  if (seat === 1) {
    if (a.target) a.target = swapID(a.target);
    if (a.choices) a.choices = a.choices.map((g) => g.map(swapID));
  }
  return a;
}
export function playerView(state, seat) {
  const s = structuredClone(state);
  // No shuffle seed, draw order, unscouted card IDs, counter flags, or remaining enemy resources cross the boundary.
  delete s.rng;
  delete s.nextId;
  for (let p = 0; p < 2; p++) {
    s.players[p].deck = s.players[p].deck.map(() => null);
    if (p !== seat) {
      s.players[p].hand = s.players[p].hand.map((c, i) =>
        c.revealed
          ? { uid: `scouted${i}`, cardId: c.cardId, revealed: true }
          : { uid: `hidden${i}`, revealed: false },
      );
      for (const k of [
        "k",
        "drawNext",
        "infDiscount",
        "taxOrder",
        "taxUnit",
        "nextTaxOrder",
        "nextTaxUnit",
      ])
        s.players[p][k] = 0;
    }
  }
  if (seat === 1) {
    s.players.reverse();
    s.active = 1 - s.active;
    if (typeof s.winner === "number") s.winner = 1 - s.winner;
    if (s.firstPlayer !== undefined) s.firstPlayer = 1 - s.firstPlayer;
    s.mulliganReady?.reverse();
    for (const u of [...s.front, ...s.players.flatMap((p) => p.rear)]) {
      u.p = 1 - u.p;
      if (u.ignoreTarget) u.ignoreTarget = swapID(u.ignoreTarget);
    }
    s.logs = s.logs.map((l) => ({
      ...l,
      ...(l.uid ? { uid: swapID(l.uid) } : {}),
      text: l.text.replace(/我方|敌方/g, (x) =>
        x === "我方" ? "敌方" : "我方",
      ),
    }));
  }
  return s;
}
