import { factions } from "../content/runtime.js";
export function artIndex(c) {
  const n = c.id[0] === "N";
  if (c.fictional) return 14;
  if (/卫星|GPS|KH-9/.test(c.name)) return 11;
  if (/潜艇|洛杉矶|971型/.test(c.name)) return 10;
  if (/ATACMS|圆点/.test(c.name)) return 15;
  if (c.type === "步兵") return n ? 0 : 1;
  if (c.type === "坦克") return n ? 2 : 3;
  if (c.type === "炮兵") return n ? 4 : 5;
  if (c.type === "战斗机") return n ? 6 : 8;
  if (c.type === "轰炸机") return n ? 7 : 9;
  if (/空运|增援|登陆|撤军|盾牌/.test(c.name)) return 12;
  return 13;
}
export const artStyle = (c) => {
  const i = artIndex(c);
  return `background-position:${((i % 4) * 100) / 3}% ${(Math.floor(i / 4) * 100) / 3}%`;
};
export const symbols = {
  步兵: "♟",
  坦克: "▰",
  炮兵: "⌖",
  战斗机: "✈",
  轰炸机: "✈",
  指令: "!",
  反制: "↯",
};
export const factionName = (f) => factions.find((x) => x.id === f)?.name ?? f;
export function emblem(f, cls = "") {
  return `<span class="emblem ${f === "N" ? "west" : "east"} ${cls}" aria-hidden="true"></span>`;
}
