import { defaultContent, weightFields } from "./defaults.js";
export const collections = [
  "cards",
  "tokens",
  "factions",
  "decks",
  "strategies",
];
export const limits = { 普通: 4, 限定: 3, 特殊: 2, 精英: 1 };
const fail = (message) => {
  throw new Error(message);
};
function text(v, name, max = 500, empty = false) {
  if (typeof v !== "string" || (!empty && !v.trim()) || v.length > max)
    fail(`${name}须为${empty ? "0" : "1"}—${max}字文本`);
}
function num(v, name, min, max, integer = true) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    (integer && !Number.isInteger(v)) ||
    v < min ||
    v > max
  )
    fail(`${name}须在${min}—${max}之间${integer ? "且为整数" : ""}`);
}
function keys(value, allowed, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail(`${name}包含不支持的字段`);
}
export function validateContent(input) {
  keys(input, ["schemaVersion", ...collections], "配置");
  if (input.schemaVersion !== 1) fail("不支持的数据格式版本");
  const data = structuredClone(input);
  for (const kind of collections) {
    if (
      !Array.isArray(data[kind]) ||
      data[kind].length !== defaultContent[kind].length
    )
      fail(`${kind}记录数量不正确`);
    if (new Set(data[kind].map((v) => v?.id)).size !== data[kind].length)
      fail("存在重复ID");
    for (const row of data[kind]) {
      const base = defaultContent[kind].find((v) => v.id === row?.id);
      if (!base) fail(`未注册的${kind} ID`);
      keys(row, Object.keys(base), kind);
      if (kind === "cards" || kind === "tokens") {
        for (const k of [
          "id",
          "type",
          "effect",
          "faction",
          "alternate_timeline",
        ])
          if (row[k] !== base[k])
            fail(`卡牌${base.id}的${k}由规则引擎管理，不可更改`);
        text(row.name, "卡名", 80);
        num(row.cost, "部署费用", 0, 24);
        if (base.attack === null) {
          if (
            row.attack !== null ||
            row.defense !== null ||
            row.operation_cost !== null
          )
            fail("指令／反制不能设置攻防");
        } else {
          num(row.operation_cost, "行动费用", 0, 12);
          num(row.attack, "攻击", 0, 30);
          num(row.defense, "防御", 1, 30);
        }
        if (kind === "cards") {
          if (!Object.hasOwn(limits, row.rarity)) fail("稀有度无效");
          text(row.historical_anchor, "历史背景", 1500, true);
          if (typeof row.fictional !== "boolean") fail("架空标记无效");
        }
      } else if (kind === "factions") {
        text(row.name, "阵营名称", 60);
        text(row.tagline, "阵营特色", 100);
        text(row.description, "阵营介绍", 2000, true);
      } else if (kind === "strategies") {
        if (row.faction !== base.faction) fail("策略阵营不可更改");
        text(row.name, "策略名称", 80);
        text(row.description, "策略说明", 2000, true);
        keys(row.weights, Object.keys(weightFields), "策略权重");
        for (const k of Object.keys(weightFields))
          num(row.weights[k], weightFields[k][0], 0, 20, false);
      } else if (kind === "decks") {
        if (row.faction !== base.faction) fail("牌组阵营不可更改");
        text(row.name, "牌组名称", 80);
        text(row.description, "牌组说明", 2000, true);
        if (!Array.isArray(row.cards) || row.cards.length > 39)
          fail("牌组格式无效");
        let total = 0;
        const ids = new Set();
        for (const entry of row.cards) {
          keys(entry, ["id", "count"], "牌组条目");
          const card = data.cards.find((c) => c.id === entry.id);
          if (!card || entry.id[0] !== row.faction || ids.has(entry.id))
            fail("牌组包含跨阵营、未知或重复卡牌");
          ids.add(entry.id);
          num(entry.count, "同名卡数量", 1, limits[card.rarity]);
          total += entry.count;
        }
        if (total !== 39) fail(`${row.name}须恰好39张，当前${total}张`);
      }
    }
  }
  return data;
}
export function replaceRecord(current, kind, id, record) {
  if (!collections.includes(kind)) fail("未知内容分类");
  if (!record || record.id !== id) fail("记录ID不匹配");
  const next = structuredClone(current),
    index = next[kind].findIndex((r) => r.id === id);
  if (index < 0) fail("记录不存在");
  next[kind][index] = record;
  return validateContent(next);
}
