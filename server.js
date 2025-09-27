// server.js — single app: serves static frontend + Socket.IO (ESM)

// Core imports
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Express app serving your game files ---
const app = express();

// Serve index.html, game.js, style.css, multiplayer.js, etc. from project root
app.use(express.static(__dirname));
// Explicit assets folder (case-sensitive on Linux)
app.use("/assets", express.static(path.join(__dirname, "assets")));

// If you had an app.get("/") before that sent text, REMOVE it,
// otherwise it will block index.html from being served.

// --- HTTP + Socket.IO server ---
const server = createServer(app);
const io = new Server(server, {
  // Same-origin in production; permissive here to avoid CORS headaches if you test from elsewhere
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ====== Your original multiplayer/party logic (unchanged) ======
let online = 0;

const parties = new Map();
const MAX_PARTY_SIZE = Number(process.env.PARTY_MAX_SIZE || 4);
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = Number(process.env.PARTY_CODE_LENGTH || 4);
const NAME_MAX_LENGTH = 20;

const sanitizeName = (raw) => {
  if (typeof raw !== "string") return "";
  const trimmed = raw.replace(/\s+/g, " ").replace(/[^\x20-\x7E]/g, "").trim();
  return trimmed.slice(0, NAME_MAX_LENGTH);
};

const clampNumber = (value, min, max, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let result = num;
  if (typeof min === "number") result = Math.max(min, result);
  if (typeof max === "number") result = Math.min(max, result);
  return result;
};

const sanitizePlayerState = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const state = {};
  if (Number.isFinite(Number(raw.x))) state.x = clampNumber(raw.x, -5000, 5000, Number(raw.x));
  if (Number.isFinite(Number(raw.y))) state.y = clampNumber(raw.y, -5000, 5000, Number(raw.y));
  if (Number.isFinite(Number(raw.vx))) state.vx = clampNumber(raw.vx, -4000, 4000, Number(raw.vx));
  if (Number.isFinite(Number(raw.vy))) state.vy = clampNumber(raw.vy, -4000, 4000, Number(raw.vy));
  if (Number.isFinite(Number(raw.hp))) state.hp = clampNumber(raw.hp, -10, 250, Number(raw.hp));
  if (Number.isFinite(Number(raw.stamina)))
    state.stamina = clampNumber(raw.stamina, 0, 120, Number(raw.stamina));
  if (raw.alive !== undefined) state.alive = Boolean(raw.alive);
  if (raw.downed !== undefined) state.downed = Boolean(raw.downed);
  if (raw.spectator !== undefined) state.spectator = Boolean(raw.spectator);
  if (typeof raw.teamId === "number" && Number.isFinite(raw.teamId))
    state.teamId = Math.round(raw.teamId);
  if (typeof raw.teamColor === "string") state.teamColor = raw.teamColor.slice(0, 32);
  if (typeof raw.weapon === "string") state.weapon = raw.weapon.slice(0, 24);
  if (typeof raw.mode === "string") state.mode = raw.mode.slice(0, 16);
  if (typeof raw.diff === "string") state.diff = raw.diff.slice(0, 16);
  if (Number.isFinite(Number(raw.latency))) {
    state.latency = clampNumber(raw.latency, 0, 10000, Number(raw.latency));
  }
  return Object.keys(state).length ? state : null;
};

const STATE_TTL_MS = 15_000;

const getActiveStates = (party) => {
  if (!party || !party.states) return [];
  const now = Date.now();
  const result = [];
  for (const [id, snapshot] of party.states.entries()) {
    if (!snapshot) {
      party.states.delete(id);
      continue;
    }
    if (now - (snapshot.updatedAt || 0) > STATE_TTL_MS) {
      party.states.delete(id);
      continue;
    }
    result.push(snapshot);
  }
  return result;
};

const sendPartyStates = (party, socket) => {
  if (!party || !socket) return;
  const payload = getActiveStates(party).filter((entry) => entry.id !== socket.id);
  if (payload.length) socket.emit("state:bulk", payload);
};

const ensureDisplayName = (socket, maybeName) => {
  const sanitized = sanitizeName(maybeName);
  if (sanitized) {
    socket.data.displayName = sanitized;
    return sanitized;
  }
  if (typeof socket.data.displayName === "string" && socket.data.displayName.trim()) {
    return socket.data.displayName;
  }
  const fallback = `Player-${socket.id.slice(0, 5)}`;
  socket.data.displayName = fallback;
  return fallback;
};

const generatePartyCode = () => {
  let code = "";
  do {
    code = Array.from({ length: CODE_LENGTH }, () => {
      const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
      return CODE_ALPHABET[idx];
    }).join("");
  } while (parties.has(code));
  return code;
};

const roomName = (code) => `party:${code}`;
const getParty = (code) => (code ? parties.get(code) || null : null);
const getPartyForSocket = (socket) => getParty(socket.data.partyCode);

const emitPartyEmpty = (socket) => {
  socket.emit("party:update", {
    code: null,
    hostId: null,
    members: [],
    maxSize: MAX_PARTY_SIZE
  });
};

const broadcastParty = (party) => {
  if (!party) return;
  const payload = {
    code: party.code,
    hostId: party.hostId,
    members: Array.from(party.members.values()),
    maxSize: MAX_PARTY_SIZE,
    createdAt: party.createdAt
  };
  io.to(roomName(party.code)).emit("party:update", payload);
};

const leaveParty = (socket, opts = {}) => {
  const existingCode = socket.data.partyCode;
  if (!existingCode) return;
  const party = getParty(existingCode);
  socket.data.partyCode = null;
  socket.leave(roomName(existingCode));
  if (!party) {
    if (opts.notifySelf !== false) emitPartyEmpty(socket);
    return;
  }
  party.members.delete(socket.id);
  if (party.states) {
    party.states.delete(socket.id);
  }
  socket.to(roomName(existingCode)).emit("state:remove", { id: socket.id });
  if (party.hostId === socket.id) {
    const nextMember = party.members.values().next().value;
    if (nextMember) {
      party.hostId = nextMember.id;
    } else {
      parties.delete(party.code);
    }
  }
  if (party.members.size === 0) {
    parties.delete(party.code);
  } else {
    broadcastParty(party);
  }
  if (opts.notifySelf !== false) emitPartyEmpty(socket);
};

const joinParty = (party, socket, name) => {
  if (!party) return;
  if (!party.states) party.states = new Map();
  if (party.members.size >= MAX_PARTY_SIZE) {
    socket.emit("party:error", { message: "Party is full." });
    return;
  }
  const displayName = ensureDisplayName(socket, name);
  const existingMember = party.members.get(socket.id);
  if (existingMember) {
    existingMember.name = displayName;
    existingMember.ready = false;
  } else {
    party.members.set(socket.id, { id: socket.id, name: displayName, ready: false });
  }
  socket.data.partyCode = party.code;
  socket.join(roomName(party.code));
  socket.emit("party:joined", { code: party.code });
  sendPartyStates(party, socket);
  broadcastParty(party);
};

const handleReady = (socket, ready) => {
  const party = getPartyForSocket(socket);
  if (!party) {
    socket.emit("party:error", { message: "You are not in a party." });
    return;
  }
  const member = party.members.get(socket.id);
  if (!member) {
    socket.emit("party:error", { message: "Member not found in party." });
    return;
  }
  member.ready = Boolean(ready);
  broadcastParty(party);
};

io.on("connection", (socket) => {
  online++;
  socket.data.displayName = `Player-${socket.id.slice(0, 5)}`;
  io.emit("presence", { online });

  socket.on("chat", (msg) => {
    const safe = String(msg || "").slice(0, 300);
    io.emit("chat", {
      id: socket.id.slice(0, 5),
      name: socket.data.displayName,
      msg: safe,
      t: Date.now()
    });
  });

  socket.on("pingcheck", (t) => socket.emit("pongcheck", t));

  socket.on("identity:set", ({ name } = {}) => {
    const sanitized = sanitizeName(name);
    if (!sanitized) {
      socket.emit("party:error", { message: "Name must be at least one character." });
      return;
    }
    socket.data.displayName = sanitized;
    const party = getPartyForSocket(socket);
    if (party) {
      const member = party.members.get(socket.id);
      if (member) {
        member.name = sanitized;
        broadcastParty(party);
      }
    }
    socket.emit("identity:ack", { name: sanitized });
  });

  socket.on("party:create", ({ name } = {}) => {
    ensureDisplayName(socket, name);
    leaveParty(socket, { notifySelf: false });
    const code = generatePartyCode();
    const party = {
      code,
      hostId: socket.id,
      members: new Map(),
      states: new Map(),
      createdAt: Date.now(),
      match: { counter: 0, latest: null }
    };
    parties.set(code, party);
    joinParty(party, socket);
    socket.emit("party:created", { code });
  });

  socket.on("party:join", ({ code, name } = {}) => {
    const normalized = String(code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, CODE_LENGTH);
    if (!normalized) {
      socket.emit("party:error", { message: "Enter a valid party code." });
      return;
    }
    const party = getParty(normalized);
    if (!party) {
      socket.emit("party:error", { message: "Party not found." });
      return;
    }
    ensureDisplayName(socket, name);
    leaveParty(socket, { notifySelf: false });
    joinParty(party, socket);
    if (party.match && party.match.latest) {
      socket.emit("match:seed", party.match.latest);
    }
  });

  socket.on("party:leave", () => {
    leaveParty(socket);
  });

  socket.on("party:ready", ({ ready } = {}) => {
    handleReady(socket, ready);
  });

  socket.on("party:sync", () => {
    const party = getPartyForSocket(socket);
    if (!party) {
      emitPartyEmpty(socket);
      return;
    }
    socket.join(roomName(party.code));
    sendPartyStates(party, socket);
    broadcastParty(party);
    if (party.match && party.match.latest) {
      socket.emit("match:seed", party.match.latest);
    }
  });

  socket.on("state:update", (payload = {}) => {
    const party = getPartyForSocket(socket);
    if (!party) return;
    if (!party.states) party.states = new Map();
    const sanitized = sanitizePlayerState(payload);
    if (!sanitized) return;
    sanitized.id = socket.id;
    sanitized.name = socket.data.displayName;
    sanitized.updatedAt = Date.now();
    party.states.set(socket.id, sanitized);
    socket.to(roomName(party.code)).emit("state:delta", sanitized);
  });

  socket.on("state:request", () => {
    const party = getPartyForSocket(socket);
    if (!party) {
      socket.emit("state:bulk", []);
      return;
    }
    sendPartyStates(party, socket);
  });

  socket.on("match:request", ({ requestId } = {}) => {
    const party = getPartyForSocket(socket);
    if (!party) return;
    if (!party.match) party.match = { counter: 0, latest: null };
    const now = Date.now();
    party.match.counter = (party.match.counter || 0) + 1;
    const payload = {
      seed: randomUUID(),
      counter: party.match.counter,
      issuedAt: now,
      by: socket.id
    };
    party.match.latest = payload;
    io.to(roomName(party.code)).emit("match:seed", payload);
    if (requestId) {
      socket.emit("match:seed:ack", { requestId, ...payload });
    }
  });

  socket.on("match:get", () => {
    const party = getPartyForSocket(socket);
    if (!party || !party.match || !party.match.latest) return;
    socket.emit("match:seed", party.match.latest);
  });

  socket.on("disconnect", () => {
    leaveParty(socket, { notifySelf: false });
    online--;
    io.emit("presence", { online: Math.max(0, online) });
  });
});
// ====== end of your logic ======

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Rigged Royale MP server on :" + PORT);
});
