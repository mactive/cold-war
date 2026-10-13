import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
const base = "http://127.0.0.1:8787";
const rateTestIp = "2001:db8::" + randomBytes(2).toString("hex");
const original = JSON.parse(
  fs.readFileSync(".local/cms-admin.json", "utf8"),
).password;
let cookie = "",
  csrf = "";
async function call(path, data, ip = "203.0.113.17") {
  const r = await fetch(base + "/api/admin/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { r, body: await r.json() };
}
async function login(password) {
  const result = await call("login", { username: "admin", password });
  if (result.r.ok) {
    cookie = result.r.headers.get("set-cookie").split(";")[0];
    csrf = result.body.csrf;
  }
  return result;
}
assert.equal((await login(original)).r.status, 200);
assert.equal(
  (
    await call("password", {
      oldPassword: "wrong",
      newPassword: "valid-length-password",
    })
  ).r.status,
  400,
);
assert.equal(
  (await call("password", { oldPassword: original, newPassword: "short" })).r
    .status,
  400,
);
const next = randomBytes(24).toString("base64url");
let changed = false;
try {
  assert.equal(
    (await call("password", { oldPassword: original, newPassword: next })).r
      .status,
    200,
  );
  changed = true;
  assert.equal((await call("session")).r.status, 401);
  assert.equal((await login(original)).r.status, 401);
  assert.equal((await login(next)).r.status, 200);
  assert.equal(
    (await call("password", { oldPassword: next, newPassword: original })).r
      .status,
    200,
  );
  changed = false;
  assert.equal((await login(original)).r.status, 200);
  await call("logout", {});
  for (let i = 0; i < 15; i++)
    assert.equal(
      (
        await call(
          "login",
          { username: "admin", password: "bad" },
          rateTestIp,
        )
      ).r.status,
      401,
    );
  assert.equal(
    (
      await call(
        "login",
        { username: "admin", password: "bad" },
        rateTestIp,
      )
    ).r.status,
    429,
  );
  console.log({
    checks: [
      "incorrect current password rejected",
      "short new password rejected",
      "password rotation",
      "sessions revoked on rotation",
      "old password rejected after rotation",
      "new password works",
      "original password restored",
      "login rate limit",
    ],
    errors: [],
  });
} finally {
  if (changed) {
    await login(next);
    await call("password", { oldPassword: next, newPassword: original });
  }
}
