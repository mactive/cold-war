import {
  HttpError,
  randomToken,
  digest,
  jsonBody,
  sameOrigin,
} from "./auth.js";
import {
  rulesFor,
  cleanAction,
  applyCommand,
  playerView,
  orientAction,
  summary,
  resultPoints,
} from "../src/game/multiplayer.js";
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const now = () => Date.now();
const parseRoom = (r) => ({
  ...r,
  state: r.state ? JSON.parse(r.state) : null,
  content: JSON.parse(r.content),
  last_event: JSON.parse(r.last_event),
});
const seatOf = (r, id) => (r.host_id === id ? 0 : r.guest_id === id ? 1 : -1);
async function rate(env, key, max, ms) {
  const t = now();
  const row = await env.DB.prepare(
    "INSERT INTO multiplayer_rate(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count",
  )
    .bind(key, t + ms, t, t, t + ms)
    .first();
  if (row.count > max) throw new HttpError(429, "操作过于频繁，请稍后重试");
}
async function identity(request, env) {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
  if (!token) throw new HttpError(401, "请先建立玩家身份");
  const p = await env.DB.prepare(
    "SELECT id,name FROM players WHERE token_hash=? AND revoked_at IS NULL",
  )
    .bind(await digest(token))
    .first();
  if (!p) throw new HttpError(401, "身份已注销，请重新建立身份");
  return p;
}
async function readRoom(env, id) {
  const r = await env.DB.prepare("SELECT * FROM rooms WHERE id=?")
    .bind(id)
    .first();
  if (!r) throw new HttpError(404, "房间不存在");
  return parseRoom(r);
}
async function reject(env, r, p, reason, action) {
  await env.DB.prepare(
    "INSERT INTO room_rejections(room_id,actor_id,reason,action,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      r.id,
      p.id,
      reason,
      JSON.stringify(action ?? {}).slice(0, 2048),
      now(),
    )
    .run();
}
async function commit(
  env,
  r,
  p,
  {
    state = r.state,
    status = r.status,
    guest = r.guest_id,
    initial = null,
    event,
  },
) {
  const t = now();
  event.actorId = p?.id ?? null;
  event.beforeHash = r.state ? await digest(JSON.stringify(r.state)) : null;
  event.afterHash = state ? await digest(JSON.stringify(state)) : null;
  if (state)
    event.result = {
      hq: state.players.map((x) => x.hp),
      points: status === "finished" ? resultPoints(state) : [0, 0],
      winner: state.winner,
    };
  const row = await env.DB.prepare(
    `UPDATE rooms SET state=?,status=?,guest_id=?,initial_state=COALESCE(initial_state,?),revision=revision+1,last_event=?,updated_at=?,expires_at=? WHERE id=? AND revision=? ${p ? "AND EXISTS(SELECT 1 FROM players WHERE id=? AND revoked_at IS NULL)" : ""} RETURNING id`,
  )
    .bind(
      state ? JSON.stringify(state) : null,
      status,
      guest,
      initial ? JSON.stringify(initial) : null,
      JSON.stringify(event),
      t,
      t + 86400000,
      r.id,
      r.revision,
      ...(p ? [p.id] : []),
    )
    .first();
  if (!row) throw new HttpError(409, "房间状态已变化，请同步后重试");
  return readRoom(env, r.id);
}
async function settleLifecycle(env, r) {
  if (["finished", "closed"].includes(r.status)) return r;
  if (r.expires_at <= now()) {
    try {
      return await commit(env, r, null, {
        status: "closed",
        event: { kind: "expired", requestId: crypto.randomUUID() },
      });
    } catch (e) {
      if (e.status === 409) return readRoom(env, r.id);
      throw e;
    }
  }
  const revoked = (
    await env.DB.prepare(
      "SELECT id FROM players WHERE id IN (?,?) AND revoked_at IS NOT NULL",
    )
      .bind(r.host_id, r.guest_id ?? "")
      .all()
  ).results;
  if (!revoked.length) return r;
  const seat = seatOf(r, revoked[0].id),
    state = structuredClone(r.state);
  if (state && state.winner === null)
    applyCommand(rulesFor(r.content), state, seat, { kind: "resign" });
  try {
    return await commit(env, r, null, {
      state,
      status: state ? "finished" : "closed",
      event: {
        kind: "identity-revoked",
        seat,
        action: { kind: "resign" },
        requestId: crypto.randomUUID(),
      },
    });
  } catch (e) {
    if (e.status === 409) return readRoom(env, r.id);
    throw e;
  }
}
async function roomView(env, r, p) {
  const seat = seatOf(r, p.id);
  if (seat < 0) throw new HttpError(403, "你不是这个房间的参战玩家");
  const rows = (
    await env.DB.prepare(
      "SELECT id,name,revoked_at FROM players WHERE id IN (?,?)",
    )
      .bind(r.host_id, r.guest_id ?? "")
      .all()
  ).results;
  const players = [r.host_id, r.guest_id].map((id, i) =>
    id
      ? {
          id,
          name: rows.find((x) => x.id === id)?.name ?? "指挥官",
          faction: r.state?.players[i].faction ?? null,
          revoked: !!rows.find((x) => x.id === id)?.revoked_at,
        }
      : null,
  );
  return {
    id: r.id,
    revision: r.revision,
    status: r.status,
    seat,
    players,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
    state: r.state ? playerView(r.state, seat) : null,
    lastAction: r.last_event.action
      ? orientAction(r.last_event.action, seat)
      : null,
    lastActor: r.last_event.actorId ?? null,
    score: r.status === "finished" ? resultPoints(r.state) : [0, 0],
  };
}
async function stats(env, p) {
  const rows = (
    await env.DB.prepare(
      "SELECT host_id,state FROM rooms WHERE (host_id=? OR guest_id=?) AND status='finished'",
    )
      .bind(p.id, p.id)
      .all()
  ).results;
  let wins = 0,
    draws = 0,
    losses = 0;
  for (const r of rows) {
    const winner = JSON.parse(r.state).winner,
      seat = r.host_id === p.id ? 0 : 1;
    if (winner === "draw") draws++;
    else if (winner === seat) wins++;
    else losses++;
  }
  return { wins, draws, losses, points: wins * 3 + draws };
}
export async function multiplayerApi(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (method !== "GET") sameOrigin(request);
  if (path === "/api/player" && method === "POST") {
    await rate(
      env,
      "identity:" + request.headers.get("CF-Connecting-IP"),
      20,
      3600000,
    );
    const b = await jsonBody(request),
      name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 1 || name.length > 24)
      throw new HttpError(400, "昵称须为1—24个字符");
    const token = randomToken(),
      id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO players(id,token_hash,name,created_at) VALUES(?,?,?,?)",
    )
      .bind(id, await digest(token), name, now())
      .run();
    return json({ id, name, token }, 201);
  }
  const p = await identity(request, env);
  if (method !== "GET") await rate(env, "action:" + p.id, 180, 60000);
  if (path === "/api/player" && method === "GET")
    return json({ ...p, stats: await stats(env, p) });
  if (path === "/api/player/logout" && method === "POST") {
    await env.DB.prepare("UPDATE players SET revoked_at=? WHERE id=?")
      .bind(now(), p.id)
      .run();
    const rows = (
      await env.DB.prepare(
        "SELECT id FROM rooms WHERE (host_id=? OR guest_id=?) AND status NOT IN ('closed','finished')",
      )
        .bind(p.id, p.id)
        .all()
    ).results;
    for (const row of rows)
      await settleLifecycle(env, await readRoom(env, row.id));
    return json({ ok: true });
  }
  if (path === "/api/rooms" && method === "GET") {
    const rows = (
      await env.DB.prepare(
        "SELECT id,status,revision,host_id,guest_id,updated_at FROM rooms WHERE host_id=? OR guest_id=? ORDER BY updated_at DESC LIMIT 30",
      )
        .bind(p.id, p.id)
        .all()
    ).results;
    return json({ rooms: rows });
  }
  if (path === "/api/rooms" && method === "POST") {
    await rate(env, "create:" + p.id, 12, 3600000);
    const active = await env.DB.prepare(
      "SELECT count(*) AS n FROM rooms WHERE host_id=? AND status NOT IN ('finished','closed') AND expires_at>?",
    )
      .bind(p.id, now())
      .first();
    if (active.n >= 4)
      throw new HttpError(400, "最多保留4个未结束房间，请先关闭或完成已有房间");
    const row = await env.DB.prepare(
      "SELECT revision,data FROM cms_content WHERE id=1",
    ).first();
    const content = { revision: row.revision, data: JSON.parse(row.data) },
      id = crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      t = now();
    await env.DB.prepare(
      "INSERT INTO rooms(id,host_id,status,content,last_event,created_at,updated_at,expires_at) SELECT ?,?,'waiting',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM players WHERE id=? AND revoked_at IS NULL)",
    )
      .bind(
        id,
        p.id,
        JSON.stringify(content),
        JSON.stringify({
          kind: "create",
          actorId: p.id,
          requestId: crypto.randomUUID(),
        }),
        t,
        t,
        t + 86400000,
        p.id,
      )
      .run();
    return json(await roomView(env, await readRoom(env, id), p), 201);
  }
  const match = path.match(
    /^\/api\/rooms\/([a-f0-9]{16})(?:\/(join|actions|close))?$/,
  );
  if (!match) throw new HttpError(404, "接口不存在");
  let r = await settleLifecycle(env, await readRoom(env, match[1]));
  const mode = match[2];
  if (mode === "join" && method === "POST") {
    if (seatOf(r, p.id) >= 0) return json(await roomView(env, r, p));
    if (r.status !== "waiting" || r.guest_id)
      throw new HttpError(409, "房间已满或已关闭");
    const bytes = crypto.getRandomValues(new Uint32Array(3)),
      E = rulesFor(r.content);
    const state = E.createGame({
      faction: bytes[0] % 2 ? "N" : "W",
      seed: bytes[1],
      multiplayer: true,
      firstPlayer: bytes[2] % 2,
    });
    // Opening hand sizes follow the randomly selected first player.
    if (state.firstPlayer === 1) {
      const c = state.players[1].hand.pop();
      state.players[1].deck.push(c.cardId);
      E.draw(state, 0);
    }
    r = await commit(env, r, p, {
      state,
      status: "mulligan",
      guest: p.id,
      initial: state,
      event: { kind: "join", requestId: crypto.randomUUID() },
    });
    return json(await roomView(env, r, p));
  }
  if (seatOf(r, p.id) < 0) throw new HttpError(403, "你不是这个房间的参战玩家");
  if (!mode && method === "GET") {
    if (Number(url.searchParams.get("since")) === r.revision)
      return json({ unchanged: true, revision: r.revision, status: r.status });
    return json(await roomView(env, r, p));
  }
  if (mode === "close" && method === "POST") {
    if (r.host_id !== p.id || r.status !== "waiting")
      throw new HttpError(400, "只能关闭自己尚未开始的房间");
    r = await commit(env, r, p, {
      status: "closed",
      event: { kind: "close", requestId: crypto.randomUUID() },
    });
    return json(await roomView(env, r, p));
  }
  if (mode === "actions" && method === "POST") {
    const body = await jsonBody(request);
    try {
      if (
        typeof body.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId)
      )
        throw new HttpError(400, "缺少操作唯一编号");
      const action = cleanAction(body.action);
      const duplicate = await env.DB.prepare(
        "SELECT actor_id,payload FROM room_events WHERE room_id=? AND request_id=?",
      )
        .bind(r.id, body.requestId)
        .first();
      if (duplicate) {
        if (
          duplicate.actor_id !== p.id ||
          JSON.stringify(JSON.parse(duplicate.payload).action) !==
            JSON.stringify(action)
        )
          throw new HttpError(409, "操作编号已被使用");
        return json(await roomView(env, r, p));
      }
      if (body.revision !== r.revision)
        throw new HttpError(409, "对局已更新，正在重新同步");
      if (!r.state || !["play", "mulligan"].includes(r.status))
        throw new HttpError(400, "房间尚未开始或已经结束");
      const state = structuredClone(r.state),
        seat = seatOf(r, p.id);
      const previousLogs = new Set(state.logs);
      applyCommand(rulesFor(r.content), state, seat, action);
      const calculated = summary(state, seat),
        prediction = body.prediction;
      const event = {
        kind: "action",
        requestId: body.requestId,
        seat,
        action,
        combatLogs: state.logs.filter((entry) => !previousLogs.has(entry)),
        serverCalculated: calculated,
        clientPrediction: prediction
          ? { hp: prediction.hp, k: prediction.k, points: prediction.points }
          : null,
        predictionMatch: prediction
          ? JSON.stringify(prediction) === JSON.stringify(calculated)
          : null,
      };
      r = await commit(env, r, p, { state, status: state.phase, event });
      return json(await roomView(env, r, p));
    } catch (e) {
      await reject(env, r, p, e.message, body.action);
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, e.message);
    }
  }
  throw new HttpError(404, "接口不存在");
}
export async function adminRooms(request, env) {
  const url = new URL(request.url),
    match = url.pathname.match(
      /^\/api\/admin\/rooms(?:\/([a-f0-9]{16})(?:\/(verify))?)?$/,
    );
  if (!match) return null;
  if (request.method !== "GET") throw new HttpError(405, "仅支持读取");
  if (!match[1]) {
    const before =
      Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
    const rooms = (
      await env.DB.prepare(
        `SELECT r.id,r.status,r.revision,r.host_id,r.guest_id,r.created_at,r.updated_at,r.expires_at,h.name AS host_name,g.name AS guest_name,json_extract(r.state,'$.winner') AS winner,json_extract(r.state,'$.players[0].faction') AS host_faction,json_extract(r.state,'$.players[1].faction') AS guest_faction,json_extract(r.state,'$.players[0].hp') AS host_hp,json_extract(r.state,'$.players[1].hp') AS guest_hp FROM rooms r JOIN players h ON h.id=r.host_id LEFT JOIN players g ON g.id=r.guest_id WHERE r.updated_at<? ORDER BY r.updated_at DESC LIMIT 100`,
      )
        .bind(before)
        .all()
    ).results;
    return json({
      rooms,
      nextBefore: rooms.length === 100 ? rooms.at(-1).updated_at : null,
    });
  }
  const r = await readRoom(env, match[1]);
  if (match[2] === "verify") {
    if (!r.initial_state)
      return json({ verified: true, actions: 0, message: "尚未开始对局" });
    const rows = (
      await env.DB.prepare(
        "SELECT payload,revision FROM room_events WHERE room_id=? AND revision<=? ORDER BY revision",
      )
        .bind(r.id, r.revision)
        .all()
    ).results;
    const state = JSON.parse(r.initial_state),
      E = rulesFor(r.content);
    let actions = 0;
    for (const row of rows) {
      const e = JSON.parse(row.payload);
      if (e.kind === "join") {
        if (e.afterHash !== (await digest(JSON.stringify(state))))
          return json({
            verified: false,
            revision: row.revision,
            reason: "初始状态摘要不一致",
          });
      }
      if (e.action) {
        if (e.beforeHash !== (await digest(JSON.stringify(state))))
          return json({
            verified: false,
            revision: row.revision,
            reason: "操作前状态摘要不一致",
          });
        try {
          applyCommand(E, state, e.seat, e.action);
        } catch (err) {
          return json({
            verified: false,
            revision: row.revision,
            reason: err.message,
          });
        }
        if (e.afterHash !== (await digest(JSON.stringify(state))))
          return json({
            verified: false,
            revision: row.revision,
            reason: "操作后状态摘要不一致",
          });
        actions++;
      }
    }
    return json({
      verified: JSON.stringify(state) === JSON.stringify(r.state),
      revision: r.revision,
      actions,
      stateHash: await digest(JSON.stringify(state)),
      points: r.status === "finished" ? resultPoints(state) : [0, 0],
    });
  }
  const before =
    Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const events = (
    await env.DB.prepare(
      "SELECT revision,payload,created_at FROM room_events WHERE room_id=? AND revision<? ORDER BY revision DESC LIMIT 100",
    )
      .bind(r.id, before)
      .all()
  ).results.map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  const rejections = (
    await env.DB.prepare(
      "SELECT reason,action,created_at,actor_id FROM room_rejections WHERE room_id=? ORDER BY id DESC LIMIT 50",
    )
      .bind(r.id)
      .all()
  ).results;
  const people = (
    await env.DB.prepare(
      "SELECT id,name,created_at,revoked_at FROM players WHERE id IN (?,?)",
    )
      .bind(r.host_id, r.guest_id ?? "")
      .all()
  ).results;
  return json({
    room: { ...r, initial_state: undefined },
    people,
    events,
    rejections,
    nextBefore: events.length === 100 ? events.at(-1).revision : null,
  });
}
