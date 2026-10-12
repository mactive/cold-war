import { catalog, cards, starterDecks } from "./catalog.js";
export { catalog, cards, starterDecks };
export const LIMITS = { 普通: 4, 限定: 3, 特殊: 2, 精英: 1 };
export const isAir = (u) => ["战斗机", "轰炸机"].includes(def(u).type);
export const isGround = (u) => !!u && !u.hq && !isAir(u);
export const def = (u) => catalog[u.cardId ?? u.id] ?? u;
export const units = (s, p) => [
  ...s.players[p].rear,
  ...s.front.filter((u) => u.p === p),
];
export const allUnits = (s) => [...units(s, 0), ...units(s, 1)];
export const find = (s, id) =>
  allUnits(s).find((u) => u.uid === id) ??
  (id === "hq0" ? hq(s, 0) : id === "hq1" ? hq(s, 1) : null);
export const hq = (s, p) => ({
  uid: "hq" + p,
  p,
  hq: true,
  hp: s.players[p].hp,
  attack: 0,
});
export const controls = (s, p) => s.front.some((u) => u.p === p);
export function random(s) {
  let x = s.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}
function shuffle(s, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function log(s, text, kind = "info", extra = {}) {
  s.logs.push({ text, kind, seq: s.seq, ...extra });
  if (s.logs.length > 160) s.logs.shift();
}
function handCard(s, id) {
  return { uid: "c" + s.nextId++, cardId: id, revealed: false, armed: false };
}
export function validateDeck(ids, faction) {
  if (ids.length !== 39) return "牌库必须恰好39张（总部另计）";
  const counts = {};
  for (const id of ids) {
    const c = catalog[id];
    if (!c || !cards.some((x) => x.id === id) || id[0] !== faction)
      return "只能使用本阵营可构筑卡牌";
    counts[id] = (counts[id] ?? 0) + 1;
    if (counts[id] > LIMITS[c.rarity]) return `${c.name}超过同名上限`;
  }
  return null;
}
export function defaultDeck(faction) {
  return starterDecks
    .find((d) => d.id[0] === faction)
    .cards.flatMap((e) => Array(e.count).fill(e.id));
}
export function createGame({
  faction = "N",
  seed = Date.now(),
  decks,
  skipMulligan = false,
} = {}) {
  const s = {
    version: 1,
    rng: Number(seed) >>> 0 || 1,
    nextId: 1,
    seq: 0,
    active: 0,
    phase: "mulligan",
    winner: null,
    front: [],
    logs: [],
    players: [],
    stats: { actions: 0, turns: 0 },
  };
  for (let p = 0; p < 2; p++) {
    const f = p === 0 ? faction : faction === "N" ? "W" : "N";
    const deck = decks?.[p] ?? defaultDeck(f);
    const err = validateDeck(deck, f);
    if (err) throw Error(err);
    s.players.push({
      faction: f,
      hp: 20,
      maxK: 0,
      k: 0,
      fatigue: 0,
      deck: shuffle(s, [...deck]),
      hand: [],
      rear: [],
      drawNext: 0,
      infDiscount: false,
      taxOrder: 0,
      taxUnit: 0,
      nextTaxOrder: 0,
      nextTaxUnit: 0,
      turns: 0,
    });
  }
  draw(s, 0, 4);
  draw(s, 1, 5);
  mulligan(
    s,
    1,
    s.players[1].hand.filter((c) => def(c).cost >= 5).map((c) => c.uid),
  );
  log(s, "作战准备完成。选择起手换牌，或直接进入战场。");
  if (skipMulligan) startGame(s, []);
  return s;
}
function mulligan(s, p, ids) {
  const player = s.players[p];
  const old = player.hand.filter((c) => ids.includes(c.uid));
  player.hand = player.hand.filter((c) => !ids.includes(c.uid));
  draw(s, p, old.length);
  player.deck.push(...old.map((c) => c.cardId));
  shuffle(s, player.deck);
}
export function startGame(s, replace = []) {
  if (s.phase !== "mulligan") return false;
  mulligan(s, 0, replace);
  s.phase = "play";
  beginTurn(s, 0);
  return true;
}
export function draw(s, p, n = 1) {
  for (let i = 0; i < n && s.winner === null; i++) {
    const pl = s.players[p];
    if (!pl.deck.length) {
      pl.hp -= ++pl.fatigue;
      log(s, `${side(p)}空抽，总部承受${pl.fatigue}点士气伤害。`, "damage");
      checkWinner(s);
      continue;
    }
    const id = pl.deck.pop();
    if (pl.hand.length < 9) pl.hand.push(handCard(s, id));
    else log(s, `${side(p)}手牌已满，溢出一张牌。`);
  }
}
const side = (p) => (p === 0 ? "我方" : "敌方");
function checkWinner(s) {
  if (s.players.every((p) => p.hp <= 0)) s.winner = "draw";
  else if (s.players[0].hp <= 0) s.winner = 1;
  else if (s.players[1].hp <= 0) s.winner = 0;
  if (s.winner !== null) s.phase = "finished";
}
function beginTurn(s, p) {
  s.active = p;
  s.seq++;
  s.stats.turns++;
  const pl = s.players[p];
  pl.turns++;
  for (const c of pl.hand) c.armed = false;
  pl.maxK = Math.min(24, pl.maxK < 12 ? pl.maxK + 1 : pl.maxK);
  pl.k = pl.maxK;
  pl.taxOrder = pl.nextTaxOrder;
  pl.taxUnit = pl.nextTaxUnit;
  pl.nextTaxOrder = pl.nextTaxUnit = 0;
  for (const u of units(s, p)) {
    u.moved = false;
    u.attacked = false;
  }
  log(s, `${side(p)}第${pl.turns}回合 · ${pl.k}指挥点`, "turn");
  if (!(p === 0 && pl.turns === 1)) draw(s, p);
  const bonus = pl.drawNext;
  pl.drawNext = 0;
  if (bonus) draw(s, p, bonus);
}
export function endTurn(s) {
  if (s.phase !== "play") return false;
  const p = s.active;
  for (const u of allUnits(s)) {
    u.mods = u.mods.filter((m) => m.until > s.seq);
    if (u.lockUntil <= s.seq) u.lockUntil = 0;
    if (u.freeMoveUntil <= s.seq) u.freeMoveUntil = 0;
    if (u.blitzUntil <= s.seq) u.blitzUntil = 0;
    if (u.ignoreUntil <= s.seq) {
      u.ignoreUntil = 0;
      u.ignoreTarget = null;
    }
  }
  s.players[p].infDiscount = false;
  s.players[p].taxOrder = s.players[p].taxUnit = 0;
  beginTurn(s, 1 - p);
  return true;
}
export function makeUnit(s, id, p, { ready = false } = {}) {
  const c = catalog[id],
    e = c.effect ?? "";
  return {
    uid: "u" + s.nextId++,
    cardId: id,
    p,
    attack: c.attack,
    hp: c.defense,
    maxHp: c.defense,
    armor: Number(e.match(/重甲(\d)/)?.[1] ?? 0),
    guard: e.startsWith("守护") || e.includes("。守护"),
    smoke: e.startsWith("烟幕"),
    ambush: e.startsWith("伏击"),
    shock: e.includes("冲击。"),
    blitz: e.startsWith("闪击"),
    born: s.seq,
    moved: false,
    attacked: false,
    pinUntil: 0,
    lockUntil: 0,
    mods: [],
    triggers: {},
    ready,
  };
}
export function addUnit(s, id, p, { row = "rear", ready = false, pos } = {}) {
  const a = row === "front" ? s.front : s.players[p].rear,
    cap = row === "front" ? 5 : 4;
  if (a.length >= cap || (row === "front" && a.some((u) => u.p !== p)))
    return null;
  const u = makeUnit(s, id, p, { ready });
  a.splice(pos ?? a.length, 0, u);
  return u;
}
function remove(s, u) {
  const a = s.front.includes(u) ? s.front : s.players[u.p].rear;
  const i = a.indexOf(u);
  if (i >= 0) a.splice(i, 1);
}
function back(s, u) {
  if (!u || u.hq) return;
  remove(s, u);
  const pl = s.players[u.p];
  if (pl.hand.length < 9) pl.hand.push(handCard(s, u.cardId));
  else log(s, `${def(u).name}回手溢出，移出本局。`);
}
function settle(s) {
  let deaths = allUnits(s).filter((u) => u.hp <= 0);
  let loop = 0;
  while (deaths.length && loop++ < 30) {
    deaths.sort(
      (a, b) => (a.p === s.active ? 0 : 1) - (b.p === s.active ? 0 : 1),
    );
    for (const u of deaths) remove(s, u);
    for (const u of deaths) {
      log(s, `${def(u).name}被击毁。`, "destroy", { uid: u.uid });
      if (["W-04", "W-11"].includes(u.cardId)) addUnit(s, "W-T1", u.p);
    }
    deaths = allUnits(s).filter((u) => u.hp <= 0);
  }
  checkWinner(s);
}
function hurt(s, u, n, battle = false) {
  if (!u) return 0;
  const damage = Math.max(0, n - (battle ? (u.armor ?? 0) : 0));
  if (u.hq) s.players[u.p].hp -= damage;
  else u.hp -= damage;
  if (damage)
    log(
      s,
      `${u.hq ? side(u.p) + "总部" : def(u).name}受到${damage}点伤害。`,
      "damage",
      { uid: u.uid, amount: damage },
    );
  if (
    battle &&
    damage &&
    u.hp > 0 &&
    u.cardId === "W-15" &&
    u.triggers.rage !== s.seq
  ) {
    u.attack++;
    u.triggers.rage = s.seq;
  }
  return damage;
}
function repair(s, u, n) {
  if (!u) return;
  if (u.hq) s.players[u.p].hp = Math.min(20, s.players[u.p].hp + n);
  else u.hp = Math.min(u.maxHp, u.hp + n);
}
function buff(u, a = 0, d = 0) {
  if (u) {
    u.attack += a;
    u.hp += d;
    u.maxHp += d;
  }
}
function mod(u, stat, amount, until) {
  if (u) u.mods.push({ stat, amount, until });
}
function pin(s, u) {
  if (u) u.pinUntil = s.seq + (u.p === s.active ? 0 : 1);
}
function lock(s, u) {
  if (u) u.lockUntil = s.seq;
}
export const locked = (s, u) => u?.lockUntil >= s.seq && u.lockUntil > 0;
export function attackValue(s, u, target = null, offense = false) {
  if (u.hq) return 0;
  let n =
    u.attack +
    u.mods
      .filter((m) => m.stat === "attack" && m.until >= s.seq)
      .reduce((a, m) => a + m.amount, 0);
  const id = u.cardId;
  if (u.p !== s.active) {
    if (id === "N-22") n += 2;
    if (id === "W-23") n++;
  }
  if (offense && target) {
    if (locked(s, target) && ["N-13", "N-21"].includes(id)) n++;
    if (["N-17", "W-21"].includes(id) && isAir(target)) n += 2;
    if (id === "N-23" && def(target).type === "坦克") n += 2;
    if (id === "W-12" && def(target).type === "步兵") n++;
    if (id === "W-22" && isAir(target)) n++;
    if (id === "W-25" && def(target).type === "步兵") n += 2;
  }
  return Math.max(0, n);
}
export function operationCost(s, u, moving = false) {
  if (moving && u.freeMoveUntil >= s.seq) return 0;
  let n =
    def(u).operation_cost +
    u.mods
      .filter((m) => m.stat === "op" && m.until >= s.seq)
      .reduce((a, m) => a + m.amount, 0);
  if (isAir(u) && units(s, 1 - u.p).some((x) => x.cardId === "W-24")) n++;
  const floor = u.mods.some((m) => m.stat === "opFloor1" && m.until >= s.seq)
    ? 1
    : 0;
  return Math.max(floor, n);
}
export function playCost(s, p, c) {
  const pl = s.players[p],
    d = def(c);
  return Math.max(
    d.type === "步兵" && pl.infDiscount ? 1 : 0,
    d.cost +
      (d.attack !== null ? pl.taxUnit : d.type === "指令" ? pl.taxOrder : 0) -
      (d.type === "步兵" && pl.infDiscount ? 1 : 0),
  );
}
export function canAct(s, u) {
  return (
    s.phase === "play" &&
    u.p === s.active &&
    u.hp > 0 &&
    u.pinUntil < s.seq &&
    (u.born < s.seq || u.ready || u.blitz || u.blitzUntil >= s.seq)
  );
}
export function canMove(s, u) {
  return (
    canAct(s, u) &&
    ["步兵", "坦克"].includes(def(u).type) &&
    !u.moved &&
    !u.attacked &&
    s.players[u.p].rear.includes(u) &&
    s.front.length < 5 &&
    !s.front.some((x) => x.p !== u.p) &&
    s.players[u.p].k >= operationCost(s, u, true)
  );
}
function neighbors(s, u) {
  const a = s.front.includes(u) ? s.front : s.players[u.p].rear;
  const i = a.indexOf(u);
  return [a[i - 1], a[i + 1]].filter(Boolean);
}
export function attackTargets(s, u) {
  if (
    !canAct(s, u) ||
    u.attacked ||
    (u.moved && def(u).type !== "坦克") ||
    attackValue(s, u) <= 0 ||
    s.players[u.p].k < operationCost(s, u)
  )
    return [];
  const enemy = 1 - u.p,
    type = def(u).type;
  let choices = [...units(s, enemy), hq(s, enemy)];
  if (["步兵", "坦克"].includes(type)) {
    choices = choices.filter((t) => !isAir(t));
    if (!s.front.includes(u))
      choices = choices.filter((t) => s.front.includes(t));
  }
  if (type === "轰炸机") choices = choices.filter((t) => !isAir(t));
  if (["N-16", "W-19", "W-20"].includes(u.cardId))
    choices = choices.filter((t) => !t.hq && isGround(t));
  if (u.cardId === "N-18") choices = choices.filter((t) => !t.hq && isAir(t));
  choices = choices.filter((t) => !t.smoke);
  if (!["炮兵", "轰炸机"].includes(type))
    choices = choices.filter((t) => {
      // Guard units cannot be protected by another guard. Smoke still applies.
      if (t.guard) return true;
      const row = s.front.includes(t)
        ? s.front
        : [hq(s, enemy), ...s.players[enemy].rear];
      const i = row.findIndex((x) => x.uid === t.uid);
      return ![row[i - 1], row[i + 1]].some((x) => x?.guard);
    });
  if (type === "轰炸机")
    choices = choices.filter((t) => {
      const row = s.front.includes(t) ? s.front : s.players[enemy].rear;
      return !row.some((x) => def(x).type === "战斗机" && !x.smoke);
    });
  return choices;
}
function consumeCounter(s, p, c) {
  s.players[p].hand.splice(s.players[p].hand.indexOf(c), 1);
  log(s, `${side(p)}反制触发：${def(c).name}`, "counter");
}
function react(s, p, event) {
  for (const c of [...s.players[p].hand]
    .filter((c) => c.armed)
    .sort((a, b) => a.armedSeq - b.armedSeq)) {
    if (event.cancelled || s.winner !== null) break;
    const id = c.cardId,
      u = event.unit,
      t = event.target;
    let trigger = false;
    if (id === "N-37")
      trigger =
        event.kind === "deploy" &&
        def(u).cost >= 5 &&
        def(u).effect.includes("部署：");
    if (id === "N-38")
      trigger = event.kind === "attack" && t && !t.hq && t.p === p;
    if (id === "N-39") trigger = event.kind === "attack" && isAir(u);
    if (id === "N-40")
      trigger =
        event.kind === "order" &&
        event.targets.some((t) => t && !t.hq && t.p === p);
    if (id === "W-37") trigger = event.kind === "move" && isGround(u);
    if (id === "W-38") trigger = event.kind === "order" && event.card.cost >= 4;
    if (id === "W-39") trigger = event.kind === "deploy" && isAir(u);
    if (id === "W-40") trigger = event.kind === "intel";
    if (!trigger) continue;
    consumeCounter(s, p, c);
    if (id === "N-37") {
      event.cancelled = true;
      draw(s, p);
    }
    if (id === "N-38") {
      back(s, t);
      event.cancelled = true;
    }
    if (id === "N-39" || id === "W-39") {
      hurt(s, u, 3);
      settle(s);
      if (!find(s, u.uid)) event.cancelled = true;
    }
    if (id === "N-40" || id === "W-38") event.cancelled = true;
    if (id === "W-37") u.pinUntil = s.seq;
    if (id === "W-40") {
      event.cancelled = true;
      draw(s, p, 2);
    }
  }
}
function intel(s, p, n) {
  const e = { kind: "intel", cancelled: false };
  react(s, 1 - p, e);
  if (e.cancelled) return;
  const hand = shuffle(
    s,
    s.players[1 - p].hand.filter((c) => !c.revealed),
  );
  for (const c of hand.slice(0, n)) c.revealed = true;
  log(s, `${side(p)}获得情报${Math.min(n, hand.length)}。`);
}
export function move(s, uid, pos) {
  const u = find(s, uid);
  if (!u || !canMove(s, u)) return false;
  s.players[u.p].k -= operationCost(s, u, true);
  u.freeMoveUntil = 0;
  u.smoke = false;
  u.moved = true;
  remove(s, u);
  s.front.splice(pos ?? s.front.length, 0, u);
  log(s, `${def(u).name}进入前线。`, "move", { uid });
  if (def(u).type === "坦克") {
    if (u.cardId === "N-09") s.players[u.p].infDiscount = true;
    for (const x of units(s, u.p)) {
      if (x.triggers.tankMove === s.seq) continue;
      if (x.cardId === "N-05") {
        repair(s, x, 2);
        x.triggers.tankMove = s.seq;
      }
      if (x.cardId === "W-08") {
        buff(x, 1);
        x.triggers.tankMove = s.seq;
      }
    }
  }
  react(s, 1 - u.p, { kind: "move", unit: u });
  s.stats.actions++;
  return true;
}
export function attack(s, uid, targetId) {
  const u = find(s, uid),
    t = find(s, targetId);
  if (!u || !t || !attackTargets(s, u).some((x) => x.uid === targetId))
    return false;
  s.players[u.p].k -= operationCost(s, u);
  s.stats.actions++;
  u.attacked = true;
  u.smoke = false;
  const e = { kind: "attack", unit: u, target: t, cancelled: false };
  react(s, 1 - u.p, e);
  if (e.cancelled) return true;
  if (isAir(u) && !t.hq) {
    for (const x of units(s, t.p)) {
      if (
        x.cardId === "N-18" &&
        x.uid !== t.uid &&
        x.triggers.patriot !== s.seq
      ) {
        x.triggers.patriot = s.seq;
        hurt(s, u, 1);
      }
    }
    settle(s);
    if (!find(s, uid)) return true;
  }
  const adjacent = t.hq ? [] : neighbors(s, t);
  const splash = u.cardId === "W-20" || (u.cardId === "N-16" && locked(s, t));
  const a = attackValue(s, u, t, true),
    b = t.hq ? 0 : attackValue(s, t);
  const noReturn =
    t.hq ||
    def(u).type === "炮兵" ||
    def(t).type === "轰炸机" ||
    (isAir(u) && isGround(t)) ||
    u.shock;
  const ignores = u.ignoreUntil >= s.seq && u.ignoreTarget === t.uid;
  log(
    s,
    `${def(u).name}攻击${t.hq ? side(t.p) + "总部" : def(t).name}。`,
    "attack",
    { from: uid, to: targetId },
  );
  if (t.ambush && !noReturn) {
    t.ambush = false;
    hurt(s, u, b, true);
    if (u.hp > 0) hurt(s, t, Math.max(0, a - (ignores ? 0 : (t.armor ?? 0))));
  } else {
    hurt(s, t, Math.max(0, a - (ignores ? 0 : (t.armor ?? 0))));
    if (!noReturn) hurt(s, u, b, true);
  }
  // Primary attack uses manual armor above; apply surviving T-64 battle trigger once.
  if (
    !t.hq &&
    t.cardId === "W-15" &&
    t.hp > 0 &&
    a > (ignores ? 0 : t.armor) &&
    t.triggers.rage !== s.seq
  ) {
    t.attack++;
    t.triggers.rage = s.seq;
  }
  u.shock = false;
  if (splash) for (const v of adjacent) hurt(s, v, 1);
  settle(s);
  return true;
}
const pool = (s, p, filter) =>
  units(s, p)
    .filter(filter ?? (() => true))
    .map((u) => u.uid);
export function targetGroups(s, p, c, chosen = []) {
  c = def(c);
  const id = c.id,
    unit = c.attack !== null,
    friend = pool(s, p),
    enemy = pool(s, 1 - p),
    ground = pool(s, 1 - p, isGround),
    air = pool(s, 1 - p, isAir),
    inf = pool(s, 1 - p, (u) => def(u).type === "步兵");
  const groups = [];
  const one = (label, options, optional = false) =>
    groups.push({
      label,
      options,
      min: unit || optional ? (options.length && !optional ? 1 : 0) : 1,
      max: 1,
    });
  const many = (label, options, max = 2) =>
    groups.push({ label, options, min: 0, max });
  if (["N-03", "W-07", "W-09"].includes(id))
    one(
      "选择友方" + (id === "W-09" ? "单位修复" : "步兵"),
      pool(s, p, (u) => id === "W-09" || def(u).type === "步兵"),
    );
  if (["N-04", "N-19", "N-31", "N-32", "W-33"].includes(id))
    one("选择敌方地面单位", ground);
  if (["N-08", "N-35", "N-36"].includes(id)) one("选择敌方单位", enemy);
  if (id === "N-20") one("选择敌方飞机", air);
  if (id === "N-24")
    one(
      "选择已锁定的敌方地面单位",
      pool(s, 1 - p, (u) => isGround(u) && locked(s, u)),
    );
  if (id === "N-27") one("选择友方单位", friend);
  if (id === "N-29") {
    one("选择友方地面单位", pool(s, p, isGround));
    one("选择友方飞机", pool(s, p, isAir));
  }
  if (id === "N-33") many("选择至多两支敌军进行锁定", enemy);
  if (id === "N-34") {
    one("选择敌方锁定目标", enemy);
    one("选择友方攻击单位", friend);
  }
  if (id === "W-05")
    one(
      "选择敌方前线单位",
      s.front.filter((u) => u.p !== p && isGround(u)).map((u) => u.uid),
    );
  if (["W-06", "W-26"].includes(id))
    one(
      "选择敌方炮兵",
      pool(
        s,
        1 - p,
        (u) =>
          def(u).type === "炮兵" &&
          (id === "W-06" || s.players[1 - p].rear.includes(u)),
      ),
    );
  if (id === "W-10") one("选择敌方步兵", inf);
  if (id === "W-29")
    one(
      "选择手牌中的4费以下坦克",
      s.players[p].hand
        .filter((h) => def(h).type === "坦克" && def(h).cost <= 4)
        .map((h) => h.uid),
    );
  if (id === "W-30") {
    one("选择敌方步兵", inf);
    const first = find(s, chosen[0]?.[0]);
    const ns = first ? neighbors(s, first).map((u) => u.uid) : [];
    groups.push({
      label: "选择其相邻单位进行压制",
      options: ns,
      min: ns.length ? 1 : 0,
      max: 1,
    });
  }
  if (id === "W-31") many("选择至多两支友军撤回", friend);
  if (id === "W-32")
    many(
      "选择至多两支友方步兵",
      pool(s, p, (u) => def(u).type === "步兵"),
    );
  if (id === "W-36")
    one(
      "选择费用≤3且攻击≤3的敌方步兵",
      pool(
        s,
        1 - p,
        (u) =>
          def(u).type === "步兵" && def(u).cost <= 3 && attackValue(s, u) <= 3,
      ),
    );
  return groups;
}
export function canPlay(s, p, h) {
  if (
    s.phase !== "play" ||
    p !== s.active ||
    h.armed ||
    playCost(s, p, h) > s.players[p].k
  )
    return false;
  const c = def(h);
  if (c.attack !== null && s.players[p].rear.length >= 4) return false;
  if (c.type === "反制" && s.players[p].hand.filter((x) => x.armed).length >= 2)
    return false;
  if (
    ["N-26", "N-30", "W-27", "W-36"].includes(c.id) &&
    s.players[p].rear.length >= 4
  )
    return false;
  if (
    c.id === "W-29" &&
    s.players[p].rear.length >= 4 &&
    (s.front.length >= 5 || s.front.some((u) => u.p !== p))
  )
    return false;
  return targetGroups(s, p, h).every((g) => g.options.length >= g.min);
}
function targetsValid(s, p, h, choices) {
  const gs = targetGroups(s, p, h, choices);
  return (
    gs.every((g, i) => {
      const a = choices[i] ?? [];
      return (
        a.length >= g.min &&
        a.length <= g.max &&
        new Set(a).size === a.length &&
        a.every((id) => g.options.includes(id))
      );
    }) && choices.length <= gs.length
  );
}
export function play(s, handId, choices = [], pos) {
  const p = s.active,
    pl = s.players[p],
    h = pl.hand.find((c) => c.uid === handId);
  if (!h || !canPlay(s, p, h) || !targetsValid(s, p, h, choices)) return false;
  const c = def(h),
    paid = playCost(s, p, h);
  pl.k -= paid;
  s.stats.actions++;
  if (c.type === "反制") {
    h.armed = true;
    h.paid = paid;
    h.armedSeq = s.stats.actions;
    log(s, `${side(p)}布置一项战术反制。`);
    return true;
  }
  pl.hand.splice(pl.hand.indexOf(h), 1);
  if (c.type === "步兵") pl.infDiscount = false;
  if (c.attack !== null) pl.taxUnit = 0;
  else if (c.type === "指令") pl.taxOrder = 0;
  const ts = choices.map((g) =>
    g.map((id) => find(s, id) ?? pl.hand.find((x) => x.uid === id)),
  );
  log(s, `${side(p)}${c.attack !== null ? "部署" : "使用"}：${c.name}`, "play");
  let u;
  const event = {
    kind: c.attack !== null ? "deploy" : "order",
    card: c,
    targets: ts.flat(),
    cancelled: false,
  };
  if (c.attack !== null) {
    u = addUnit(s, c.id, p, { pos });
    event.unit = u;
  }
  react(s, 1 - p, event);
  if (!event.cancelled && s.winner === null) resolve(s, p, c, u, ts);
  settle(s);
  return true;
}
export function disarm(s, uid) {
  const h = s.players[s.active].hand.find((x) => x.uid === uid);
  if (s.phase !== "play" || !h?.armed) return false;
  h.armed = false;
  s.players[s.active].k += h.paid;
  return true;
}
function resolve(s, p, c, u, ts) {
  const a = ts[0]?.[0],
    b = ts[1]?.[0],
    pl = s.players[p],
    enemy = s.players[1 - p];
  const id = c.id;
  switch (id) {
    case "N-03":
      mod(a, "attack", 1, s.seq);
      break;
    case "N-04":
    case "N-19":
      lock(s, a);
      break;
    case "N-06":
      if (controls(s, p)) draw(s, p);
      break;
    case "N-07":
      if (controls(s, 1 - p)) buff(u, 1);
      break;
    case "N-08":
      intel(s, p, 1);
      lock(s, a);
      break;
    case "N-10":
      if (units(s, p).some((x) => x !== u && def(x).type === "步兵"))
        buff(u, 0, 1);
      break;
    case "N-20":
    case "N-24":
      hurt(s, a, 3);
      break;
    case "N-25":
      draw(s, p, 2);
      break;
    case "N-26":
      for (let i = 0; i < 2; i++) {
        const t = addUnit(s, "N-T1", p);
        if (t && controls(s, p)) t.blitz = true;
      }
      break;
    case "N-27":
      buff(a, 1, 2);
      draw(s, p);
      break;
    case "N-28":
      pl.maxK = Math.min(24, pl.maxK + 1);
      pl.drawNext++;
      break;
    case "N-29":
      for (const t of [a, b]) {
        buff(t, 1, 1);
        mod(t, "op", -1, s.seq);
      }
      break;
    case "N-30":
      for (let i = 0; i < 2; i++) addUnit(s, "N-T2", p);
      repair(s, hq(s, p), 3);
      break;
    case "N-31":
      hurt(s, a, locked(s, a) ? 6 : 4);
      break;
    case "N-32":
      hurt(s, a, 5);
      enemy.nextTaxOrder = 1;
      break;
    case "N-33":
      intel(s, p, 2);
      for (const t of ts[0] ?? []) lock(s, t);
      draw(s, p);
      break;
    case "N-34":
      lock(s, a);
      b.ignoreTarget = a.uid;
      b.ignoreUntil = s.seq;
      draw(s, p);
      break;
    case "N-35":
      mod(a, "attack", -3, s.seq + 1);
      draw(s, p);
      break;
    case "N-36":
      hurt(s, a, 3);
      pl.maxK = Math.min(24, pl.maxK + 1);
      break;
    case "W-05":
      hurt(s, a, 2);
      break;
    case "W-06":
    case "W-10":
    case "W-26":
      pin(s, a);
      break;
    case "W-07":
      buff(a, 1);
      break;
    case "W-09":
      repair(s, a, 2);
      break;
    case "W-17":
      for (const t of neighbors(s, u))
        if (def(t).type === "坦克") buff(t, 0, 1);
      break;
    case "W-27":
      for (let i = 0; i < 2; i++) addUnit(s, "W-T1", p);
      break;
    case "W-28":
      for (const t of units(s, p).filter(isGround)) {
        mod(t, "attack", 1, s.seq);
        if (def(t).type === "坦克") {
          mod(t, "op", -1, s.seq);
          mod(t, "opFloor1", 0, s.seq);
        }
      }
      break;
    case "W-29": {
      const i = pl.hand.indexOf(a);
      if (i >= 0) {
        pl.hand.splice(i, 1);
        const t = addUnit(s, a.cardId, p, {
          row:
            !s.front.some((x) => x.p !== p) && s.front.length < 5
              ? "front"
              : "rear",
        });
        t.pinUntil = s.seq;
      }
      break;
    }
    case "W-30":
      hurt(s, a, 4);
      pin(s, b);
      break;
    case "W-31":
      for (const t of ts[0] ?? []) back(s, t);
      draw(s, p);
      break;
    case "W-32":
      for (const t of ts[0] ?? []) {
        t.blitzUntil = s.seq;
        t.freeMoveUntil = s.seq;
      }
      break;
    case "W-33": {
      const ns = neighbors(s, a);
      hurt(s, a, 5);
      for (const t of ns) hurt(s, t, 1);
      break;
    }
    case "W-34":
      hurt(s, hq(s, 1 - p), 3);
      enemy.nextTaxUnit = 2;
      break;
    case "W-35":
      intel(s, p, 1);
      draw(s, p, controls(s, p) ? 2 : 1);
      break;
    case "W-36":
      remove(s, a);
      a.p = p;
      a.mods = [];
      a.pinUntil = s.seq;
      a.lockUntil = 0;
      a.blitzUntil = 0;
      a.freeMoveUntil = 0;
      a.ignoreUntil = 0;
      a.ignoreTarget = null;
      pl.rear.push(a);
      break;
  }
}
export function assertState(s) {
  if (s.players.length !== 2) throw Error("players");
  if (s.front.length > 5 || new Set(s.front.map((u) => u.p)).size > 1)
    throw Error("frontline invariant");
  const ids = [];
  for (const [p, pl] of s.players.entries()) {
    if (pl.rear.length > 4 || pl.hand.length > 9 || pl.k < 0 || pl.maxK > 24)
      throw Error("capacity/resources");
    for (const u of units(s, p)) {
      if (u.p !== p || u.hp <= 0 || u.hp > u.maxHp)
        throw Error("unit invariant");
      ids.push(u.uid);
    }
    for (const h of pl.hand) ids.push(h.uid);
  }
  if (new Set(ids).size !== ids.length) throw Error("duplicate ids");
  return true;
}
