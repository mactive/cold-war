import { cards, tokens, starterDecks } from "../game/catalog.js";
export const weightFields = {
  moveBase: ["推进基础优先级", 3],
  moveAttack: ["推进：攻击力权重", 0.28],
  tankAdvance: ["坦克推进加分", 1],
  captureFront: ["夺取前线加分", 1],
  attackDamage: ["单位伤害权重", 0.9],
  hqDamage: ["总部伤害权重", 0.85],
  killBonus: ["击毁单位加分", 2],
  tradePenalty: ["自身阵亡惩罚", 0.65],
  operationPenalty: ["行动费用惩罚", 0.1],
  deployBase: ["部署基础优先级", 2],
  deployAttack: ["部署：攻击力权重", 0.5],
  deployDefense: ["部署：防御力权重", 0.25],
  emptyRearBonus: ["补充支援区加分", 2],
  deployCostPenalty: ["部署费用惩罚", 0.15],
  counterScore: ["反制优先级", 0.8],
  orderBase: ["一般指令优先级", 2.5],
  playCostPenalty: ["出牌费用惩罚", 0.06],
  targetAttack: ["目标价值：攻击力权重", 0.45],
  targetDefense: ["目标价值：剩余防御权重", 0.25],
  removalMultiplier: ["移除指令：目标价值权重", 0.9],
  drawPriority: ["缺牌时抽牌优先级", 5],
  swarmPriority: ["缺单位时增援优先级", 5],
  buffUnit: ["群体增益：单位数量权重", 1.1],
};
export const defaultContent = {
  schemaVersion: 1,
  cards: structuredClone(cards),
  tokens: structuredClone(tokens),
  factions: [
    {
      id: "N",
      name: "美国 / 北约",
      tagline: "侦察 · 空地协同",
      description:
        "先建立情报优势，再用精确火力与空地协同突破防线。注重指挥点增长、装甲保护和航空支援。",
    },
    {
      id: "W",
      name: "苏联 / 华约",
      tagline: "装甲 · 纵深推进",
      description:
        "以步兵与装甲部队争夺前线，通过预备役、火炮与纵深突击维持进攻压力。",
    },
  ],
  decks: starterDecks.map((d) => ({
    id: d.id,
    faction: d.id[0],
    name: d.id[0] === "N" ? "北约联合行动" : "华约纵深突击",
    description: "默认入门牌组，39张卡牌，总部另计。",
    cards: structuredClone(d.cards),
  })),
  strategies: ["N", "W"].map((f) => ({
    id: f + "-ai",
    faction: f,
    name: f === "N" ? "北约标准策略" : "华约标准策略",
    description:
      "评估当前可执行行动的收益，优先处理可击毁目标，再权衡部署、推进和资源消耗。致胜攻击始终优先。",
    weights: Object.fromEntries(
      Object.entries(weightFields).map(([k, v]) => [k, v[1]]),
    ),
  })),
};
