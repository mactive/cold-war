import test from "node:test";
import assert from "node:assert/strict";
import { defaultContent } from "../src/content/defaults.js";
import { validateContent, replaceRecord } from "../src/content/schema.js";
import {
  installContent,
  builtInContent,
  contentSnapshot,
  factions,
} from "../src/content/runtime.js";
import { createGame, addUnit, defaultDeck, def } from "../src/game/engine.js";
import { chooseAction } from "../src/game/ai.js";
test("CMS rejects invalid costs, scripted ability changes and over-limit starter cards", () => {
  const card = defaultContent.cards[0];
  assert.throws(() =>
    replaceRecord(defaultContent, "cards", card.id, { ...card, cost: -1 }),
  );
  assert.throws(() =>
    replaceRecord(defaultContent, "cards", card.id, {
      ...card,
      effect: "新增脚本",
    }),
  );
  assert.throws(() =>
    replaceRecord(defaultContent, "cards", card.id, {
      ...card,
      rarity: "精英",
    }),
  );
  const invalid = structuredClone(defaultContent);
  invalid.decks[0].cards[0].count = 1;
  assert.throws(() => validateContent(invalid));
});
test("CMS numeric edits change deployed units; snapshots preserve earlier matches", () => {
  try {
    installContent(builtInContent());
    const before = createGame({ seed: 1 });
    const data = structuredClone(defaultContent);
    data.cards.find((c) => c.id === "N-11").attack = 9;
    data.factions[0].name = "联合指挥部";
    installContent({ revision: 2, data });
    const after = createGame({ seed: 1 }),
      u = addUnit(after, "N-11", 0);
    assert.equal(u.attack, 9);
    assert.equal(factions[0].name, "联合指挥部");
    assert.equal(after.content.revision, 2);
    assert.equal(
      before.content.data.cards.find((c) => c.id === "N-11").attack,
      4,
    );
    installContent(before.content);
    assert.equal(def({ cardId: "N-11" }).attack, 4);
  } finally {
    installContent(builtInContent());
  }
});
test("CMS strategy weights influence real AI action selection", () => {
  try {
    installContent(builtInContent());
    const s = createGame({ seed: 1, skipMulligan: true });
    s.players.forEach((p) => {
      p.hand = [];
      p.rear = [];
      p.k = 12;
      p.maxK = 12;
    });
    s.front = [];
    const u = addUnit(s, "N-11", 0, { ready: true }),
      plane = addUnit(s, "N-19", 0, { ready: true });
    const baseAction = chooseAction(s);
    assert.equal(baseAction.kind, "move");
    assert.equal(baseAction.uid, u.uid);
    const data = structuredClone(defaultContent);
    data.strategies[0].weights.hqDamage = 20;
    installContent({ revision: 3, data });
    const action = chooseAction(s);
    assert.equal(action.kind, "attack");
    assert.equal(action.uid, plane.uid);
    assert.equal(action.target, "hq1");
  } finally {
    installContent(builtInContent());
  }
});
test("CMS starter-deck changes affect new default decks", () => {
  try {
    const data = structuredClone(defaultContent);
    const deck = data.decks[0];
    deck.cards.find((c) => c.id === "N-01").count--;
    deck.cards.find((c) => c.id === "N-02").count++;
    installContent({ revision: 4, data });
    assert.equal(defaultDeck("N").filter((id) => id === "N-01").length, 2);
    assert.equal(defaultDeck("N").length, 39);
    assert.equal(contentSnapshot().revision, 4);
  } finally {
    installContent(builtInContent());
  }
});
