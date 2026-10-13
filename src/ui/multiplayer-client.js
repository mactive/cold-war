const IDENTITY = "iron-front-identity-v1",
  ROOM = "iron-front-room-v1";
const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
export function createMultiplayerClient({
  onUpdate,
  onConnection,
  onUnauthorized,
}) {
  let identity = read(IDENTITY),
    room = null,
    timer = null,
    busy = false,
    stopped = true,
    generation = 0;
  async function api(path, body) {
    const response = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(identity ? { Authorization: "Bearer " + identity.token } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        identity = null;
        localStorage.removeItem(IDENTITY);
        stop();
        onUnauthorized?.();
      }
      const error = Error(data.error ?? "网络请求失败");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function stop() {
    generation++;
    stopped = true;
    clearTimeout(timer);
  }
  function accept(data) {
    if (data.unchanged) return;
    if (room && data.id === room.id && data.revision < room.revision) return;
    room = data;
    localStorage.setItem(ROOM, JSON.stringify(data.id));
    onUpdate(data);
    if (["finished", "closed"].includes(data.status)) stop();
  }
  async function poll() {
    if (stopped) return;
    const epoch = generation;
    try {
      if (room && !busy) {
        const data = await api("rooms/" + room.id + "?since=" + room.revision);
        if (!stopped && epoch === generation) {
          accept(data);
          onConnection("已同步");
        }
      }
    } catch (e) {
      if (!stopped && epoch === generation) onConnection("连接中断，正在重试…");
    } finally {
      if (!stopped && epoch === generation)
        timer = setTimeout(poll, document.hidden ? 4000 : 1000);
    }
  }
  function start() {
    stop();
    if (["finished", "closed"].includes(room?.status)) return;
    stopped = false;
    timer = setTimeout(poll, 1000);
  }
  return {
    get identity() {
      return identity;
    },
    get room() {
      return room;
    },
    get busy() {
      return busy;
    },
    get savedRoom() {
      return read(ROOM);
    },
    api,
    async createIdentity(name) {
      identity = await api("player", { name });
      localStorage.setItem(IDENTITY, JSON.stringify(identity));
      return identity;
    },
    async me() {
      return api("player");
    },
    async rooms() {
      return (await api("rooms")).rooms;
    },
    async create() {
      stop();
      accept(await api("rooms", {}));
      start();
    },
    async join(id) {
      stop();
      accept(await api("rooms/" + id + "/join", {}));
      start();
    },
    async resume(id) {
      stop();
      accept(await api("rooms/" + id));
      start();
    },
    async close() {
      accept(await api("rooms/" + room.id + "/close", {}));
    },
    async refresh() {
      if (room) accept(await api("rooms/" + room.id));
    },
    async action(action, prediction) {
      if (busy || !room) throw Error("正在等待服务器确认");
      busy = true;
      const body = {
        revision: room.revision,
        requestId: crypto.randomUUID(),
        action,
        ...(prediction ? { prediction } : {}),
      };
      try {
        // Reuse the exact request ID after an uncertain network outcome; the server settles it at most once.
        let data;
        try {
          data = await api("rooms/" + room.id + "/actions", body);
        } catch (e) {
          if (e.status === 409 && action.kind === "mulligan") {
            await this.refresh();
            body.revision = room.revision;
            data = await api("rooms/" + room.id + "/actions", body);
          } else {
            if (e.status) throw e;
            data = await api("rooms/" + room.id + "/actions", body);
          }
        }
        accept(data);
        onConnection("已同步");
        return data;
      } catch (e) {
        if (!e.status) onConnection("连接中断，正在重试…");
        try {
          await this.refresh();
        } catch {}
        throw e;
      } finally {
        busy = false;
      }
    },
    leave() {
      stop();
      room = null;
      localStorage.removeItem(ROOM);
    },
    async logout() {
      await api("player/logout", {});
      identity = null;
      localStorage.removeItem(IDENTITY);
      this.leave();
    },
    stop,
  };
}
