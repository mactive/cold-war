import { defaultContent } from "./defaults.js";
import { validateContent } from "./schema.js";
export const cards = [],
  tokens = [],
  starterDecks = [],
  factions = [],
  strategies = [];
export const catalog = {};
let snapshot;
export function installContent(bundle) {
  const data = validateContent(bundle.data);
  for (const [target, source] of [
    [cards, data.cards],
    [tokens, data.tokens],
    [starterDecks, data.decks],
    [factions, data.factions],
    [strategies, data.strategies],
  ])
    target.splice(0, target.length, ...source);
  for (const k of Object.keys(catalog)) delete catalog[k];
  for (const c of [...cards, ...tokens]) catalog[c.id] = c;
  snapshot = { revision: bundle.revision ?? 0, data };
}
export const contentSnapshot = () => structuredClone(snapshot);
export const builtInContent = () => ({
  revision: 0,
  data: structuredClone(defaultContent),
});
installContent(builtInContent());
export async function fetchContent() {
  try {
    const response = await fetch("/api/content", {
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Error("配置服务暂不可用");
    const bundle = await response.json();
    validateContent(bundle.data);
    return bundle;
  } catch {
    return builtInContent();
  }
}
