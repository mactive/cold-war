import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import * as E from "../src/game/engine.js";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173/");
function fixture(front = true) {
  const s = E.createGame({ seed: 12, skipMulligan: true });
  s.players.forEach((p) => {
    p.hand = [];
    p.rear = [];
    p.maxK = p.k = 12;
  });
  s.front = [];
  const tank = E.addUnit(s, "N-11", 0, {
    row: front ? "front" : "rear",
    ready: true,
  });
  return { s, tank };
}
async function load(s) {
  await page.evaluate(
    (s) => localStorage.setItem("iron-front-save-v1", JSON.stringify(s)),
    s,
  );
  await page.reload();
  await page.getByRole("button", { name: "继续上次对局" }).click();
}
async function center(id) {
  const r = await page.locator(`[data-target="${id}"]`).boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
async function begin(id) {
  const a = await center(id);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
}
async function aim(id) {
  const b = await center(id);
  await page.mouse.move(b.x, b.y, { steps: 14 });
}
async function idle() {
  await expect(page.locator("body")).not.toHaveClass(/combat-busy/);
}
// Press highlights HQ immediately; holding and aiming never resolves damage.
let { s, tank } = fixture();
await load(s);
await begin(tank.uid);
await expect(page.locator('[data-target="hq1"]')).toHaveClass(/targetable/);
await aim("hq1");
await expect(page.locator(".aim-overlay")).toBeVisible();
await expect(page.locator('[data-target="hq1"]')).toHaveClass(/drop-target/);
expect(await page.evaluate(() => __IRON_FRONT__.state.players[1].hp)).toBe(20);
await page.screenshot({ path: "output/playtest/08-drag-aim.png" });
await page.mouse.up();
await expect(page.locator(".aim-overlay")).toBeHidden();
await expect(page.locator(".combat-overlay")).toHaveAttribute(
  "data-phase",
  "flight",
);
expect(await page.evaluate(() => __IRON_FRONT__.state.players[1].hp)).toBe(20);
await page.keyboard.press("Space");
expect(await page.evaluate(() => __IRON_FRONT__.state.active)).toBe(0);
// End-turn clicks during flight cannot advance the turn or race the delayed hit.
await page.locator('[data-action="end"]').click({ force: true });
expect(await page.evaluate(() => __IRON_FRONT__.state.active)).toBe(0);
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[1].hp))
  .toBe(16);
await page.screenshot({ path: "output/playtest/09-drag-impact.png" });
await idle();
expect(await page.evaluate(() => __IRON_FRONT__.state.players[0].k)).toBe(11);
// Reload persists exactly one shot, including spent action/resource.
await page.reload();
await page.getByRole("button", { name: "继续上次对局" }).click();
expect(await page.evaluate(() => __IRON_FRONT__.state.players[1].hp)).toBe(16);
// Empty-space release and Escape both cancel with zero state changes.
({ s, tank } = fixture());
await load(s);
await begin(tank.uid);
await page.mouse.move(8, 85, { steps: 8 });
await page.mouse.up();
expect(await page.evaluate(() => __IRON_FRONT__.state.players[0].k)).toBe(12);
expect(await page.evaluate(() => __IRON_FRONT__.state.players[1].hp)).toBe(20);
await page.waitForTimeout(360);
await begin(tank.uid);
await aim("hq1");
await page.keyboard.press("Escape");
await page.mouse.up();
await expect(page.locator(".aim-overlay")).toBeHidden();
expect(await page.evaluate(() => __IRON_FRONT__.state.players[1].hp)).toBe(20);
// Guarded target is rejected; adjacent guards themselves remain valid drop targets.
({ s, tank } = fixture(false));
const g = E.addUnit(s, "W-01", 1, { row: "front", ready: true });
const reserve = E.addUnit(s, "W-T1", 1, { row: "front", ready: true });
await load(s);
await begin(tank.uid);
await aim(reserve.uid);
await page.mouse.up();
expect(await page.evaluate(() => __IRON_FRONT__.state.players[0].k)).toBe(12);
await page.waitForTimeout(360);
await begin(tank.uid);
await aim(g.uid);
await page.mouse.up();
await expect(page.locator(`[data-target="${g.uid}"]`)).toHaveCount(0);
await idle();
// Clicking still works; a source tap must not consume the attack.
({ s, tank } = fixture());
await load(s);
await page.locator(`[data-target="${tank.uid}"]`).click();
await page.locator('[data-target="hq1"]').click();
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[1].hp))
  .toBe(16);
await idle();
// Narrow desktop keeps arrow endpoints aligned to actual card/HQ positions.
await page.setViewportSize({ width: 1280, height: 720 });
({ s, tank } = fixture());
await load(s);
await begin(tank.uid);
await aim("hq1");
await expect(page.locator('[data-target="hq1"]')).toHaveClass(/drop-target/);
await page.screenshot({ path: "output/playtest/10-drag-1280.png" });
await page.mouse.up();
await idle();
expect(await page.evaluate(() => __IRON_FRONT__.state.players[1].hp)).toBe(16);
// AI uses the same shot/impact path.
({ s, tank } = fixture());
s.front = [];
s.active = 1;
E.addUnit(s, "W-16", 1, { row: "front", ready: true });
await load(s);
await expect
  .poll(() => page.evaluate(() => __IRON_FRONT__.state.players[0].hp))
  .toBeLessThan(20);
await idle();
const report = {
  errors,
  checks: [
    "press highlights HQ",
    "curved aiming and snap",
    "hold does not attack",
    "release flight then impact damage",
    "busy blocks end turn",
    "one attack saved across reload",
    "empty release cancels",
    "Escape cancels",
    "guard target validation",
    "click compatibility",
    "1280x720 alignment",
    "keyboard blocked during flight",
    "AI projectile and impact",
  ],
};
fs.writeFileSync(
  "output/playtest/browser-drag-report.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
await browser.close();
if (errors.length) process.exitCode = 1;
