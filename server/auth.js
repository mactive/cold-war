const encoder = new TextEncoder();
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const unhex = (s) =>
  Uint8Array.from(s.match(/../g) ?? [], (v) => parseInt(v, 16));
export const randomToken = () =>
  hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (text) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
export function safeEqual(a, b) {
  const x = encoder.encode(a),
    y = encoder.encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  return JSON.stringify({
    salt: hex(salt),
    iterations: 100000,
    hash: hex(derived),
  });
}
export async function checkPassword(password, stored) {
  if (typeof password !== "string" || password.length > 256) return false;
  const { salt, iterations, hash } = JSON.parse(stored);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unhex(salt), iterations },
    key,
    256,
  );
  return safeEqual(hex(derived), hash);
}
export async function currentPassword(env) {
  const stored = await env.DB.prepare(
    "SELECT password_hash FROM admin_credentials WHERE id=1",
  ).first("password_hash");
  if (!stored && !env.ADMIN_PASSWORD_HASH)
    throw new HttpError(503, "管理员账号尚未配置");
  return stored || env.ADMIN_PASSWORD_HASH;
}
export const sessionCookie = (token, age = 28800) =>
  `__Host-coldwar_admin=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
export async function session(request, env) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("__Host-coldwar_admin="))
    ?.split("=")[1];
  if (!token || !/^[0-9a-f]{64}$/.test(token))
    throw new HttpError(401, "请先登录");
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    "SELECT csrf,expires_at FROM admin_sessions WHERE token_hash=?",
  )
    .bind(tokenHash)
    .first();
  if (!row || row.expires_at <= Date.now())
    throw new HttpError(401, "登录已过期，请重新登录");
  return { ...row, tokenHash };
}
export function sameOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError(403, "请求来源校验失败");
}
export function csrfCheck(request, auth) {
  if (!safeEqual(request.headers.get("x-csrf-token") ?? "", auth.csrf))
    throw new HttpError(403, "请求校验失败，请刷新后台后重试");
}
export async function jsonBody(request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "请使用JSON请求");
  if (Number(request.headers.get("content-length")) > 32768)
    throw new HttpError(413, "请求内容过大");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "请求内容为空");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      throw new HttpError(413, "请求内容过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body;
  } catch {
    throw new HttpError(400, "JSON格式无效");
  }
}
export async function checkLoginRate(request, env) {
  const now = Date.now(),
    key = await digest(
      request.headers.get("cf-connecting-ip") ?? "local-development",
    );
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts(key,attempts,expires_at) VALUES (?,1,?)
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
 expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING attempts`,
  )
    .bind(key, now + 15 * 60 * 1000, now, now, now + 15 * 60 * 1000)
    .first();
  if (row.attempts > 15)
    throw new HttpError(429, "尝试次数过多，请15分钟后再试");
  return key;
}
