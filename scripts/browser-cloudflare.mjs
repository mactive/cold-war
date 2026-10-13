import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import * as E from "../src/game/engine.js";
const url = process.argv[2] ?? "https://cold-war.mactive.workers.dev/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
try {
  const response = await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  expect(response.status()).toBe(200);
  await page.getByRole("button", { name: "开始部署" }).click();
  await page.getByRole("button", { name: "保留全部 · 进入战场" }).click();
  await expect(page.locator(".battlefield")).toBeVisible();
  expect(await page.evaluate(() => typeof window.__IRON_FRONT__)).toBe(
    "undefined",
  );
  await expect.poll(() => page.locator("#webgl canvas").count()).toBe(1);
  const s = E.createGame({ seed: 12, skipMulligan: true });
  s.players.forEach((p) => {
    p.hand = [];
    p.rear = [];
    p.maxK = p.k = 12;
  });
  s.front = [];
  const tank = E.addUnit(s, "N-11", 0, { row: "front", ready: true });
  await page.evaluate(
    (s) => localStorage.setItem("iron-front-save-v1", JSON.stringify(s)),
    s,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "继续上次对局" }).click();
  const a = await page.locator(`[data-target="${tank.uid}"]`).boundingBox();
  const b = await page.locator('[data-target="hq1"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await expect(page.locator(".aim-overlay")).toBeVisible();
  await page.screenshot({ path: "output/playtest/cloudflare-aim.png" });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("iron-front-save-v1")).players[1].hp,
      ),
    )
    .toBe(16);
  await expect(page.locator("body")).not.toHaveClass(/combat-busy/);
  await page.locator('[data-action="menu"]').click();
  await page.getByRole("button", { name: "运行100局自动模拟" }).click();
  await expect(page.locator("#sim-status")).toContainText("完成 100 / 100");
  await expect(page.locator("#sim-status")).toContainText("0 个错误");
  const report = {
    url,
    status: response.status(),
    date: new Date().toISOString(),
    errors,
    checks: [
      "production page and assets",
      "start battle",
      "WebGL canvas",
      "no dev debug API",
      "drag HQ attack and local save",
      "100-game production worker",
    ],
  };
  fs.writeFileSync(
    "output/playtest/cloudflare-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
