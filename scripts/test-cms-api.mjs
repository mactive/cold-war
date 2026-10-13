import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const credentials = JSON.parse(
  fs.readFileSync(".local/cms-admin.json", "utf8"),
);
let cookie = "",
  csrf = "";
const checks = [];
async function request(
  path,
  {
    method = "GET",
    data,
    auth = true,
    origin = base,
    token = csrf,
    ...extra
  } = {},
) {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: {
      ...(method !== "GET"
        ? { Origin: origin, "Content-Type": "application/json" }
        : {}),
      ...(auth && cookie ? { Cookie: cookie, "X-CSRF-Token": token } : {}),
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await r.json();
  return { r, body };
}
assert.equal((await request("admin/content", { auth: false })).r.status, 401);
let login = await request("admin/login", {
  method: "POST",
  auth: false,
  data: { username: "admin", password: "wrong" },
});
assert.equal(login.r.status, 401);
login = await request("admin/login", {
  method: "POST",
  auth: false,
  data: { username: "admin", password: credentials.password },
});
assert.equal(login.r.status, 200, JSON.stringify(login.body));
cookie = login.r.headers.get("set-cookie").split(";")[0];
csrf = login.body.csrf;
assert.match(login.r.headers.get("set-cookie"), /HttpOnly/);
assert.match(login.r.headers.get("set-cookie"), /Secure/);
assert.match(login.r.headers.get("set-cookie"), /SameSite=Strict/);
checks.push(
  "anonymous rejection, password verification, secure session cookie",
);
const baseline = (await request("admin/content")).body;
try {
  const card = baseline.data.cards.find((x) => x.id === "N-11");
  assert.equal(
    (
      await request("admin/content/cards/N-11", {
        method: "PUT",
        token: "invalid",
        data: { revision: baseline.revision, data: card },
      })
    ).r.status,
    403,
  );
  assert.equal(
    (
      await request("admin/content/cards/N-11", {
        method: "PUT",
        origin: "https://untrusted.invalid",
        data: { revision: baseline.revision, data: card },
      })
    ).r.status,
    403,
  );
  assert.equal(
    (
      await request("admin/content/cards/N-11", {
        method: "PUT",
        data: { revision: baseline.revision, data: { ...card, cost: -1 } },
      })
    ).r.status,
    400,
  );
  assert.equal(
    (
      await request("admin/content/cards/N-11", {
        method: "PUT",
        data: {
          revision: baseline.revision,
          data: { ...card, effect: "arbitrary effect" },
        },
      })
    ).r.status,
    400,
  );
  checks.push("CSRF, cross-origin and invalid-rule edits rejected");
  const updates = await Promise.all(
    [1, 2].map((n) =>
      request("admin/content/cards/N-11", {
        method: "PUT",
        data: {
          revision: baseline.revision,
          data: { ...card, name: card.name + " 校验" + n },
        },
      }),
    ),
  );
  assert.deepEqual(updates.map((x) => x.r.status).sort(), [200, 409]);
  const published = (await request("content", { auth: false })).body;
  assert.equal(published.revision, baseline.revision + 1);
  assert.match(published.data.cards.find((c) => c.id === card.id).name, /校验/);
  assert.equal(
    (await request("admin/versions")).body.versions[0].revision,
    published.revision,
  );
  checks.push(
    "atomic concurrent edit conflict, public data and version history",
  );
  const restore = await request("admin/restore", {
    method: "POST",
    data: { revision: published.revision, targetRevision: baseline.revision },
  });
  assert.equal(restore.r.status, 200);
  assert.deepEqual(restore.body.data, baseline.data);
  checks.push("version restore");
  // Session removal must revoke even a copied cookie.
  await request("admin/logout", { method: "POST" });
  assert.equal((await request("admin/content")).r.status, 401);
  checks.push("logout revokes server session");
  const report = { base, checks, errors: [] };
  fs.writeFileSync(
    "output/playtest/cms-api-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
} catch (error) {
  const latest = (await request("admin/content")).body;
  if (latest.revision > baseline.revision)
    await request("admin/restore", {
      method: "POST",
      data: { revision: latest.revision, targetRevision: baseline.revision },
    });
  throw error;
}
