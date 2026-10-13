import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const credentials = JSON.parse(
  fs.readFileSync(".local/cms-admin.json", "utf8"),
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
let original;
try {
  const publicResponse = await page.request.get(base + "/api/content");
  original = await publicResponse.json();
  const response = await page.goto(base + "/admin");
  expect(response.status()).toBe(200);
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator('[name="password"]').fill(credentials.password);
  await page.getByRole("button", { name: "进入指挥档案库" }).click();
  await expect(
    page.getByRole("heading", { name: "战场资料总览" }),
  ).toBeVisible();
  await page.screenshot({ path: "output/playtest/cms-overview.png" });
  // Persist a card change through the actual form.
  await page.locator('nav [data-view="cards"]').click();
  await page.locator("#search").fill("M60A3");
  await page.locator('[data-record="N-11"]').click();
  await page.locator('[name="cost"]').fill("5");
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(page.locator("#notice")).toContainText("已发布");
  let published = await (await page.request.get(base + "/api/content")).json();
  expect(published.data.cards.find((c) => c.id === "N-11").cost).toBe(5);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "战场资料总览" }),
  ).toBeVisible();
  await page.locator('nav [data-view="cards"]').click();
  await page.locator('[data-record="N-11"]').click();
  await expect(page.locator('[name="cost"]')).toHaveValue("5");
  await page.screenshot({ path: "output/playtest/cms-card-editor.png" });
  // Game fetches the published content and saves a versioned match snapshot.
  const game = await context.newPage();
  await game.goto(base + "/");
  await game.getByRole("button", { name: "开始部署" }).click();
  await game.getByRole("button", { name: "保留全部 · 进入战场" }).click();
  const saved = await game.evaluate(() =>
    JSON.parse(localStorage.getItem("iron-front-save-v1")),
  );
  expect(saved.content.revision).toBe(published.revision);
  expect(saved.content.data.cards.find((c) => c.id === "N-11").cost).toBe(5);
  // AI weights and faction copy are editable; special-rule text stays readonly.
  await expect(page.locator('[name="effect"]')).toHaveAttribute("readonly", "");
  await page.locator('nav [data-view="strategies"]').click();
  await page.locator('[data-record="N-ai"]').click();
  await page.locator('[name="weights.deployBase"]').fill("3.5");
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(page.locator("#notice")).toContainText("已发布");
  published = await (await page.request.get(base + "/api/content")).json();
  expect(published.data.strategies[0].weights.deployBase).toBe(3.5);
  await page.locator('nav [data-view="factions"]').click();
  await page.locator('[data-record="N"]').click();
  await page.locator('[name="tagline"]').fill("侦察 · 空地协同 · 联合指挥");
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(page.locator("#notice")).toContainText("已发布");
  // Invalid deck cannot be published.
  await page.locator('nav [data-view="decks"]').click();
  await page.locator('[data-record="N-starter"]').click();
  const n = await page.locator('[data-card-count="N-01"]').inputValue();
  await page.locator('[data-card-count="N-01"]').fill(String(Number(n) - 1));
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(page.locator("#notice")).toContainText("39张");
  await page.getByRole("button", { name: "放弃修改" }).click();
  // Restore through UI; prior saved match still retains its original content.
  await page.locator('nav [data-view="history"]').click();
  await page.locator(`[data-restore="${original.revision}"]`).click();
  await expect(page.locator("#notice")).toContainText("已恢复");
  const restored = await (await page.request.get(base + "/api/content")).json();
  expect(restored.data).toEqual(original.data);
  await game.reload();
  await game.getByRole("button", { name: "继续上次对局" }).click();
  const resumed = await game.evaluate(() =>
    JSON.parse(localStorage.getItem("iron-front-save-v1")),
  );
  expect(resumed.content.revision).toBe(saved.content.revision);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.locator('nav [data-view="overview"]').click();
  await page.screenshot({ path: "output/playtest/cms-1100.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('[data-action="logout"]').click();
  await expect(page.locator("#login-form")).toBeVisible();
  expect((await page.request.get(base + "/api/admin/content")).status()).toBe(
    401,
  );
  const report = {
    base,
    checks: [
      "admin login and session persistence",
      "card edit and D1 persistence",
      "game consumes cloud config",
      "special effect readonly",
      "AI weights update",
      "faction edit",
      "invalid deck rejected",
      "version restore",
      "old match snapshot preserved",
      "1100px layout",
      "logout protection",
    ],
    errors,
  };
  fs.writeFileSync(
    "output/playtest/cms-browser-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
  expect(errors).toEqual([]);
} finally {
  // If a UI assertion fails after a write, restore the original payload by version.
  if (original) {
    const session = await page.request.get(base + "/api/admin/session");
    if (session.ok()) {
      const { csrf } = await session.json();
      const current = await (
        await page.request.get(base + "/api/content")
      ).json();
      if (JSON.stringify(current.data) !== JSON.stringify(original.data))
        await page.request.post(base + "/api/admin/restore", {
          headers: { Origin: base, "X-CSRF-Token": csrf },
          data: {
            revision: current.revision,
            targetRevision: original.revision,
          },
        });
    }
  }
  await browser.close();
}
