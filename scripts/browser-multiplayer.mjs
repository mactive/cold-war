import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { rulesFor } from "../src/game/multiplayer.js";
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const browser = await chromium.launch({ headless: true, channel: "chrome" }),
  errors = [],
  checks = [];
const ca = await browser.newContext({ viewport: { width: 1440, height: 960 } }),
  cb = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const a = await ca.newPage(),
  b = await cb.newPage();
for (const p of [a, b]) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
}
async function identity(page, name) {
  await page.locator("#player-name").fill(name);
  await page.locator('[data-action="identity-create"]').click();
  await expect(page.locator('[data-action="room-create"]')).toBeVisible();
}
async function room(page) {
  return page.evaluate(async () => {
    const p = JSON.parse(localStorage.getItem("iron-front-identity-v1")),
      id = JSON.parse(localStorage.getItem("iron-front-room-v1"));
    return (
      await fetch("/api/rooms/" + id, {
        headers: { Authorization: "Bearer " + p.token },
      })
    ).json();
  });
}
try {
  await a.goto(base);
  await a.locator('[data-action="lobby"]').click();
  await identity(a, "验收·浏览器甲");
  await a.locator('[data-action="room-create"]').click();
  await expect(a.locator("#invite-link")).toBeVisible();
  const link = await a.locator("#invite-link").inputValue();
  const id = new URL(link).searchParams.get("room");
  await a.screenshot({ path: "output/playtest/multiplayer-invite.png" });
  await b.goto(link);
  await identity(b, "验收·浏览器乙");
  await b.locator('[data-action="room-join"]').click();
  await expect(a.locator(".modal.mulligan")).toBeVisible({ timeout: 15000 });
  await expect(b.locator(".modal.mulligan")).toBeVisible();
  const ar = await room(a),
    br = await room(b);
  expect(ar.state.players[0].faction).not.toBe(br.state.players[0].faction);
  expect(ar.seat).toBe(0);
  expect(br.seat).toBe(1);
  checks.push(
    "two independent browser identities, share link, opposite random factions",
  );
  await a.locator('[data-action="start-battle"]').click();
  await expect(a.locator(".modal.room-wait")).toBeVisible();
  await b.locator('[data-action="start-battle"]').click();
  await expect(a.locator(".modal")).toHaveCount(0, { timeout: 15000 });
  await expect(b.locator(".modal")).toHaveCount(0);
  checks.push("both players confirm opening hands");
  let deployed = new Set(),
    attacked = false,
    moved = false;
  for (let i = 0; i < 35 && (!attacked || deployed.size < 2); i++) {
    const snap = await room(a),
      p = snap.state.active === 0 ? a : b;
    await expect(p.locator('[data-action="end"]')).toBeEnabled({
      timeout: 15000,
    });
    const current = await room(p),
      E = rulesFor(current.state.content),
      s = current.state;
    const attacker = E.units(s, 0).find((u) => E.attackTargets(s, u).length);
    if (attacker && !attacked) {
      const target = E.attackTargets(s, attacker)[0];
      const from = await p
          .locator(`[data-uid="${attacker.uid}"]`)
          .boundingBox(),
        to = await p.locator(`[data-uid="${target.uid}"]`).boundingBox();
      await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await p.mouse.down();
      await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
        steps: 15,
      });
      await expect(p.locator(".aim-overlay")).toBeVisible();
      await p.mouse.up();
      await expect
        .poll(async () => (await room(p)).revision)
        .toBeGreaterThan(current.revision);
      await expect(p.locator("body")).not.toHaveClass(/combat-busy/);
      attacked = true;
      checks.push("drag attack settles on server and synchronizes damage");
      continue;
    }
    const hand = s.players[0].hand.find(
      (h) =>
        E.def(h).attack !== null &&
        E.canPlay(s, 0, h) &&
        E.targetGroups(s, 0, h).length === 0,
    );
    if (hand && !deployed.has(current.seat)) {
      await p.locator(`[data-hand="${hand.uid}"]`).click();
      await p.locator('[data-action="use-card"]').click();
      await expect
        .poll(async () => (await room(p)).revision)
        .toBeGreaterThan(current.revision);
      deployed.add(current.seat);
      continue;
    }
    const unit = E.units(s, 0).find((u) => E.canMove(s, u));
    if (unit && !moved) {
      await p.locator(`[data-uid="${unit.uid}"]`).click();
      await p.locator('[data-action="move-selected"]').click();
      await expect
        .poll(async () => (await room(p)).revision)
        .toBeGreaterThan(current.revision);
      moved = true;
      continue;
    }
    await p.locator('[data-action="end"]').click();
    await expect
      .poll(async () => (await room(p)).revision)
      .toBeGreaterThan(current.revision);
  }
  expect(deployed.size).toBe(2);
  expect(attacked).toBe(true);
  checks.push(
    "both players deploy, pass turns, move and share authoritative board",
  );
  await a.screenshot({ path: "output/playtest/multiplayer-battle.png" });
  const before = await room(a);
  await a.reload();
  await expect(a.locator("#network-status")).toBeVisible();
  expect((await room(a)).revision).toBe(before.revision);
  checks.push("refresh resumes room and browser identity");
  await cb.setOffline(true);
  await expect(b.locator("#network-status")).toContainText("中断", {
    timeout: 15000,
  });
  await cb.setOffline(false);
  await expect(b.locator("#network-status")).toHaveText("已同步", {
    timeout: 15000,
  });
  checks.push("network loss reports and reconnects automatically");
  await b.locator('[data-action="menu"]').click();
  await b.locator('[data-action="room-resign"]').click();
  await expect(a.locator(".modal.result")).toContainText("任务完成", {
    timeout: 15000,
  });
  await expect(b.locator(".modal.result")).toContainText("本局失利");
  expect((await room(a)).score).toEqual([3, 0]);
  checks.push("resign, winner, points synchronized to both players");
  await a.locator('[data-action="room-back"]').click();
  await expect(a.locator(".identity-strip")).toContainText("3 分");
  await a.locator('[data-action="identity-logout"]').click();
  await expect(a.locator("#player-name")).toBeVisible();
  expect(
    await a.evaluate(() => localStorage.getItem("iron-front-identity-v1")),
  ).toBeNull();
  checks.push("manual logout clears and revokes browser identity");
  const admin = await ca.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(base + "/admin");
  const creds = JSON.parse(fs.readFileSync(".local/cms-admin.json", "utf8"));
  await admin.locator('[name="password"]').fill(creds.password);
  await admin.getByRole("button", { name: "进入指挥档案库" }).click();
  await admin.locator('[data-view="rooms"]').click();
  await admin.locator(`[data-room-detail="${id}"]`).click();
  await admin.locator("[data-room-verify]").click();
  await expect(admin.locator(".verification-pass")).toContainText("校验通过");
  await admin.screenshot({ path: "output/playtest/multiplayer-admin.png" });
  checks.push(
    "admin lists room, logs, final score and full replay verification",
  );
  expect(errors).toEqual([]);
  const report = { base, roomId: id, checks, errors };
  fs.writeFileSync(
    "output/playtest/multiplayer-browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} catch (e) {
  console.log({
    errors,
    a: await a.locator(".modal").allTextContents(),
    b: await b.locator(".modal").allTextContents(),
  });
  throw e;
} finally {
  await browser.close();
}
