import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import * as E from "../src/game/engine.js";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173/");
function base() {
  const s = E.createGame({ seed: 12, skipMulligan: true });
  s.players.forEach((p) => {
    p.hand = [];
    p.rear = [];
    p.maxK = p.k = 12;
  });
  s.front = [];
  return s;
}
async function load(s) {
  await page.evaluate(
    (s) => localStorage.setItem("iron-front-save-v1", JSON.stringify(s)),
    s,
  );
  await page.reload();
  await page.getByRole("button", { name: "继续上次对局" }).click();
}
// Actual pointer clicks for tank move+attack, including HQ targeting.
let s = base();
const t = E.addUnit(s, "N-14", 0, { ready: true });
await load(s);
await page.locator(`[data-target="${t.uid}"]`).click();
await page.locator('[data-move="0"]').click();
await page.locator(`[data-target="${t.uid}"]`).click();
await page.locator('[data-target="hq1"]').click();
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[1].hp))
  .toBe(16);
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[0].k))
  .toBe(10);
// Regression: adjacent frontline guards must not make each other untargetable.
s = base();
const guards = [0, 1].map(() =>
    E.addUnit(s, "W-01", 1, { row: "front", ready: true }),
  ),
  reserve = E.addUnit(s, "W-T1", 1, { row: "front", ready: true }),
  bradley = E.addUnit(s, "N-10", 0, { ready: true });
guards[0].hp = 1;
guards[1].hp = 2;
bradley.hp = bradley.maxHp = 4;
await load(s);
await page.locator(`[data-target="${bradley.uid}"]`).click();
for (const g of guards)
  await expect(page.locator(`[data-target="${g.uid}"]`)).toHaveClass(
    /\bvalid\b/,
  );
await expect(page.locator(`[data-target="${reserve.uid}"]`)).not.toHaveClass(
  /\bvalid\b/,
);
await page.screenshot({ path: "output/playtest/07-adjacent-guards.png" });
await page.locator(`[data-target="${guards[1].uid}"]`).click();
await expect(page.locator(`[data-target="${guards[1].uid}"]`)).toHaveCount(0);
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[0].k))
  .toBe(11);
await expect
  .poll(() =>
    page.evaluate(
      (id) => __IRON_FRONT__.engine.find(__IRON_FRONT__.state, id).hp,
      bradley.uid,
    ),
  )
  .toBe(3);
// Two-step targeting: GPS needs both enemy and friendly unit; then the locked missile deals six.
s = base();
const f = E.addUnit(s, "N-11", 0, { ready: true }),
  enemy = E.addUnit(s, "W-17", 1, { ready: true });
const gps = { uid: "c" + s.nextId++, cardId: "N-34", armed: false },
  missile = { uid: "c" + s.nextId++, cardId: "N-31", armed: false };
s.players[0].hand.push(gps, missile);
await load(s);
await page.locator(`[data-hand="${gps.uid}"]`).click();
await page.getByRole("button", { name: "使用指令", exact: true }).click();
await page.locator(`[data-target="${enemy.uid}"]`).click();
await page.locator(`[data-target="${f.uid}"]`).click();
await expect
  .poll(() =>
    page.evaluate(
      (id) =>
        __IRON_FRONT__.engine.locked(
          __IRON_FRONT__.state,
          __IRON_FRONT__.engine.find(__IRON_FRONT__.state, id),
        ),
      enemy.uid,
    ),
  )
  .toBe(true);
await page.locator(`[data-hand="${missile.uid}"]`).click();
await page.getByRole("button", { name: "使用指令", exact: true }).click();
await page.locator(`[data-target="${enemy.uid}"]`).click();
await expect
  .poll(() =>
    page.evaluate(
      (id) => __IRON_FRONT__.engine.find(__IRON_FRONT__.state, id).hp,
      enemy.uid,
    ),
  )
  .toBe(1);
// Activation and cancellation refund costs through the UI.
s = base();
const counter = { uid: "c" + s.nextId++, cardId: "N-39", armed: false };
s.players[0].hand.push(counter);
await load(s);
await page.locator(`[data-hand="${counter.uid}"]`).click();
await page.getByRole("button", { name: "激活反制", exact: true }).click();
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[0].k))
  .toBe(9);
await page.locator(`[data-hand="${counter.uid}"]`).click();
await page.getByRole("button", { name: "取消激活 · 退回费用" }).click();
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[0].k))
  .toBe(12);
// Deck builder updates and validates exact quantities.
await page.locator('[data-action="collection"]').click();
const remove = page.locator('[data-remove-card="N-01"]');
await remove.click();
await expect(page.locator(".collection-tools span")).toContainText("38 / 39");
await expect(page.locator('[data-action="save-deck"]')).toBeDisabled();
await page.locator('[data-add-card="N-01"]').click();
await page.locator('[data-action="save-deck"]').click();
await expect
  .poll(() =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("iron-front-decks-v1")).N.length,
    ),
  )
  .toBe(39);
const report = {
  errors,
  checks: [
    "tank moves then attacks HQ",
    "support tank can target and destroy adjacent frontline guards",
    "GPS two-step targeting",
    "locked ATACMS six damage",
    "counter activate/disarm refund",
    "deck edits save only at 39 cards",
  ],
};
fs.writeFileSync(
  "output/playtest/browser-combat-report.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
await browser.close();
if (errors.length) process.exitCode = 1;
