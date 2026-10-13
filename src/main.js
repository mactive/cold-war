import {
  installContent,
  fetchContent,
  builtInContent,
  contentSnapshot,
  factions,
} from "./content/runtime.js";
import "./style.css";
import * as E from "./game/engine.js";
import { chooseAction, performAction, autoChoices } from "./game/ai.js";
import { artStyle, symbols, emblem, factionName } from "./ui/art.js";
import { createScene } from "./ui/scene.js";
import { createCombatVisuals } from "./ui/combat-visuals.js";
import { createMultiplayerClient } from "./ui/multiplayer-client.js";
import { orientAction, applyCommand, summary } from "./game/multiplayer.js";
import { installAttackDrag } from "./ui/attack-drag.js";
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal-root");
createScene(document.querySelector("#webgl"));
const combat = createCombatVisuals();
let combatBusy = false;
let loadingContent = false;
let netPending = false,
  network = null,
  networkStatus = "已同步";
const invitedRoom = new URL(location.href).searchParams.get("room");
const net = createMultiplayerClient({
  onUpdate: receiveRoom,
  onConnection: (status) => {
    networkStatus = status;
    const el = document.querySelector("#network-status");
    if (el) el.textContent = status;
  },
  onUnauthorized: () => {
    network = null;
    netPending = false;
    showLobby("身份已失效，请重新建立身份");
  },
});
let latestContent = builtInContent();
let state,
  selection = null,
  inspect = null,
  pending = null,
  modalType = null,
  faction = "N",
  thinking = false,
  watch = false,
  aiTimer = null,
  message = "选择一张手牌，向前线下达你的第一道命令。",
  muted = true,
  audioContext = null;
let deckFaction = "N",
  filter = "",
  typeFilter = "all",
  deckDraft = [],
  simulationWorker;
const saveKey = "iron-front-save-v1",
  deckKey = "iron-front-decks-v1";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safeRead = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
};
let savedDecks = safeRead(deckKey, {});
const chosenDeck = (f) =>
  !E.validateDeck(savedDecks[f] ?? [], f) ? savedDecks[f] : E.defaultDeck(f);
async function fresh() {
  net.leave();
  network = null;
  clearTimeout(aiTimer);
  watch = false;
  loadingContent = true;
  latestContent = await fetchContent();
  installContent(latestContent);
  loadingContent = false;
  clearTimeout(aiTimer);
  thinking = false;
  watch = false;
  state = E.createGame({
    faction,
    decks: [chosenDeck(faction), E.defaultDeck(faction === "N" ? "W" : "N")],
  });
  selection = pending = null;
  inspect = E.catalog[state.players[0].hand[0].cardId];
  showMulligan();
  render();
}
function save() {
  if (network) return;
  try {
    localStorage.setItem(saveKey, JSON.stringify(state));
  } catch {}
}
function sound(kind = "click") {
  if (muted) return;
  try {
    audioContext ??= new AudioContext();
    const o = audioContext.createOscillator(),
      g = audioContext.createGain();
    o.connect(g);
    g.connect(audioContext.destination);
    o.type = kind === "attack" ? "sawtooth" : "sine";
    o.frequency.setValueAtTime(
      kind === "attack" ? 120 : kind === "impact" ? 65 : 360,
      audioContext.currentTime,
    );
    if (kind !== "click")
      o.frequency.exponentialRampToValueAtTime(
        25,
        audioContext.currentTime + 0.22,
      );
    g.gain.setValueAtTime(
      kind === "impact" ? 0.1 : 0.035,
      audioContext.currentTime,
    );
    g.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + (kind === "impact" ? 0.3 : 0.12),
    );
    o.start();
    o.stop(audioContext.currentTime + (kind === "impact" ? 0.31 : 0.13));
  } catch {}
}
function card(
  c,
  {
    unit,
    hand,
    large = false,
    click = "",
    valid = false,
    selected = false,
  } = {},
) {
  const isUnit = c.attack !== null;
  let atk = unit ? E.attackValue(state, unit) : c.attack,
    defense = unit ? unit.hp : c.defense;
  const price = hand && state ? E.playCost(state, 0, hand) : c.cost;
  const tags = unit
    ? [
        unit.guard ? "守护" : "",
        unit.armor ? "重甲" + unit.armor : "",
        unit.smoke ? "烟幕" : "",
        unit.pinUntil >= state.seq ? "压制" : "",
        E.locked(state, unit) ? "锁定" : "",
        unit.blitz ? "闪击" : "",
      ].filter(Boolean)
    : [];
  return `<button class="card ${large ? "large" : ""} ${unit ? "on-board" : ""} ${valid ? "valid" : ""} ${selected ? "selected" : ""} ${hand?.armed ? "armed" : ""} ${unit && !E.canAct(state, unit) && unit.p === 0 ? "exhausted" : ""}" ${click ? `data-${click}` : ""} ${unit ? `data-uid="${unit.uid}"` : ""} title="${esc(c.name)} · ${esc(c.effect)}" aria-label="${esc(c.name)}${hand ? "，部署费" + price : ""}">
 <div class="card-heading"><span class="cost">${price}<small>K${isUnit ? `<i>${unit ? E.operationCost(state, unit) : c.operation_cost}</i>` : ""}</small></span><strong>${esc(c.name)}</strong><span class="faction-mark">${c.id[0] === "N" ? "✦" : "★"}</span></div>
 <div class="card-art" style="${artStyle(c)}">${unit?.smoke ? '<div class="smoke-film"></div>' : ""}${hand?.armed ? '<span class="armed-ribbon">反制已激活</span>' : ""}</div>
 ${isUnit ? `<div class="card-stats"><b>${atk}</b><span>${symbols[c.type]}</span><b class="${unit && unit.hp < unit.maxHp ? "wounded" : ""}">${defense}</b></div>` : `<div class="order-mark">${symbols[c.type]}</div>`}
 ${!unit || large ? `<p class="card-effect">${esc(c.effect)}</p><div class="card-footer">${esc(c.type)} <span>${c.rarity ?? "衍生"}</span></div>` : ""}
 ${tags.length ? `<div class="unit-tags">${tags.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
 ${unit && E.canAct(state, unit) && !unit.attacked ? '<span class="ready-light"></span>' : ""}</button>`;
}
function validIds() {
  if (pending) {
    const g = E.targetGroups(state, 0, pending.hand, pending.choices)[
      pending.step
    ];
    return new Set(g?.options ?? []);
  }
  if (selection?.kind === "unit") {
    const u = E.find(state, selection.uid);
    return new Set(u ? E.attackTargets(state, u).map((t) => t.uid) : []);
  }
  return new Set();
}
function leader(p) {
  const pl = state.players[p],
    valid = validIds().has("hq" + p);
  return `<button class="leader ${p ? "enemy" : "friendly"} ${valid ? "targetable" : ""}" data-target="hq${p}" data-uid="hq${p}" aria-label="${p ? "敌方" : "我方"}总部，防御${pl.hp}">${emblem(pl.faction)}<span><small>${p ? "OPPOSING COMMAND" : "FIELD HEADQUARTERS"}</small><strong>${p ? "对手 · " : "我方 · "}${esc(factionName(pl.faction))}</strong><em>${p ? "指挥容量 " + pl.maxK + " · 牌库 " + pl.deck.length : "联合行动指挥部 · 牌库 " + pl.deck.length}</em></span><b>${pl.hp}<i>HQ</i></b></button>`;
}
function render() {
  if (!state) return;
  const pl = state.players[0],
    op = state.players[1],
    valid = validIds(),
    u = selection?.kind === "unit" ? E.find(state, selection.uid) : null;
  const h =
    selection?.kind === "hand"
      ? pl.hand.find((c) => c.uid === selection.uid)
      : null;
  const c = inspect ?? E.catalog["N-12"];
  const rearSlots = Array.from({ length: 4 }, (_, i) => {
    const x = pl.rear[i];
    return x
      ? card(E.def(x), {
          unit: x,
          click: `target="${x.uid}"`,
          valid: valid.has(x.uid),
          selected:
            selection?.uid === x.uid || pending?.choices.flat().includes(x.uid),
        })
      : `<button class="slot ${h && E.def(h).attack !== null && E.canPlay(state, 0, h) && !pending ? "available" : ""}" data-deploy="${i}" aria-label="支援阵线空位${i + 1}"><span>＋</span><small>部署单位</small></button>`;
  }).join("");
  const enemySlots = Array.from({ length: 4 }, (_, i) => {
    const x = op.rear[i];
    return x
      ? card(E.def(x), {
          unit: x,
          click: `target="${x.uid}"`,
          valid: valid.has(x.uid),
          selected: pending?.choices.flat().includes(x.uid),
        })
      : '<div class="slot empty"><span>⌖</span></div>';
  }).join("");
  const frontSlots = Array.from({ length: 5 }, (_, i) => {
    const x = state.front[i];
    return x
      ? card(E.def(x), {
          unit: x,
          click: `target="${x.uid}"`,
          valid: valid.has(x.uid),
          selected:
            selection?.uid === x.uid || pending?.choices.flat().includes(x.uid),
        })
      : `<button class="slot front-slot ${u && E.canMove(state, u) ? "available" : ""}" data-move="${i}" aria-label="移动到前线${i + 1}"><span>⌖</span><small>${u && E.canMove(state, u) ? "向前推进" : "争夺区域"}</small></button>`;
  }).join("");
  app.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-icon">✦</span><div><h1>铁幕前线 <i>IRON FRONT</i></h1><p>越南战区 <span>／</span> 冷战联合演习</p></div></div><div class="session"><i class="online-dot"></i> ${network ? `房间 ${network.id.slice(0, 6)} · <em id="network-status">${esc(networkStatus)}</em>` : "本地作战"} <span>第 ${Math.max(pl.turns, op.turns)} 回合</span></div><nav><button data-action="collection">军械库 <small>80</small></button><button data-action="logs">战报</button><button data-action="help" aria-label="作战手册">?</button><button data-action="sound" aria-label="切换音效">${muted ? "♩" : "♫"}</button><button data-action="menu" aria-label="设置">⚙</button></nav></header>
 <main class="battle-layout"><section class="battlefield"><div class="opponent-strip">${leader(1)}<div class="enemy-hand" aria-label="敌方${op.hand.length}张手牌">${op.hand.map((x) => (x.revealed ? `<button class="revealed-mini" data-intel="${x.cardId}" title="已侦察：${esc(E.def(x).name)}">${E.def(x).cost}<small>${esc(E.def(x).name)}</small></button>` : `<span class="card-back ${op.faction === "N" ? "west-back" : "east-back"}"><i>${op.faction === "N" ? "✦" : "★"}</i></span>`)).join("")}<small>${op.hand.length} 张手牌</small></div></div>
 <div class="combat-rows"><div class="battle-row enemy-row"><div class="row-label"><small>ENEMY SUPPORT</small><strong>敌方支援区</strong><span>${op.rear.length} / 4</span></div><div class="slots">${enemySlots}</div></div>
 <div class="battle-row frontline"><div class="row-label"><small>CONTACT LINE</small><strong>前　线</strong><span class="control-${state.front[0]?.p ?? "none"}">${state.front.length ? (state.front[0].p === 0 ? "我方控制" : "敌方控制") : "尚未控制"}</span></div><div class="slots">${frontSlots}</div></div>
 <div class="battle-row own-row"><div class="row-label"><small>FRIENDLY SUPPORT</small><strong>我方支援区</strong><span>${pl.rear.length} / 4</span></div><div class="slots">${rearSlots}</div></div></div>
 <div class="status-strip"><span class="status-light ${state.active === 1 ? "red" : ""}"></span><b>${state.winner !== null ? "战斗结束" : thinking ? "敌方正在部署…" : pending ? "选择技能目标" : state.active === 0 ? "等待你的指令" : "对方回合"}</b><p>${esc(message)}</p>${selection || pending ? '<button data-action="cancel">取消 ×</button>' : ""}</div>
 <div class="player-strip">${leader(0)}<div class="hand-area"><div class="hand-caption">战术手牌 <span>${pl.hand.length} / 9</span></div><div class="hand" style="--count:${pl.hand.length}">${pl.hand.map((x, i) => `<div class="hand-wrap" style="--i:${i};--angle:${(i - (pl.hand.length - 1) / 2) * 1.1}deg">${card(E.def(x), { hand: x, click: `hand="${x.uid}"`, valid: E.canPlay(state, 0, x) && state.active === 0 && !thinking, selected: selection?.uid === x.uid || pending?.hand.uid === x.uid })}</div>`).join("")}</div></div></div>
 </section><aside class="command-panel"><div class="panel-top"><span>战术档案</span><small>${esc(c.id)} / ${c.fictional ? "架空科技" : "冷战军备"}</small></div><div class="inspection">${card(c, { large: true })}<p class="history">${esc(c.historical_anchor ?? "战场衍生单位")}</p><span class="art-note">兵种概念插画 · 型号以卡牌名称为准</span></div>
 <div class="context-actions">${pending ? pendingControls() : h ? `<button class="secondary" data-action="use-card" ${!E.canPlay(state, 0, h) ? "disabled" : ""}>${E.def(h).type === "反制" ? "激活反制" : E.def(h).attack !== null ? "部署到支援区" : "使用指令"}</button>${h.armed ? '<button data-action="disarm">取消激活 · 退回费用</button>' : ""}` : u && u.p === 0 ? `<button class="secondary" data-action="move-selected" ${!E.canMove(state, u) ? "disabled" : ""}>推进前线 · ${E.operationCost(state, u, true)} K</button><small>按住拖向红框目标，松手开火</small>` : "<small>点击卡牌查看详情与可用行动</small>"}</div>
 <div class="resource-panel"><div><span>指挥点 <small>KREDITS</small></span><strong>${pl.k}<i> / ${pl.maxK}</i></strong></div><div class="pips">${Array.from({ length: Math.max(12, pl.maxK) }, (_, i) => `<i class="${i < pl.k ? "filled" : i >= pl.maxK ? "locked" : ""}"></i>`).join("")}</div><p>部署与移动、攻击共享指挥点</p><button class="end-turn" data-action="end" ${state.active !== 0 || thinking || state.phase !== "play" ? "disabled" : ""}>${state.active === 1 ? "对方回合" : "结束回合"} <span>➜</span></button></div>
 <div class="latest-log"><small>最新战报</small><p>${esc(state.logs.at(-1)?.text ?? "作战准备中")}</p></div><footer>${network ? `联机对战 · 云端 v${network.revision}` : "本地演习 · 自动保存"} <span>数据 ${state.content?.revision ? "v" + state.content.revision : "离线版"}</span></footer></aside></main>`;
  if (state.winner !== null && modalType !== "result") showResult();
}
function pendingControls() {
  const gs = E.targetGroups(state, 0, pending.hand, pending.choices),
    g = gs[pending.step];
  if (!g) return "";
  const count = (pending.choices[pending.step] ?? []).length;
  return `<strong>${esc(g.label)}</strong><small>已选 ${count} / ${g.max}</small><button class="secondary" data-action="confirm-target" ${count < g.min ? "disabled" : ""}>${pending.step === gs.length - 1 ? "确认执行" : "下一目标"} →</button>`;
}
function cancel() {
  selection = pending = null;
  message = "选择手牌部署，或选择场上单位移动／攻击。";
  render();
}
function after() {
  E.assertState(state);
  save();
  render();
  sound();
  if (!network && state.active === 1 && state.phase === "play") scheduleAI();
}
function commitPlay(h, choices = [], pos) {
  if (network) {
    networkAction({
      kind: "play",
      uid: h.uid,
      choices,
      ...(pos !== undefined ? { pos } : {}),
    });
    return;
  }
  const old = state.logs.length;
  if (E.play(state, h.uid, choices, pos)) {
    message = `${E.def(h).name}已执行。`;
    selection = pending = null;
    after();
  } else {
    message = "当前目标或费用不满足条件，请重新选择。";
    selection = pending = null;
    render();
  }
}
function prepare(h, pos) {
  if (!E.canPlay(state, 0, h)) {
    message = h.armed
      ? "反制已激活；可在右侧取消。"
      : "指挥点、空位或合法目标不足。";
    render();
    return;
  }
  const groups = E.targetGroups(state, 0, h);
  if (groups.length) {
    pending = { hand: h, choices: groups.map(() => []), step: 0, pos };
    selection = null;
    skipEmptyTargets();
  } else commitPlay(h, [], pos);
}
function skipEmptyTargets() {
  const gs = E.targetGroups(state, 0, pending.hand, pending.choices);
  while (pending.step < gs.length && gs[pending.step].options.length === 0)
    pending.step++;
  if (pending.step >= gs.length) {
    const { hand, choices, pos } = pending;
    commitPlay(hand, choices, pos);
  } else {
    message = gs[pending.step].label;
    render();
  }
}
function pickTarget(id) {
  if (pending) {
    const gs = E.targetGroups(state, 0, pending.hand, pending.choices),
      g = gs[pending.step];
    if (!g?.options.includes(id)) return;
    const a = pending.choices[pending.step] ?? [];
    if (a.includes(id)) a.splice(a.indexOf(id), 1);
    else {
      if (a.length >= g.max) a.shift();
      a.push(id);
    }
    pending.choices[pending.step] = a;
    render();
    if (g.max === 1 && a.length === 1) nextTarget();
    return;
  }
  const clicked = E.find(state, id);
  if (!clicked) return;
  if (selection?.kind === "unit") {
    const u = E.find(state, selection.uid);
    if (E.attackTargets(state, u).some((t) => t.uid === id)) {
      attackWithPresentation(u.uid, id);
      return;
    }
  }
  if (!clicked.hq) {
    inspect = E.def(clicked);
    selection = { kind: "unit", uid: id };
    message =
      clicked.p === 0
        ? "按住单位拖向红框敌军／总部，松手攻击；点击前线空位移动。"
        : "敌军档案已展开。";
    render();
  }
}
function unitCenter(id) {
  const r = document
    .querySelector(`[data-uid="${id}"]`)
    ?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
}
async function presentAttack(uid, id) {
  const unit = E.find(state, uid);
  if (
    combatBusy ||
    !unit ||
    !E.attackTargets(state, unit).some((t) => t.uid === id)
  )
    return false;
  const from = unitCenter(uid),
    to = unitCenter(id);
  combatBusy = true;
  document.body.classList.add("combat-busy");
  selection = null;
  message = "正在交火…";
  render();
  sound("attack");
  let success = false;
  const impact = () => {
    const previousLogs = new Set(state.logs);
    success = E.attack(state, uid, id);
    const damage = state.logs
      .filter(
        (entry) =>
          !previousLogs.has(entry) &&
          entry.kind === "damage" &&
          entry.uid === id,
      )
      .reduce((sum, entry) => sum + entry.amount, 0);
    save();
    render();
    if (success && to) {
      const hit = document.querySelector(`[data-uid="${id}"]`);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        hit?.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-5px)" },
            { transform: "translateX(4px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 240 },
        );
      if (damage) {
        const label = document.createElement("span");
        label.className = "combat-damage";
        label.textContent = `−${damage}`;
        label.style.left = `${to.x}px`;
        label.style.top = `${to.y}px`;
        document.body.append(label);
        setTimeout(() => label.remove(), 950);
      }
      sound("impact");
    }
  };
  try {
    if (from && to) await combat.shot(from, to, E.def(unit).type, impact);
    else impact();
  } finally {
    combatBusy = false;
    document.body.classList.remove("combat-busy");
  }
  return success;
}
async function attackWithPresentation(uid, id) {
  if (network) {
    await networkAttack(uid, id);
    return;
  }
  if (await presentAttack(uid, id)) {
    message = "交火完成。";
    after();
  }
}
installAttackDrag({
  app,
  visuals: combat,
  allowed: () =>
    state?.phase === "play" &&
    state.active === 0 &&
    !thinking &&
    !watch &&
    !pending &&
    !modalType &&
    !combatBusy &&
    !loadingContent &&
    !netPending,
  begin: (id) => {
    const u = E.find(state, id);
    if (!u || u.p !== 0 || !E.attackTargets(state, u).length) return false;
    selection = { kind: "unit", uid: id };
    inspect = E.def(u);
    message = "拖动箭头瞄准红框目标，松手开火；Esc取消。";
    render();
    return true;
  },
  targets: (id) => {
    const u = E.find(state, id);
    return u ? E.attackTargets(state, u).map((t) => t.uid) : [];
  },
  fire: attackWithPresentation,
  cancel: () => {
    selection = null;
    message = "已取消瞄准，未消耗指挥点。";
    render();
  },
});
function nextTarget() {
  if (!pending) return;
  const gs = E.targetGroups(state, 0, pending.hand, pending.choices),
    g = gs[pending.step];
  if ((pending.choices[pending.step] ?? []).length < g.min) return;
  pending.step++;
  skipEmptyTargets();
}
function scheduleAI() {
  if (network) return;
  clearTimeout(aiTimer);
  if (state.phase !== "play" || modalType === "briefing") return;
  if (state.active === 0 && !watch) {
    thinking = false;
    render();
    return;
  }
  thinking = state.active === 1;
  aiTimer = setTimeout(
    async () => {
      if (state.phase !== "play") return;
      const a = chooseAction(state);
      const prev = state.seq;
      const success =
        a.kind === "attack"
          ? await presentAttack(a.uid, a.target)
          : performAction(state, a);
      if (!success) {
        message = "AI停止：无法执行动作。";
        watch = false;
        thinking = false;
        render();
        return;
      }
      if (state.seq !== prev)
        message =
          state.active === 0 ? "轮到你了。指挥点已补满。" : "等待敌方行动。";
      thinking = state.active === 1;
      save();
      render();
      scheduleAI();
    },
    watch ? 300 : 650,
  );
}
function showModal(type, html) {
  modalType = type;
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal ${type}" role="dialog" aria-modal="true">${html}</section></div>`;
}
function closeModal() {
  modal.innerHTML = "";
  modalType = null;
}
function returnToBattle() {
  if (network && !["play", "finished"].includes(network.status)) {
    receiveRoom(network);
    return;
  }
  closeModal();
  if (state.phase === "mulligan") showMulligan();
  else if (state.phase === "finished") showResult();
  else render();
}
function showBriefing() {
  clearTimeout(aiTimer);
  showModal(
    "briefing",
    `<div class="brief-hero"><small>CLASSIFIED / JOINT OPERATIONS</small><h2>铁幕前线</h2><p class="english-title">IRON FRONT</p><div class="brief-line"></div><p>丛林深处，新的命令已抵达。<br>部署你的部队，夺取前线，击破敌方总部。</p><span>越南战区视觉场景 · 1948—1990 冷战卡池</span></div><div class="brief-options"><small>SELECT YOUR COMMAND</small><h3>选择你的阵营</h3><div class="faction-options">${["N", "W"].map((f) => `<button data-faction="${f}" class="${f === faction ? "chosen" : ""}">${emblem(f)}<b>${esc(factionName(f))}</b><span>${esc(factions.find((x) => x.id === f).tagline)}</span></button>`).join("")}</div><p>${esc(factions.find((x) => x.id === faction).description)}</p><p>39张牌库 ＋ 20防御总部<br>单人对抗本地AI · 自动保存进度 · 数据 ${latestContent.revision ? "v" + latestContent.revision : "离线版"}</p><button class="secondary multiplayer-entry" data-action="lobby">联机房间 · 邀请好友对战 ↗</button><button class="primary" data-action="new-game">开始部署 <span>➜</span></button>${safeRead(saveKey, null) ? '<button class="secondary" data-action="continue">继续上次对局</button>' : ""}<button class="text-button" data-action="help">首次作战？查看行动指南 →</button></div>`,
  );
}
let mulliganSet = new Set();
function showMulligan() {
  mulliganSet = new Set();
  renderMulligan();
}
function renderMulligan() {
  showModal(
    "mulligan",
    `<small>DEPLOYMENT BRIEFING</small><h2>整备你的起手牌</h2><p>点击需要替换的牌。通常保留1—3费单位，争取前线主动权。</p><div class="mulligan-cards">${state.players[0].hand.map((h) => `<div class="${mulliganSet.has(h.uid) ? "replace" : ""}">${card(E.def(h), { click: `mulligan="${h.uid}"` })}${mulliganSet.has(h.uid) ? "<span>替换</span>" : ""}</div>`).join("")}</div><button class="primary" data-action="start-battle" ${netPending ? "disabled" : ""}>${mulliganSet.size ? "替换" + mulliganSet.size + "张并进入战场" : "保留全部 · 进入战场"} →</button>`,
  );
}
function showResult() {
  if (network) {
    showModal(
      "result",
      `<small>SERVER VERIFIED / ROOM ${network.id}</small><h2>${state.winner === 0 ? "任务完成" : state.winner === "draw" ? "平局" : "本局失利"}</h2><p>本局获得 ${network.score[network.seat]} 分 · 服务端已保存对战记录</p><p>胜利 +3 / 平局 +1 / 失败 +0</p><button class="primary" data-action="room-back">返回联机大厅</button><button class="secondary" data-action="logs">查看战报</button>`,
    );
    return;
  }
  thinking = false;
  watch = false;
  clearTimeout(aiTimer);
  showModal(
    "result",
    `<small>AFTER ACTION REPORT</small><h2>${state.winner === "draw" ? "同归于尽" : state.winner === 0 ? "任务完成" : "总部失守"}</h2><p>${state.winner === 0 ? "敌方指挥体系已被击破。" : "每一次演习，都是下一场胜利的准备。"}</p><div class="result-stats"><div><strong>${Math.max(...state.players.map((p) => p.turns))}</strong>战斗回合</div><div><strong>${state.stats.actions}</strong>作战行动</div><div><strong>${state.players[0].hp}</strong>我方总部</div></div><button class="primary" data-action="menu">再次部署 →</button><button class="secondary" data-action="logs">查看战报</button>`,
  );
}
function showHelp() {
  showModal(
    "help",
    `<button class="modal-close" data-action="close">×</button><small>FIELD MANUAL / 01</small><h2>作战手册</h2><div class="help-grid"><article><b>01 · 部署</b><p>点击手牌，再点击我方支援区空位。需要目标的技能会高亮合法目标。支援区最多4个单位。</p></article><article><b>02 · 推进</b><p>选择步兵或坦克，点击前线空位。前线最多5个单位，不能进入敌方占据的前线。</p></article><article><b>03 · 交火</b><p>按住可行动单位，拖动弧形箭头到红色描边的敌军或总部，松手开火。拖到空白处或按Esc取消。也可点击单位后点击目标。部署与行动分别付费。</p></article><article><b>04 · 胜利</b><p>摧毁20防御的敌方总部。每回合指挥点增长并补满；牌库耗尽后抽牌会产生递增士气伤害。</p></article></div><dl><dt>步兵 / 坦克</dt><dd>步兵每回合移动或攻击一次；坦克可先移动再攻击。地面部队需占据前线才能攻击敌后排及总部。</dd><dt>炮兵 / 空军</dt><dd>留在后排远程攻击。炮兵攻击不受还击；轰炸机受敌方同排战斗机制空限制。部分炮兵限定对地或对空。</dd><dt>守护 / 重甲</dt><dd>守护保护同排左右紧邻的非守护目标；守护单位不能互相保护。炮兵、轰炸机可绕过。重甲只减免战斗伤害，不减免指令伤害。</dd><dt>烟幕 / 闪击</dt><dd>烟幕在主动行动前阻止被单位攻击，仍可被技能指定。闪击允许部署当回合行动，仍需付费。</dd><dt>锁定 / 压制</dt><dd>锁定持续到当前回合末，用于精确打击加成。压制阻止目标在其下个回合行动。</dd><dt>指令 / 反制</dt><dd>指令立即结算。反制预先付费激活，敌方满足条件时自动触发；最多同时激活2张，未触发则下回合失活。</dd></dl><p class="note">界面场景参考越南战场，装备和事件保留原CSV年代。心灵技术为架空。局部规则采用设计稿v0.1；插画为共享兵种概念图。</p><button class="primary" data-action="close">返回指挥台</button>`,
  );
}
function showLogs() {
  showModal(
    "logs",
    `<button class="modal-close" data-action="close">×</button><small>COMBAT LOG</small><h2>行动战报</h2><div class="log-list">${state.logs.map((l) => `<div class="log ${l.kind}"><small>${String(l.seq).padStart(2, "0")}</small><span>${esc(l.text)}</span></div>`).join("")}</div><button class="secondary" data-action="export">导出对局存档</button>`,
  );
}
function showCollection() {
  deckDraft = [...chosenDeck(deckFaction)];
  filter = "";
  typeFilter = "all";
  renderCollection();
}
function renderCollection() {
  const shown = E.cards.filter(
    (c) =>
      c.id[0] === deckFaction &&
      (typeFilter === "all" || c.type === typeFilter) &&
      (!filter || (c.name + c.effect).includes(filter)),
  );
  const counts = {};
  deckDraft.forEach((id) => (counts[id] = (counts[id] ?? 0) + 1));
  const err = E.validateDeck(deckDraft, deckFaction);
  showModal(
    "collection",
    `<button class="modal-close" data-action="close">×</button><div class="collection-header"><div><small>ARMORY / DECK BUILDER</small><h2>军械库 <em>80种卡牌</em></h2></div><div class="tabs">${["N", "W"].map((f) => `<button class="${f === deckFaction ? "active" : ""}" data-deck-faction="${f}">${esc(factionName(f))}</button>`).join("")}</div></div><div class="collection-tools"><input id="card-search" placeholder="搜索卡名或技能…" value="${esc(filter)}"><select id="type-filter">${["all", "步兵", "坦克", "炮兵", "战斗机", "轰炸机", "指令", "反制"].map((t) => `<option value="${t}" ${t === typeFilter ? "selected" : ""}>${t === "all" ? "全部类型" : t}</option>`).join("")}</select><span>牌库 <b>${deckDraft.length} / 39</b></span><button data-action="reset-deck">恢复入门牌组</button><button class="primary" data-action="save-deck" ${err ? "disabled" : ""}>保存牌组</button></div><p class="deck-hint">${err ?? "构筑合法。保存后将在下一场新对局使用。"} · 普通4 / 限定3 / 特殊2 / 精英1</p><div class="collection-grid">${shown.map((c) => `<article>${card(c, { click: `inspect-card="${c.id}"` })}<div class="deck-count"><button data-remove-card="${c.id}" ${!counts[c.id] ? "disabled" : ""}>−</button><b>${counts[c.id] ?? 0} / ${E.LIMITS[c.rarity]}</b><button data-add-card="${c.id}" ${deckDraft.length >= 39 || (counts[c.id] ?? 0) >= E.LIMITS[c.rarity] ? "disabled" : ""}>＋</button></div></article>`).join("")}</div>`,
  );
}
function showSettings() {
  if (network) return showNetworkMenu();
  showModal(
    "settings",
    `<button class="modal-close" data-action="close">×</button><small>OPERATIONS CONTROL</small><h2>演习控制台</h2><button class="primary" data-action="resume">返回当前对局</button><button class="secondary" data-action="watch">${watch ? "停止AI接管" : "AI接管 · 观战当前对局"}</button><button class="secondary" data-action="simulation">运行100局自动模拟</button><button class="secondary" data-action="export">导出对局存档</button><button class="secondary" data-action="briefing">重新选择阵营</button><p class="note">模拟在本地后台线程运行，不影响当前对局。测试结果不等同于玩家对战胜率。</p>`,
  );
}
function showSimulation() {
  showModal(
    "simulation",
    `<button class="modal-close" data-action="close">×</button><small>LOCAL SIMULATION</small><h2>自动对局测试</h2><p id="sim-status">正在初始化100局模拟…</p><div class="sim-meter"><i id="sim-progress"></i></div><div id="sim-result"></div>`,
  );
  simulationWorker?.terminate();
  simulationWorker = new Worker(
    new URL("./game/simulation-worker.js", import.meta.url),
    { type: "module" },
  );
  simulationWorker.onmessage = ({ data }) => {
    const status = document.querySelector("#sim-status");
    if (!status) return;
    status.textContent = `完成 ${data.completed} / 100 局 · ${data.errors.length} 个错误`;
    document.querySelector("#sim-progress").style.width = data.completed + "%";
    if (data.completed === 100)
      document.querySelector("#sim-result").innerHTML =
        `<div class="result-stats"><div><strong>${data.wins.N}</strong>北约胜局</div><div><strong>${data.wins.W}</strong>华约胜局</div><div><strong>${data.timeouts}</strong>超时</div></div><p>平均 ${data.averageTurns} 个双方交替回合；${data.draws}局平局。</p><p class="note">使用入门牌组与启发式AI，轮换先手阵营。用于发现规则异常和初步偏差，不代表实战平衡。</p>${data.errors.length ? `<pre>${esc(data.errors.join("\n"))}</pre>` : ""}`;
  };
  simulationWorker.postMessage({ games: 100, content: contentSnapshot() });
}
app.addEventListener("click", handleClick);
modal.addEventListener("click", handleClick);
function handleClick(e) {
  if (combatBusy || loadingContent || netPending) return;
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.roomResume) {
    lobbyDo(() => net.resume(b.dataset.roomResume));
    return;
  }
  if (b.dataset.faction) {
    faction = b.dataset.faction;
    showBriefing();
    return;
  }
  if (b.dataset.mulligan) {
    const id = b.dataset.mulligan;
    mulliganSet.has(id) ? mulliganSet.delete(id) : mulliganSet.add(id);
    renderMulligan();
    return;
  }
  if (b.dataset.deckFaction) {
    deckFaction = b.dataset.deckFaction;
    showCollection();
    return;
  }
  if (b.dataset.addCard) {
    deckDraft.push(b.dataset.addCard);
    renderCollection();
    return;
  }
  if (b.dataset.removeCard) {
    const i = deckDraft.indexOf(b.dataset.removeCard);
    if (i >= 0) deckDraft.splice(i, 1);
    renderCollection();
    return;
  }
  if (b.dataset.inspectCard) {
    inspect = E.catalog[b.dataset.inspectCard];
    const c = inspect;
    showModal(
      "card-detail",
      `<button class="modal-close" data-action="back-collection">×</button>${card(c, { large: true })}<p>${esc(c.historical_anchor)}</p><button class="secondary" data-action="back-collection">返回军械库</button>`,
    );
    return;
  }
  if (b.dataset.intel) {
    inspect = E.catalog[b.dataset.intel];
    render();
    return;
  }
  const action = b.dataset.action;
  if (action) {
    actions[action]?.();
    return;
  }
  if (state.phase !== "play" || thinking || state.active !== 0) {
    if (b.dataset.target) {
      const x = E.find(state, b.dataset.target);
      if (x && !x.hq) {
        inspect = E.def(x);
        render();
      }
    }
    return;
  }
  if (b.dataset.hand) {
    const h = state.players[0].hand.find((c) => c.uid === b.dataset.hand);
    inspect = E.def(h);
    if (pending) {
      pickTarget(h.uid);
      return;
    }
    selection = { kind: "hand", uid: h.uid };
    message =
      E.def(h).attack !== null
        ? "点击我方支援区空位部署；右侧显示卡牌详情。"
        : E.def(h).type === "反制"
          ? "点击右侧「激活反制」，在敌方回合自动触发。"
          : "点击右侧「使用指令」执行。";
    render();
    return;
  }
  if (b.dataset.target) {
    const own = E.find(state, b.dataset.target),
      h =
        selection?.kind === "hand"
          ? state.players[0].hand.find((x) => x.uid === selection.uid)
          : null;
    if (
      !pending &&
      h &&
      E.def(h).attack !== null &&
      own &&
      !own.hq &&
      state.players[0].rear.includes(own)
    ) {
      prepare(h, state.players[0].rear.indexOf(own));
      return;
    }
    pickTarget(b.dataset.target);
    return;
  }
  if (b.dataset.deploy !== undefined) {
    const h =
      selection?.kind === "hand"
        ? state.players[0].hand.find((x) => x.uid === selection.uid)
        : null;
    if (h && E.def(h).attack !== null) prepare(h, Number(b.dataset.deploy));
    return;
  }
  if (b.dataset.move !== undefined) {
    const u = selection?.kind === "unit" ? E.find(state, selection.uid) : null;
    if (u && network) {
      networkAction({ kind: "move", uid: u.uid, pos: Number(b.dataset.move) });
      return;
    }
    if (u && E.move(state, u.uid, Number(b.dataset.move))) {
      selection = null;
      message = "部队已进入前线。";
      after();
    }
    return;
  }
}
const actions = {
  lobby: () => showLobby(),
  "room-create": () => lobbyDo(() => net.create()),
  "room-join": () => {
    const value = document.querySelector("#room-code")?.value.trim();
    let id = value;
    try {
      id = new URL(value).searchParams.get("room") ?? value;
    } catch {}
    if (!/^[a-f0-9]{16}$/.test(id ?? ""))
      return showLobby("请输入有效的房间编号或邀请链接");
    lobbyDo(() => net.join(id));
  },
  "identity-create": () => {
    const name = document.querySelector("#player-name")?.value.trim();
    lobbyDo(async () => {
      await net.createIdentity(name);
      await showLobby();
    });
  },
  "identity-logout": () => {
    if (
      confirm(
        "注销会撤销此浏览器身份，所有进行中的对局按认输处理。积分不能恢复。确定注销？",
      )
    )
      lobbyDo(async () => {
        await net.logout();
        network = null;
        await showLobby();
      });
  },
  "room-copy": async () => {
    const input = document.querySelector("#invite-link");
    try {
      await navigator.clipboard.writeText(input.value);
      document.querySelector("#room-copy-status").textContent =
        "邀请链接已复制";
    } catch {
      input.select();
      document.querySelector("#room-copy-status").textContent =
        "请复制已选中的邀请链接";
    }
  },
  "room-close": () => lobbyDo(() => net.close()),
  "room-back": () => {
    net.leave();
    network = null;
    state = E.createGame({ faction });
    showLobby();
  },
  "room-return": () => {
    if (network) {
      closeModal();
      receiveRoom(network);
    } else showBriefing();
  },
  "room-resign": () => {
    if (confirm("确定认输？本局将由对方获胜。"))
      networkAction({ kind: "resign" });
  },
  "solo-back": () => {
    net.leave();
    network = null;
    state = E.createGame({ faction });
    showBriefing();
  },
  "new-game": () => {
    closeModal();
    fresh();
  },
  "start-battle": () => {
    if (network) {
      networkAction({ kind: "mulligan", replace: [...mulliganSet] });
      return;
    }
    E.startGame(state, [...mulliganSet]);
    closeModal();
    message = "轮到你了。部署你的第一支部队。";
    after();
  },
  end: () => {
    if (network) {
      networkAction({ kind: "end" });
      return;
    }
    selection = pending = null;
    E.endTurn(state);
    message = "敌方正在评估战场。";
    after();
  },
  cancel: cancel,
  "use-card": () => {
    const h = state.players[0].hand.find((x) => x.uid === selection?.uid);
    if (h) prepare(h);
  },
  "confirm-target": nextTarget,
  "move-selected": () => {
    if (network && selection) {
      networkAction({ kind: "move", uid: selection.uid });
      return;
    }
    if (selection && E.move(state, selection.uid)) {
      selection = null;
      message = "部队已进入前线。";
      after();
    }
  },
  disarm: () => {
    if (network && selection) {
      networkAction({ kind: "disarm", uid: selection.uid });
      return;
    }
    if (selection && E.disarm(state, selection.uid)) after();
  },
  collection: showCollection,
  logs: showLogs,
  help: showHelp,
  menu: showSettings,
  close: returnToBattle,
  resume: () => {
    closeModal();
    scheduleAI();
  },
  briefing: showBriefing,
  sound: () => {
    muted = !muted;
    sound();
    render();
  },
  continue: () => {
    const saved = safeRead(saveKey, null);
    if (saved?.version === 1) {
      try {
        E.assertState(saved);
        installContent(saved.content ?? builtInContent());
        state = saved;
        faction = state.players[0].faction;
        selection = pending = null;
        inspect = E.catalog[state.players[0].hand[0]?.cardId ?? "N-12"];
        closeModal();
        render();
        scheduleAI();
      } catch {
        message = "存档不兼容，请开启新对局。";
        fresh();
      }
    }
  },
  watch: () => {
    watch = !watch;
    closeModal();
    message = watch ? "AI正在接管双方行动。" : "已恢复手动指挥。";
    scheduleAI();
  },
  simulation: showSimulation,
  "reset-deck": () => {
    deckDraft = E.defaultDeck(deckFaction);
    renderCollection();
  },
  "back-collection": renderCollection,
  "save-deck": () => {
    if (!E.validateDeck(deckDraft, deckFaction)) {
      savedDecks[deckFaction] = [...deckDraft];
      localStorage.setItem(deckKey, JSON.stringify(savedDecks));
      message = "牌组已保存，将用于下一场对局。";
      closeModal();
      render();
    }
  },
  export: () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    a.download = "iron-front-save.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  },
};
modal.addEventListener("input", (e) => {
  if (e.target.id === "card-search") {
    const pos = e.target.selectionStart;
    filter = e.target.value;
    renderCollection();
    const input = document.querySelector("#card-search");
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});
modal.addEventListener("change", (e) => {
  if (e.target.id === "type-filter") {
    typeFilter = e.target.value;
    renderCollection();
  }
});
addEventListener("keydown", (e) => {
  if (
    combatBusy ||
    netPending ||
    loadingContent ||
    e.defaultPrevented ||
    (e.key !== "Escape" && document.querySelector(".drag-source"))
  ) {
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") {
    if (["lobby", "room-wait"].includes(modalType)) return;
    if (modalType) returnToBattle();
    else cancel();
  }
  if (
    e.key === " " &&
    !modalType &&
    !["INPUT", "SELECT"].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    if (state.active === 0 && state.phase === "play") actions.end();
  }
});
const roomStatus = {
  waiting: "等待对手",
  mulligan: "起手整备",
  play: "对战中",
  finished: "已结束",
  closed: "已关闭",
};
async function showLobby(error = "") {
  clearTimeout(aiTimer);
  thinking = false;
  watch = false;
  let rooms = [],
    profile = null;
  if (net.identity) {
    try {
      [rooms, profile] = await Promise.all([net.rooms(), net.me()]);
    } catch (e) {
      error = e.message;
    }
  }
  const me = net.identity;
  showModal(
    "lobby",
    `<small>MULTIPLAYER / FIELD COMMAND</small><h2>联机作战大厅</h2><p>创建房间，复制链接邀请好友。两名玩家随机分配互斥阵营与先手，使用开房时版本的标准牌组。</p>${error ? `<p class="network-error" role="alert">${esc(error)}</p>` : ""}${
      me
        ? `
    <div class="identity-strip"><div><b>${esc(me.name)}</b><small>身份 ${esc(me.id.slice(0, 8))} · 保存在此浏览器</small></div><span>${profile?.stats?.points ?? 0} 分 · ${profile?.stats?.wins ?? 0} 胜 / ${profile?.stats?.draws ?? 0} 平 / ${profile?.stats?.losses ?? 0} 负</span><button class="text-button" data-action="identity-logout">注销身份</button></div>
    <div class="room-create-row"><button class="primary" data-action="room-create">＋ 创建双人房间</button><input id="room-code" maxlength="250" placeholder="粘贴邀请链接或房间编号" value="${esc(invitedRoom ?? "")}"><button class="secondary" data-action="room-join">加入房间 →</button></div>
    <h3>我的房间</h3><div class="room-list">${rooms.length ? rooms.map((r) => `<button data-room-resume="${r.id}"><strong>${r.id}</strong><span>${roomStatus[r.status]}</span><small>${new Date(r.updated_at).toLocaleString("zh-CN")}</small><b>进入 →</b></button>`).join("") : "<p>尚无房间。创建一个，邀请另一位指挥官。</p>"}</div>`
        : `
    <div class="identity-create"><label for="player-name">指挥官昵称</label><input id="player-name" maxlength="24" autocomplete="nickname" placeholder="输入昵称"><button class="primary" data-action="identity-create">建立浏览器身份 →</button></div><p class="note">无需注册账号。身份凭证保存在本机 localStorage；清除浏览器数据或注销后无法恢复原身份。</p>`
    }
    <p class="note">胜利 +3 分，平局 +1 分，失败 +0 分。认输或注销按失败结算；未开战房间和过期关闭的房间不计分。24小时无有效操作自动过期。</p><button class="text-button" data-action="solo-back">← 返回单人模式</button>`,
  );
}
async function lobbyDo(fn) {
  if (netPending) return;
  netPending = true;
  modal.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    await showLobby(e.message);
  } finally {
    netPending = false;
    modal.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
function receiveRoom(room) {
  const previous = network;
  network = room;
  clearTimeout(aiTimer);
  thinking = false;
  watch = false;
  if (!room.state || room.status === "closed") {
    showModal(
      "room-wait",
      `<small>PRIVATE ROOM / ${room.id}</small><h2>${room.status === "closed" ? "房间已关闭" : "等待另一位指挥官"}</h2><p>${esc(room.players[room.seat]?.name)}，${room.status === "closed" ? "此房间不可继续，请返回大厅新建。" : "将邀请链接发送给朋友，对方加入后自动分配阵营。"}</p>${room.status !== "closed" ? inviteMarkup() : ""}<button class="secondary" data-action="room-back">返回大厅</button>${room.status === "waiting" && room.seat === 0 ? '<button class="text-button" data-action="room-close">关闭这个房间</button>' : ""}`,
    );
    return;
  }
  installContent(room.state.content);
  state = room.state;
  faction = state.players[0].faction;
  if (
    !previous ||
    previous.id !== room.id ||
    previous.revision !== room.revision
  ) {
    selection = pending = null;
  }
  inspect =
    E.catalog[inspect?.id] ??
    E.catalog[state.players[0].hand[0]?.cardId ?? "N-12"];
  message =
    state.active === 0
      ? "轮到你了。所有操作由服务端复算并同步。"
      : "等待对方行动。";
  if (room.status === "mulligan") {
    if (!state.mulliganReady[0]) {
      if (modalType !== "mulligan") mulliganSet = new Set();
      renderMulligan();
    } else
      showModal(
        "room-wait",
        `<small>DEPLOYMENT READY</small><h2>已完成整备</h2><p>你的阵营：${esc(factionName(faction))}。等待对方确认起手牌…</p><button class="secondary" data-action="room-resign">认输退出</button>`,
      );
  } else if (
    ["mulligan", "room-wait", "lobby", "briefing", "result"].includes(modalType)
  )
    closeModal();
  render();
}
function inviteMarkup() {
  return `<label class="invite-label">邀请链接<input id="invite-link" readonly value="${esc(location.origin + "/?room=" + network.id)}"></label><button class="primary" data-action="room-copy">复制邀请链接</button><p id="room-copy-status" class="note">房间号 ${network.id} · 链接不包含身份凭证</p>`;
}
function showNetworkMenu() {
  showModal(
    "network-menu",
    `<small>ROOM / ${network.id}</small><h2>联机指挥台</h2><p>${network.players.map((p) => (p ? esc(p.name) + " · " + esc(factionName(p.faction)) : "等待玩家")).join(" vs ")}</p><p>云端版本 v${network.revision} · ${esc(networkStatus)}</p>${inviteMarkup()}<button class="primary" data-action="room-return">返回对局</button>${network.status !== "finished" ? '<button class="secondary" data-action="room-resign">认输</button>' : ""}<button class="text-button" data-action="room-back">返回大厅（保留房间）</button><p class="note">可刷新或返回大厅后重新进入。对战期间不会由AI接管；关闭网页不会自动认输。</p>`,
  );
}
async function networkAction(action) {
  if (netPending || !network) return false;
  netPending = true;
  let prediction, actionError;
  try {
    const trial = structuredClone(state);
    trial.rng = 1;
    trial.nextId = 1000000000;
    applyCommand(E, trial, 0, action);
    prediction = summary(trial);
    message = `本地预估：总部 ${prediction.hp[0]} / ${prediction.hp[1]} · 剩余 ${prediction.k} K，等待服务端确认…`;
  } catch {
    message = "正在请求服务端结算…";
  }
  const canonical = orientAction(action, network.seat);
  selection = pending = null;
  render();
  try {
    await net.action(canonical, prediction);
    return true;
  } catch (e) {
    actionError = e.message;
    message = e.message;
    render();
    return false;
  } finally {
    netPending = false;
    render();
    if (network?.status === "mulligan" && !state.mulliganReady[0])
      renderMulligan();
    if (actionError && modalType) {
      const error = document.createElement("p");
      error.className = "network-error";
      error.setAttribute("role", "alert");
      error.textContent = actionError;
      modal.querySelector(".modal")?.append(error);
    }
  }
}
async function networkAttack(uid, target) {
  if (
    netPending ||
    combatBusy ||
    !E.attackTargets(state, E.find(state, uid)).some((t) => t.uid === target)
  )
    return;
  const from = unitCenter(uid),
    to = unitCenter(target),
    type = E.def(E.find(state, uid)).type;
  combatBusy = true;
  document.body.classList.add("combat-busy");
  sound("attack");
  // Keep the existing projectile timing; commit once at impact, then reconcile with the server response.
  let settlement;
  try {
    if (from && to)
      await combat.shot(from, to, type, () => {
        settlement = networkAction({ kind: "attack", uid, target });
        sound("impact");
      });
    else settlement = networkAction({ kind: "attack", uid, target });
    await settlement;
  } finally {
    combatBusy = false;
    document.body.classList.remove("combat-busy");
  }
}
async function boot() {
  latestContent = await fetchContent();
  installContent(latestContent);
  state = E.createGame({ faction });
  inspect = E.catalog["N-12"];
  render();
  showBriefing();
  if (invitedRoom) await showLobby();
  else if (net.identity && net.savedRoom) {
    try {
      await net.resume(net.savedRoom);
    } catch {
      await showLobby("无法恢复上次房间，请重新选择");
    }
  }
}
boot();
if (import.meta.env.DEV)
  window.__IRON_FRONT__ = {
    get state() {
      return state;
    },
    engine: E,
    render,
    runAI: () => {
      watch = true;
      closeModal();
      scheduleAI();
    },
  };
