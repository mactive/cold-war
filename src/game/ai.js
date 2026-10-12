import {
  units,
  find,
  def,
  canPlay,
  canMove,
  attackTargets,
  attackValue,
  operationCost,
  playCost,
  targetGroups,
  play,
  move,
  attack,
  endTurn,
  random,
  controls,
} from "./engine.js";
function worth(s, u) {
  return u?.hq
    ? 8
    : u
      ? def(u).cost + (u.attack ?? 0) * 0.45 + (u.hp ?? 0) * 0.25
      : 0;
}
export function autoChoices(s, p, h) {
  const choices = [];
  let gs = targetGroups(s, p, h, choices);
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    const ids = [...g.options].sort((x, y) => {
      const a = find(s, x),
        b = find(s, y);
      let va = worth(s, a),
        vb = worth(s, b);
      if (["W-09", "W-31"].includes(h.cardId)) {
        va = a ? (a.maxHp - a.hp) * 2 : 0;
        vb = b ? (b.maxHp - b.hp) * 2 : 0;
      }
      return vb - va;
    });
    let n = g.max;
    if (h.cardId === "W-31")
      n = ids.filter((id) => {
        const u = find(s, id);
        return u && u.hp < u.maxHp;
      }).length;
    if (h.cardId === "W-32")
      n = ids.filter((id) => {
        const u = find(s, id);
        return u && u.born === s.seq;
      }).length;
    choices.push(ids.slice(0, Math.max(g.min, Math.min(n, g.max))));
    gs = targetGroups(s, p, h, choices);
  }
  return choices;
}
export function chooseAction(s) {
  if (s.phase !== "play") return null;
  const p = s.active,
    pl = s.players[p],
    candidates = [];
  for (const u of units(s, p)) {
    if (canMove(s, u))
      candidates.push({
        kind: "move",
        uid: u.uid,
        score:
          3 +
          u.attack * 0.28 +
          (def(u).type === "坦克" ? 1 : 0) +
          (controls(s, p) ? 0 : 1),
      });
    for (const t of attackTargets(s, u)) {
      const damage = Math.max(0, attackValue(s, u, t, true) - (t.armor ?? 0));
      let score = damage * 0.9;
      if (t.hq) score = damage >= s.players[t.p].hp ? 10000 : damage * 0.85 + 1;
      else {
        if (damage >= t.hp) score += worth(s, t) + 2;
        const safe =
          def(u).type === "炮兵" ||
          def(u).type === "轰炸机" ||
          (def(u).type === "战斗机" &&
            ["步兵", "坦克", "炮兵"].includes(def(t).type)) ||
          u.shock;
        if (!safe && attackValue(s, t) >= u.hp + (u.armor ?? 0))
          score -= worth(s, u) * 0.65;
      }
      candidates.push({
        kind: "attack",
        uid: u.uid,
        target: t.uid,
        score: score - operationCost(s, u) * 0.1,
      });
    }
  }
  for (const h of pl.hand) {
    if (!canPlay(s, p, h)) continue;
    const c = def(h),
      choices = autoChoices(s, p, h);
    let score = 0;
    const cost = playCost(s, p, h);
    if (c.attack !== null)
      score =
        2 +
        c.attack * 0.5 +
        c.defense * 0.25 +
        (pl.rear.length < 2 ? 2 : 0) -
        c.cost * 0.15;
    else if (c.type === "反制") score = 0.8;
    else {
      score = 2.5;
      const target = find(s, choices[0]?.[0]);
      if (["N-31", "N-32", "N-36", "W-30", "W-33", "W-36"].includes(c.id))
        score = worth(s, target) * 0.9 + 2;
      if (["N-25", "N-28", "W-35"].includes(c.id))
        score = pl.hand.length <= 5 ? 5 : 1;
      if (["N-26", "N-30", "W-27"].includes(c.id))
        score = pl.rear.length <= 2 ? 5 : 1;
      if (["N-29", "W-28", "W-32"].includes(c.id))
        score = units(s, p).filter((u) => !u.attacked).length * 1.1;
      if (c.id === "W-31") score = choices[0].length ? 2 : -1;
      if (c.id === "W-34") score = s.players[1 - p].hp <= 3 ? 10000 : 3;
      if (c.id === "N-33")
        score = pl.hand.some((x) => x.cardId === "N-31") ? 5 : 2;
    }
    if (score > 0)
      candidates.push({
        kind: "play",
        uid: h.uid,
        choices,
        score: score - cost * 0.06,
      });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? { kind: "end" };
}
export function performAction(s, a) {
  if (!a) return false;
  if (a.kind === "play") return play(s, a.uid, a.choices, a.pos);
  if (a.kind === "move") return move(s, a.uid);
  if (a.kind === "attack") return attack(s, a.uid, a.target);
  if (a.kind === "end") return endTurn(s);
  return false;
}
export function runAITurn(s, maxActions = 80) {
  const seq = s.seq;
  let n = 0;
  while (s.phase === "play" && s.seq === seq && n++ < maxActions) {
    const a = chooseAction(s);
    if (!performAction(s, a))
      throw Error("AI generated an illegal action: " + JSON.stringify(a));
  }
  if (n >= maxActions && s.phase === "play" && s.seq === seq) endTurn(s);
  return n;
}
