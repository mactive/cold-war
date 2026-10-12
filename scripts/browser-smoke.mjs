import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import * as E from "../src/game/engine.js";
import { runAITurn } from "../src/game/ai.js";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(r.status() + " " + r.url());
});
await page.goto("http://127.0.0.1:5173/");
await page.waitForTimeout(500);
await page.screenshot({ path: "output/playtest/01-briefing.png" });
await page.locator('[data-faction="W"]').click();
await page.getByRole("button", { name: "开始部署" }).click();
await page.locator("[data-mulligan]").first().click();
await page.getByRole("button", { name: "替换1张并进入战场" }).click();
await expect(page.locator(".modal")).toHaveCount(0);
await page.getByRole("button", { name: "结束回合" }).click();
await page.waitForFunction(
  () => __IRON_FRONT__.state.active === 0 && __IRON_FRONT__.state.seq >= 3,
);
const savedSeq = await page.evaluate(() => __IRON_FRONT__.state.seq);
await page.reload();
await page.getByRole("button", { name: "继续上次对局" }).click();
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.seq))
  .toBe(savedSeq);
await page.locator('[data-action="collection"]').click();
await page.locator('[data-deck-faction="W"]').click();
await page.locator("#card-search").fill("T-80");
await expect(page.locator(".collection-grid article")).toHaveCount(2);
await page.locator('[data-inspect-card="W-14"]').click();
await expect(page.locator(".card-detail")).toBeVisible();
await page.locator('[data-action="back-collection"]').last().click();
await page.locator('[data-action="close"]').click();
await page.locator('[data-action="menu"]').click();
await page.getByRole("button", { name: "运行100局自动模拟" }).click();
await expect(page.locator("#sim-status")).toContainText("完成 100 / 100");
await expect(page.locator("#sim-status")).toContainText("0 个错误");
await page.screenshot({ path: "output/playtest/05-simulation.png" });
await page.locator('[data-action="close"]').click();
let fixture;
for (let seed = 1; seed < 100; seed++) {
  const s = E.createGame({ seed, skipMulligan: true });
  if (s.players[0].hand.some((h) => h.cardId === "N-01")) {
    fixture = s;
    break;
  }
}
await page.evaluate(
  (s) => localStorage.setItem("iron-front-save-v1", JSON.stringify(s)),
  fixture,
);
await page.reload();
await page.getByRole("button", { name: "继续上次对局" }).click();
const uid = fixture.players[0].hand.find((h) => h.cardId === "N-01").uid;
await page.locator(`[data-hand="${uid}"]`).click();
await page.locator('[data-deploy="0"]').click();
await expect(page.locator(".own-row .card")).toHaveCount(1);
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[0].k))
  .toBe(0);
await page.getByRole("button", { name: "结束回合" }).click();
await page.waitForFunction(
  () => __IRON_FRONT__.state.active === 0 && __IRON_FRONT__.state.seq >= 3,
);
const mover = await page.evaluate(
  () => __IRON_FRONT__.state.players[0].rear[0].uid,
);
await page.locator(`[data-target="${mover}"]`).click();
await page.locator('[data-move="0"]').click();
await expect(page.locator(`.frontline [data-uid="${mover}"]`)).toHaveCount(1);
// A reproducible mid-battle fixture produced entirely by real engine actions.
const mid = E.createGame({ seed: 24, skipMulligan: true });
while (mid.seq < 13 && mid.phase === "play") runAITurn(mid);
await page.evaluate(
  (s) => localStorage.setItem("iron-front-save-v1", JSON.stringify(s)),
  mid,
);
await page.reload();
await page.getByRole("button", { name: "继续上次对局" }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: "output/playtest/03-mid-battle.png" });
await page.locator('[data-action="collection"]').click();
await page.screenshot({ path: "output/playtest/04-armory.png" });
await page.locator('[data-action="close"]').click();
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(400);
await page.screenshot({ path: "output/playtest/06-1280x720.png" });
const report = {
  title: await page.title(),
  errors,
  webgl: await page.locator("#webgl canvas").count(),
  checks: [
    "faction selection",
    "mulligan",
    "end turn + AI",
    "reload + resume",
    "card search/detail",
    "100-game worker simulation",
    "deploy and resource cost",
    "frontline movement",
    "1600x1000 + 1280x720 layouts",
  ],
};
fs.writeFileSync(
  "output/playtest/browser-report.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
await browser.close();
if (errors.length) process.exitCode = 1;
