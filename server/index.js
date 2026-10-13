import { replaceRecord, validateContent } from "../src/content/schema.js";
import { multiplayerApi, adminRooms } from "./multiplayer.js";
import {
  HttpError,
  randomToken,
  digest,
  hashPassword,
  checkPassword,
  currentPassword,
  sessionCookie,
  session,
  sameOrigin,
  csrfCheck,
  jsonBody,
  checkLoginRate,
} from "./auth.js";
const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
async function readContent(env) {
  const row = await env.DB.prepare(
    "SELECT revision,data,updated_at FROM cms_content WHERE id=1",
  ).first();
  if (!row) throw new HttpError(503, "内容尚未初始化");
  return {
    revision: row.revision,
    data: JSON.parse(row.data),
    updatedAt: row.updated_at,
  };
}
async function updateContent(env, data, revision, note) {
  if (!Number.isInteger(revision) || revision < 1)
    throw new HttpError(400, "缺少有效的版本号");
  const row = await env.DB.prepare(
    "UPDATE cms_content SET data=?,revision=revision+1,change_note=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND revision=? RETURNING revision,updated_at",
  )
    .bind(JSON.stringify(data), note, revision)
    .first();
  if (!row)
    throw new HttpError(409, "内容已被其他窗口修改，请刷新数据后再保存");
  return { revision: row.revision, data, updatedAt: row.updated_at };
}
async function api(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/content" && request.method === "GET")
    return json(await readContent(env));
  if (!path.startsWith("/api/admin/")) throw new HttpError(404, "接口不存在");
  const write = !["GET", "HEAD"].includes(request.method);
  if (write) sameOrigin(request);
  if (path === "/api/admin/login" && request.method === "POST") {
    const key = await checkLoginRate(request, env),
      body = await jsonBody(request);
    const valid = await checkPassword(
      body.password,
      await currentPassword(env),
    );
    if (body.username !== "admin" || !valid)
      throw new HttpError(401, "账号或密码错误");
    const token = randomToken(),
      csrf = randomToken(),
      now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=?").bind(
        now,
      ),
      env.DB.prepare(
        "DELETE FROM login_attempts WHERE key=? OR expires_at<=?",
      ).bind(key, now),
      env.DB.prepare("INSERT INTO admin_sessions VALUES (?,?,?)").bind(
        await digest(token),
        csrf,
        now + 8 * 60 * 60 * 1000,
      ),
    ]);
    return json({ authenticated: true, csrf }, 200, {
      "Set-Cookie": sessionCookie(token),
    });
  }
  const auth = await session(request, env);
  if (write) csrfCheck(request, auth);
  if (path.startsWith("/api/admin/rooms"))
    return (
      (await adminRooms(request, env)) ?? json({ error: "接口不存在" }, 404)
    );
  if (path === "/api/admin/session" && request.method === "GET")
    return json({ authenticated: true, csrf: auth.csrf });
  if (path === "/api/admin/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?")
      .bind(auth.tokenHash)
      .run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }
  if (path === "/api/admin/password" && request.method === "POST") {
    await checkLoginRate(request, env);
    const body = await jsonBody(request);
    if (
      typeof body.newPassword !== "string" ||
      body.newPassword.length < 12 ||
      body.newPassword.length > 256
    )
      throw new HttpError(400, "新密码须为12—256个字符");
    if (!(await checkPassword(body.oldPassword, await currentPassword(env))))
      throw new HttpError(400, "当前密码错误");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO admin_credentials VALUES(1,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash",
      ).bind(await hashPassword(body.newPassword)),
      env.DB.prepare("DELETE FROM admin_sessions"),
    ]);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }
  if (path === "/api/admin/content" && request.method === "GET")
    return json(await readContent(env));
  if (path === "/api/admin/versions" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT revision,change_note AS note,created_at AS createdAt FROM cms_versions ORDER BY revision DESC LIMIT 100",
    ).all();
    return json({ versions: rows.results });
  }
  const match = path.match(
    /^\/api\/admin\/content\/(cards|tokens|factions|decks|strategies)\/([A-Za-z0-9-]+)$/,
  );
  if (match && request.method === "PUT") {
    const body = await jsonBody(request),
      current = await readContent(env);
    let data;
    try {
      data = replaceRecord(current.data, match[1], match[2], body.data);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    return json(
      await updateContent(
        env,
        data,
        body.revision,
        `修改 ${match[1]} / ${match[2]} / ${body.data.name}`,
      ),
    );
  }
  if (path === "/api/admin/restore" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!Number.isInteger(body.targetRevision))
      throw new HttpError(400, "版本号无效");
    const stored = await env.DB.prepare(
      "SELECT data FROM cms_versions WHERE revision=?",
    )
      .bind(body.targetRevision)
      .first("data");
    if (!stored) throw new HttpError(404, "找不到这个历史版本");
    let data;
    try {
      data = validateContent(JSON.parse(stored));
    } catch {
      throw new HttpError(400, "历史版本与当前规则不兼容");
    }
    return json(
      await updateContent(
        env,
        data,
        body.revision,
        `恢复至版本 v${body.targetRevision}`,
      ),
    );
  }
  throw new HttpError(404, "接口不存在");
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (/^\/api\/(player|rooms)(\/|$)/.test(url.pathname))
        return await multiplayerApi(request, {
          ...env,
          DB: env.DB.withSession("first-primary"),
        });
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        if (request.method !== "GET" && request.method !== "HEAD")
          return new Response("Method not allowed", { status: 405 });
        const assetUrl = new URL("/admin/", url);
        const response = await env.ASSETS.fetch(new Request(assetUrl, request));
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("X-Frame-Options", "DENY");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "same-origin");
        headers.set(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        );
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError)
        return json(
          { error: e.message },
          e.status,
          e.status === 429 ? { "Retry-After": "900" } : {},
        );
      console.error("CMS request failed", e.name);
      return json({ error: "服务暂时不可用，请稍后重试" }, 500);
    }
  },
};
