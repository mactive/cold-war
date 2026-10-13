CREATE TABLE players (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE TABLE rooms (
 id TEXT PRIMARY KEY,
 host_id TEXT NOT NULL REFERENCES players(id),
 guest_id TEXT REFERENCES players(id),
 status TEXT NOT NULL CHECK(status IN ('waiting','mulligan','play','finished','closed')),
 revision INTEGER NOT NULL DEFAULT 1,
 state TEXT CHECK(state IS NULL OR json_valid(state)),
 initial_state TEXT,
 content TEXT NOT NULL,
 last_event TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX rooms_host ON rooms(host_id,updated_at);
CREATE INDEX rooms_guest ON rooms(guest_id,updated_at);
CREATE INDEX rooms_recent ON rooms(updated_at DESC);
CREATE TABLE room_events (
 room_id TEXT NOT NULL REFERENCES rooms(id),
 revision INTEGER NOT NULL,
 request_id TEXT NOT NULL,
 actor_id TEXT,
 payload TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(room_id,revision),
 UNIQUE(room_id,request_id)
);
CREATE TRIGGER room_insert_log AFTER INSERT ON rooms BEGIN
 INSERT INTO room_events VALUES(NEW.id,NEW.revision,json_extract(NEW.last_event,'$.requestId'),json_extract(NEW.last_event,'$.actorId'),NEW.last_event,NEW.updated_at);
END;
CREATE TRIGGER room_update_log AFTER UPDATE OF revision ON rooms WHEN NEW.revision > OLD.revision BEGIN
 INSERT INTO room_events VALUES(NEW.id,NEW.revision,json_extract(NEW.last_event,'$.requestId'),json_extract(NEW.last_event,'$.actorId'),NEW.last_event,NEW.updated_at);
END;
CREATE TABLE room_rejections (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 room_id TEXT NOT NULL,
 actor_id TEXT,
 reason TEXT NOT NULL,
 action TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX room_rejections_room ON room_rejections(room_id,id DESC);
CREATE TABLE multiplayer_rate (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
