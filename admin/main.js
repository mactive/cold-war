import "./style.css";
import { weightFields } from "../src/content/defaults.js";
import { limits } from "../src/content/schema.js";
import { artStyle } from "../src/ui/art.js";
const root = document.querySelector("#admin-app"),
  notice = document.querySelector("#notice");
let bundle = null,
  csrf = "",
  view = "overview",
  selected = null,
  query = "",
  factionFilter = "all",
  typeFilter = "all",
  dirty = false,
  busy = false,
  versions = [];
const labels = {
  overview: "总览",
  rooms: "房间与对战",
  cards: "卡牌资料",
  tokens: "衍生单位",
  factions: "阵营资料",
  decks: "入门牌组",
  strategies: "AI策略",
  history: "版本记录",
  settings: "账号安全",
};
const icons = {
  overview: "▦",
  rooms: "⚔",
  cards: "▤",
  tokens: "✦",
  factions: "⚑",
  decks: "▥",
  strategies: "⌘",
  history: "↺",
  settings: "◎",
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (v) => new Date(v).toLocaleString("zh-CN", { hour12: false });
const factionName = (f) =>
  bundle.data.factions.find((x) => x.id === f)?.name ?? f;
function toast(message, error = false) {
  notice.textContent = message;
  notice.className = error ? "visible error" : "visible";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (notice.className = ""), 5000);
}
async function api(path, options = {}) {
  const response = await fetch("/api/admin/" + path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login") {
      bundle = null;
      csrf = "";
      dirty = false;
      login();
    }
    throw Error(data.error ?? "请求失败");
  }
  return data;
}
async function load() {
  bundle = await api("content");
  versions = (await api("versions")).versions;
}
function login(error = "") {
  root.innerHTML = `<div class="login-page"><section class="login-brand"><div class="brand-star">✦</div><small>IRON FRONT / COMMAND ARCHIVE</small><h1>每一次调整，<br>都改变战场。</h1><p>卡牌、阵营、牌组与策略<br>统一维护 · 版本记录 · 云端发布</p><a href="/">← 返回游戏</a></section><section class="login-panel"><form id="login-form"><small>ADMINISTRATOR ACCESS</small><h2>登录管理后台</h2><p class="muted">铁幕前线 · 内容管理中心</p><label>管理员账号<input name="username" value="admin" autocomplete="username" required maxlength="30"/></label><label>管理员密码<input name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus/></label><p class="form-error" role="alert">${esc(error)}</p><button class="primary" type="submit">进入指挥档案库 <span>→</span></button><p class="login-foot">会话有效期 8 小时 · 安全登录</p></form></section></div>`;
}
function shell(content) {
  root.innerHTML = `<div class="admin-shell"><aside class="sidebar"><a class="brand" href="/admin"><b>✦</b><span>铁幕前线<small>CONTENT COMMAND</small></span></a><div class="nav-label">内容管理</div><nav>${Object.keys(
    labels,
  )
    .map(
      (k) =>
        `<button data-view="${k}" class="${view === k ? "active" : ""}"><i>${icons[k]}</i>${labels[k]}${bundle.data[k] ? `<em>${bundle.data[k].length}</em>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-foot"><span class="online-dot"></span> D1 数据库已连接<small>当前发布版本 v${bundle.revision}</small><a href="/" target="_blank" rel="noopener">打开游戏 ↗</a></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">指挥档案库 <span>/</span> ${labels[view]}</div><div class="top-actions"><span class="version-tag">已发布 v${bundle.revision}</span><button class="quiet" data-action="refresh">刷新</button><button class="quiet" data-action="export">导出数据</button><button class="avatar" data-action="logout" title="退出登录">A <span>退出</span></button></div></header><main>${content}</main></div></div>`;
}
function heading(title, subtitle, extra = "") {
  return `<div class="page-heading"><div><small>IRON FRONT / DATA OPERATIONS</small><h1>${title}</h1><p>${subtitle}</p></div>${extra}</div>`;
}
function overview() {
  return (
    heading(
      "战场资料总览",
      "从这里调整游戏内容。保存后发布，新对局自动使用最新配置。",
      `<div class="published"><span>最新发布</span><b>v${bundle.revision}</b><small>${date(bundle.updatedAt)}</small></div>`,
    ) +
    `<div class="stats-grid">${[
      ["cards", "卡牌图鉴", "另有 3 个衍生单位"],
      ["factions", "作战阵营", "名称、特色与介绍"],
      ["decks", "入门牌组", "每套 39 张卡牌"],
      ["strategies", "AI策略", "可调行动评估权重"],
    ]
      .map(
        ([k, name, sub]) =>
          `<button class="stat-card" data-view="${k}"><i>${icons[k]}</i><b>${bundle.data[k].length}<small>${name}</small></b><p>${sub} <span>↗</span></p></button>`,
      )
      .join("")}</div>
 <div class="overview-grid"><section class="panel"><div class="section-heading"><h2>作战阵营</h2><button data-view="factions" class="text-link">管理阵营 →</button></div><div class="faction-overview">${bundle.data.factions.map((f) => `<article><div class="faction-mark ${f.id === "N" ? "west" : "east"}">${f.id === "N" ? "✦" : "★"}</div><div><h3>${esc(f.name)}</h3><b>${esc(f.tagline)}</b><p>${esc(f.description)}</p></div></article>`).join("")}</div></section><section class="panel"><div class="section-heading"><h2>最近发布</h2><button data-view="history" class="text-link">全部记录 →</button></div><div class="recent-versions">${versions
   .slice(0, 5)
   .map(
     (v) =>
       `<article><span>v${v.revision}</span><div><b>${esc(v.note)}</b><small>${date(v.createdAt)}</small></div></article>`,
   )
   .join("")}</div></section></div>
 <div class="info-strip"><b>内容发布说明</b><p>卡牌数值、阵营介绍、入门牌组和AI权重由云端配置驱动。进行中的对局保留原数据版本；特殊技能与战斗规则仍由规则引擎实现。</p></div>`
  );
}
function field(name, label, value, type = "text", opts = {}) {
  const attr = `name="${name}" ${opts.readonly ? "readonly" : ""} ${opts.max !== undefined ? `max="${opts.max}"` : ""} ${opts.min !== undefined ? `min="${opts.min}"` : ""} ${opts.step ? `step="${opts.step}"` : ""}`;
  return `<label class="field ${opts.wide ? "wide" : ""}"><span>${label}${opts.readonly ? "<em>规则固定</em>" : ""}</span>${type === "textarea" ? `<textarea ${attr} rows="${opts.rows ?? 3}" maxlength="${opts.maxlength ?? 2000}">${esc(value)}</textarea>` : type === "select" ? `<select ${attr}>${opts.values.map((v) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : `<input ${attr} type="${type}" value="${esc(value)}" ${type === "text" ? `maxlength="${opts.maxlength ?? 80}"` : ""}/>`}</label>`;
}
function recordEditor(row) {
  const isCard = ["cards", "tokens"].includes(view);
  const f = row.faction?.length === 1 ? row.faction : row.id[0];
  let form = "";
  if (isCard) {
    form = `${field("name", "卡牌名称", row.name)}${field("id", "卡牌 ID", row.id, "text", { readonly: true })}${field("cost", "部署费用", row.cost, "number", { min: 0, max: 24 })}${row.attack !== null ? field("operation_cost", "行动费用", row.operation_cost, "number", { min: 0, max: 12 }) : ""}${row.attack !== null ? field("attack", "攻击力", row.attack, "number", { min: 0, max: 30 }) + field("defense", "防御力", row.defense, "number", { min: 1, max: 30 }) : ""}${row.rarity ? field("rarity", "稀有度", row.rarity, "select", { values: Object.keys(limits) }) : ""}${field("type", "单位类型", row.type, "text", { readonly: true })}${field("effect", "技能效果", row.effect, "textarea", { readonly: true, wide: true })}${row.historical_anchor !== undefined ? field("historical_anchor", "历史背景 / 设定", row.historical_anchor, "textarea", { wide: true, maxlength: 1500 }) : ""}${row.fictional !== undefined ? `<label class="checkbox wide"><input type="checkbox" name="fictional" ${row.fictional ? "checked" : ""}/> 架空科技卡牌</label>` : ""}`;
  } else if (view === "factions") {
    form =
      field("name", "阵营名称", row.name) +
      field("id", "阵营代码", row.id, "text", { readonly: true }) +
      field("tagline", "阵营特色", row.tagline, "text", {
        wide: true,
        maxlength: 100,
      }) +
      field("description", "阵营介绍", row.description, "textarea", {
        wide: true,
        rows: 7,
      });
  } else if (view === "strategies") {
    form =
      field("name", "策略名称", row.name, "text", { wide: true }) +
      field("description", "策略说明", row.description, "textarea", {
        wide: true,
      }) +
      `<div class="wide subheading">行动评估权重 <small>0—20，可输入小数；0 表示不计入此项</small></div>` +
      Object.entries(weightFields)
        .map(([k, [label]]) =>
          field("weights." + k, label, row.weights[k], "number", {
            min: 0,
            max: 20,
            step: 0.01,
          }),
        )
        .join("");
  } else if (view === "decks") {
    const byId = Object.fromEntries(row.cards.map((c) => [c.id, c.count]));
    form =
      field("name", "牌组名称", row.name, "text", { wide: true }) +
      field("description", "牌组说明", row.description, "textarea", {
        wide: true,
      }) +
      `<div class="wide subheading">卡牌配置 <b id="deck-total">39 / 39</b></div><div class="deck-entries wide">${bundle.data.cards
        .filter((c) => c.id[0] === f)
        .map(
          (c) =>
            `<label><span class="cost-dot">${c.cost}</span><span>${esc(c.name)}<small>${c.id} · ${c.type} · ${c.rarity}</small></span><input type="number" data-card-count="${c.id}" min="0" max="${limits[c.rarity]}" value="${byId[c.id] ?? 0}" aria-label="${esc(c.name)}数量"/></label>`,
        )
        .join("")}</div>`;
  }
  const preview = isCard
    ? `<div class="card-preview"><div class="preview-art" style="${artStyle(row)}"><span>${row.cost}<small>K</small></span></div><div class="preview-body"><small>${row.id} · ${row.type}</small><h3>${esc(row.name)}</h3><p>${esc(row.effect || "无额外技能")}</p>${row.attack !== null ? `<div class="preview-stats"><b>${row.attack}<small>攻击</small></b><b>${row.defense}<small>防御</small></b></div>` : ""}</div></div>`
    : "";
  return `<section class="editor panel"><div class="editor-heading"><div><small>${esc(factionName(f))}</small><h2>${esc(row.name)}</h2></div><span class="pill">${row.id}</span></div>${preview}<form id="record-form" data-id="${row.id}"><div class="fields">${form}</div><div class="editor-note">${isCard ? "卡牌ID、兵种与技能逻辑保持固定。数值在新对局中生效；调整稀有度时须满足现有入门牌组的同名上限。" : view === "strategies" ? "这些权重参与实际AI决策及后台模拟。合法目标、特殊技能处理和直接致胜判断由规则引擎固定。" : "保存后发布到云端，新对局读取最新版本。"}</div><div class="save-bar"><span id="dirty-state">尚未修改</span><button type="button" class="secondary" data-action="discard">放弃修改</button><button type="submit" class="primary">保存并发布 →</button></div></form></section>`;
}
function listing() {
  const data = bundle.data[view];
  const rows = data.filter(
    (r) =>
      (r.id + " " + r.name + " " + (r.effect ?? ""))
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (factionFilter === "all" || r.id[0] === factionFilter) &&
      (typeFilter === "all" || r.type === typeFilter),
  );
  const selectedRow = data.find((r) => r.id === selected);
  const isCard = ["cards", "tokens"].includes(view);
  const table = `<section class="record-list panel"><div class="list-top"><b>${rows.length} 条资料</b><small>点击一条资料开始编辑</small></div><div class="table-scroll"><table><thead><tr><th>${isCard ? "卡牌" : "名称"}</th>${isCard ? "<th>费用</th><th>攻 / 防</th>" : ""}<th>阵营</th></tr></thead><tbody>${rows.map((r) => `<tr tabindex="0" role="button" data-record="${r.id}" class="${selected === r.id ? "selected" : ""}"><td><b>${esc(r.name)}</b><small>${r.id}${r.type ? " · " + r.type : ""}</small></td>${isCard ? `<td><span class="cost-dot">${r.cost}</span></td><td>${r.attack ?? "—"} / ${r.defense ?? "—"}</td>` : ""}<td><span class="faction-chip ${r.id[0] === "N" ? "nato" : "warsaw"}">${r.id[0] === "N" ? "北约" : "华约"}</span></td></tr>`).join("") || '<tr><td colspan="4" class="empty">没有匹配的资料</td></tr>'}</tbody></table></div></section>`;
  return (
    heading(
      labels[view],
      {
        cards: "维护80张可构筑卡牌的名称、费用、攻防和历史设定。",
        tokens: "维护技能生成的3种衍生单位；它们不进入玩家牌库。",
        factions: "维护阵营名称、特色与介绍，直接展示在游戏整备界面。",
        decks: "调整两套默认入门牌组；每套必须39张，并符合稀有度限制。",
        strategies: "管理真实参与本地AI和自动模拟的行动评估参数。",
      }[view],
    ) +
    `<div class="filters"><input id="search" type="search" placeholder="搜索名称、ID或技能…" value="${esc(query)}"/><select id="faction-filter"><option value="all">全部阵营</option>${bundle.data.factions.map((f) => `<option value="${f.id}" ${factionFilter === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>${isCard ? `<select id="type-filter"><option value="all">全部类型</option>${[...new Set(data.map((r) => r.type))].map((t) => `<option ${typeFilter === t ? "selected" : ""}>${t}</option>`).join("")}</select>` : ""}</div><div class="editor-layout">${table}${selectedRow ? recordEditor(selectedRow) : '<section class="editor-placeholder panel"><span>▤</span><h2>选择一条资料</h2><p>在左侧列表中选择，查看详情并编辑。</p></section>'}</div>`
  );
}
function historyView() {
  return (
    heading(
      "版本记录",
      "每次保存产生一个完整数据版本。恢复历史版本会创建新版本，保留全部记录。",
    ) +
    `<section class="panel history-panel"><table><thead><tr><th>版本</th><th>变更内容</th><th>发布时间</th><th>操作</th></tr></thead><tbody>${versions.map((v) => `<tr><td><b>v${v.revision}</b>${v.revision === bundle.revision ? '<span class="pill">当前</span>' : ""}</td><td>${esc(v.note)}</td><td>${date(v.createdAt)}</td><td><button class="secondary" data-restore="${v.revision}" ${v.revision === bundle.revision ? "disabled" : ""}>恢复此版本</button></td></tr>`).join("")}</tbody></table></section><p class="muted">显示最近100个版本。恢复会覆盖卡牌、阵营、牌组与策略的全部当前配置。</p>`
  );
}
function settingsView() {
  return (
    heading(
      "账号安全",
      "管理员账号：admin。密码更新后，所有已登录会话将失效。",
    ) +
    `<section class="panel password-panel"><h2>修改管理员密码</h2><form id="password-form">${field("oldPassword", "当前密码", "", "password")}${field("newPassword", "新密码（至少12个字符）", "", "password")}${field("confirmPassword", "再次输入新密码", "", "password")}<button class="primary" type="submit">更新密码并退出登录</button></form></section>`
  );
}
let roomRows = [],
  roomDetail = null,
  roomCursor = null,
  verification = null;
const actionLabels = {
  create: "创建房间",
  join: "加入房间",
  close: "关闭房间",
  expired: "过期关闭",
  "identity-revoked": "注销认输",
  mulligan: "起手换牌",
  play: "出牌",
  move: "移动",
  attack: "攻击",
  end: "结束回合",
  disarm: "撤销反制",
  resign: "认输",
};
const actionName = (k) => actionLabels[k] ?? k;
const roomLabels = {
  waiting: "等待对手",
  mulligan: "起手整备",
  play: "对战中",
  finished: "已结束",
  closed: "已关闭",
};
async function loadRooms(before) {
  const result = await api("rooms" + (before ? "?before=" + before : ""));
  roomRows = before ? [...roomRows, ...result.rooms] : result.rooms;
  roomCursor = result.nextBefore;
}
function roomsView() {
  if (!roomDetail)
    return (
      heading(
        "房间与对战",
        "双人房间、服务端结算与审计日志。每局胜利3分、平局1分、失败0分。",
      ) +
      `<section class="panel room-admin-list"><table><thead><tr><th>房间</th><th>状态</th><th>玩家 / 阵营</th><th>总部</th><th>最后更新</th><th></th></tr></thead><tbody>${roomRows.map((r) => `<tr><td><code>${r.id}</code><small>v${r.revision}</small></td><td>${roomLabels[r.status]}</td><td>${esc(r.host_name)} / ${esc(r.host_faction ?? "待分配")}<br>${esc(r.guest_name ?? "等待加入")} / ${esc(r.guest_faction ?? "待分配")}</td><td>${r.host_hp ?? "—"} : ${r.guest_hp ?? "—"}</td><td>${date(r.updated_at)}</td><td><button class="secondary" data-room-detail="${r.id}">查看对战</button></td></tr>`).join("")}</tbody></table>${!roomRows.length ? "<p>尚无联机房间</p>" : ""}${roomCursor ? `<button data-room-more="${roomCursor}" class="secondary">加载更多房间</button>` : ""}</section>`
    );
  const { room: r, people, events, rejections, nextBefore } = roomDetail;
  const state = r.state;
  return (
    heading(
      "对战档案",
      `房间 ${r.id} · ${roomLabels[r.status]} · 状态版本 v${r.revision}`,
      `<button class="secondary" data-room-list>← 房间列表</button>`,
    ) +
    `<div class="room-summary panel"><h2>${people.map((p) => esc(p.name) + (p.revoked_at ? "（已注销）" : "")).join(" vs ")}</h2><p>创建 ${date(r.created_at)} · 最近更新 ${date(r.updated_at)} · 配置 v${r.content.revision}</p><p>${state ? state.players.map((p, i) => `${i === 0 ? "房主" : "访客"} ${esc(factionName(p.faction))}：总部 ${p.hp}，指挥点 ${p.k}/${p.maxK}，牌库 ${p.deck.length}张`).join("<br>") : "等待第二位玩家加入后随机分配阵营"}</p><p>结果：${!state || state.winner === null ? "尚未结算" : state.winner === "draw" ? "平局，各+1分" : (state.winner === 0 ? "房主" : "访客") + "获胜，+3分"}</p><button class="primary" data-room-verify="${r.id}">从初始状态重放校验全部操作</button>${verification ? `<p class="${verification.verified ? "verification-pass" : "form-error"}">${verification.verified ? "✓ 服务端重放校验通过" : "✕ 重放校验失败"} · ${verification.actions ?? 0}步 ${esc(verification.reason ?? verification.message ?? "")}</p>` : ""}</div><section class="panel room-event-list"><h2>已保存的操作日志</h2><p>伤害、指挥点、胜负由服务器复算。客户端预测可能因隐藏反制与抽牌而不同，以服务器结果为准。</p>${events.map((e) => `<details><summary><b>v${e.revision}</b> ${esc(actionName(e.payload.action?.kind ?? e.payload.kind))} · ${date(e.created_at)} <span>${e.payload.predictionMatch === false ? "预测已校正" : e.payload.predictionMatch === true ? "预测与复算一致" : "服务端已记录"}</span></summary>${(e.payload.combatLogs ?? []).map((l) => `<p>${esc(l.text.replace(/我方|敌方/g, (t) => (t === "我方" ? "房主" : "访客")))}</p>`).join("")}<pre>${esc(JSON.stringify(e.payload, null, 2))}</pre></details>`).join("")}${nextBefore ? `<button class="secondary" data-event-more="${nextBefore}">加载更早日志</button>` : ""}</section><section class="panel room-event-list"><h2>最近拒绝的操作</h2>${rejections.length ? rejections.map((e) => `<details><summary>${esc(e.reason)} · ${date(e.created_at)}</summary><pre>${esc(e.action)}</pre></details>`).join("") : "<p>无非法或过期操作</p>"}</section>`
  );
}
function render() {
  if (!bundle) return login();
  shell(
    view === "rooms"
      ? roomsView()
      : view === "overview"
        ? overview()
        : view === "history"
          ? historyView()
          : view === "settings"
            ? settingsView()
            : listing(),
  );
}
function leaveDirty() {
  return !dirty || confirm("有尚未保存的修改，确定放弃吗？");
}
function readForm(form) {
  const row = structuredClone(
    bundle.data[view].find((r) => r.id === form.dataset.id),
  );
  for (const el of form.elements) {
    if (!el.name || el.readOnly) continue;
    const value =
      el.type === "checkbox"
        ? el.checked
        : el.type === "number"
          ? Number(el.value)
          : el.value;
    if (el.name.startsWith("weights.")) row.weights[el.name.slice(8)] = value;
    else row[el.name] = value;
  }
  if (view === "decks")
    row.cards = [...form.querySelectorAll("[data-card-count]")]
      .filter((el) => Number(el.value) > 0)
      .map((el) => ({ id: el.dataset.cardCount, count: Number(el.value) }));
  return row;
}
function setBusy(value) {
  busy = value;
  root
    .querySelectorAll('button[type="submit"]')
    .forEach((b) => (b.disabled = value));
}
root.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const form = e.target;
  setBusy(true);
  notice.textContent = "";
  notice.className = "";
  try {
    if (form.getAttribute("id") === "login-form") {
      const data = Object.fromEntries(new FormData(form));
      const result = await api("login", {
        method: "POST",
        body: JSON.stringify(data),
      });
      csrf = result.csrf;
      form.reset();
      await load();
      render();
    } else if (form.getAttribute("id") === "record-form") {
      const result = await api(`content/${view}/${form.dataset.id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: bundle.revision,
          data: readForm(form),
        }),
      });
      bundle = result;
      dirty = false;
      versions = (await api("versions")).versions;
      render();
      toast(`已发布 v${bundle.revision}，新对局将使用最新配置`);
    } else if (form.getAttribute("id") === "password-form") {
      const data = Object.fromEntries(new FormData(form));
      if (data.newPassword !== data.confirmPassword)
        throw Error("两次新密码不一致");
      await api("password", { method: "POST", body: JSON.stringify(data) });
      bundle = null;
      csrf = "";
      dirty = false;
      form.reset();
      login();
      toast("密码已更新，请使用新密码登录");
    }
  } catch (error) {
    if (form.getAttribute("id") === "login-form")
      form.querySelector(".form-error").textContent = error.message;
    else toast(error.message, true);
  } finally {
    setBusy(false);
  }
});
root.addEventListener("click", async (e) => {
  if (busy) return;
  const record = e.target.closest("[data-record]");
  if (record) {
    if (!leaveDirty()) return;
    selected = record.dataset.record;
    dirty = false;
    render();
    return;
  }
  const nav = e.target.closest("[data-view]");
  if (nav) {
    if (!leaveDirty()) return;
    view = nav.dataset.view;
    selected = null;
    query = "";
    factionFilter = typeFilter = "all";
    dirty = false;
    if (view === "rooms") {
      roomDetail = null;
      verification = null;
      try {
        await loadRooms();
      } catch (e) {
        toast(e.message, true);
      }
    }
    render();
    return;
  }
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  try {
    if (b.dataset.roomDetail) {
      setBusy(true);
      roomDetail = await api("rooms/" + b.dataset.roomDetail);
      verification = null;
      render();
      return;
    }
    if (b.hasAttribute("data-room-list")) {
      roomDetail = null;
      verification = null;
      await loadRooms();
      render();
      return;
    }
    if (b.dataset.roomMore) {
      await loadRooms(b.dataset.roomMore);
      render();
      return;
    }
    if (b.dataset.roomVerify) {
      setBusy(true);
      verification = await api("rooms/" + b.dataset.roomVerify + "/verify");
      render();
      return;
    }
    if (b.dataset.eventMore) {
      const older = await api(
        "rooms/" + roomDetail.room.id + "?before=" + b.dataset.eventMore,
      );
      roomDetail.events.push(...older.events);
      roomDetail.nextBefore = older.nextBefore;
      render();
      return;
    }
    if (b.dataset.restore) {
      if (
        !confirm(
          `将全部配置恢复到 v${b.dataset.restore}？当前版本仍保留在历史记录中。`,
        )
      )
        return;
      setBusy(true);
      bundle = await api("restore", {
        method: "POST",
        body: JSON.stringify({
          revision: bundle.revision,
          targetRevision: Number(b.dataset.restore),
        }),
      });
      versions = (await api("versions")).versions;
      render();
      toast(`已恢复并发布 v${bundle.revision}`);
    }
    if (b.dataset.action === "discard") {
      dirty = false;
      render();
    }
    if (b.dataset.action === "refresh") {
      if (!leaveDirty()) return;
      setBusy(true);
      await load();
      if (view === "rooms") {
        if (roomDetail) roomDetail = await api("rooms/" + roomDetail.room.id);
        else await loadRooms();
      }
      dirty = false;
      render();
      toast("已获取最新数据");
    }
    if (b.dataset.action === "logout") {
      if (!leaveDirty()) return;
      await api("logout", { method: "POST" });
      bundle = null;
      csrf = "";
      dirty = false;
      login();
    }
    if (b.dataset.action === "export") {
      const href = URL.createObjectURL(
          new Blob([JSON.stringify(bundle, null, 2)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = href;
      a.download = `cold-war-content-v${bundle.revision}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});
root.addEventListener("input", (e) => {
  if (e.target.closest("#record-form")) {
    dirty = true;
    document.querySelector("#dirty-state").textContent = "有未发布的修改";
    if (e.target.dataset.cardCount) {
      const total = [...document.querySelectorAll("[data-card-count]")].reduce(
        (n, x) => n + Number(x.value),
        0,
      );
      document.querySelector("#deck-total").textContent = `${total} / 39`;
    }
  }
  if (e.target.id === "search") {
    if (dirty) return;
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("#search");
    input.focus();
    try {
      input.setSelectionRange(pos, pos);
    } catch {}
  }
});
root.addEventListener("change", (e) => {
  if (["faction-filter", "type-filter"].includes(e.target.id)) {
    if (!leaveDirty()) {
      render();
      return;
    }
    dirty = false;
    if (e.target.id === "faction-filter") factionFilter = e.target.value;
    else typeFilter = e.target.value;
    render();
  }
});
root.addEventListener("keydown", (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches("[data-record]")
  ) {
    e.preventDefault();
    e.target.click();
  }
});
addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
(async () => {
  try {
    const auth = await api("session");
    csrf = auth.csrf;
    await load();
    render();
  } catch {
    login();
  }
})();
