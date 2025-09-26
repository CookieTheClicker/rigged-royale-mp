import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.get("/", (_, res) => res.send("Rigged Royale MP server OK"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (process.env.CORS_ORIGIN || "*").split(",") }
});

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
      createdAt: Date.now()
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
    broadcastParty(party);
  });

  socket.on("disconnect", () => {
    leaveParty(socket, { notifySelf: false });
    online--;
    io.emit("presence", { online: Math.max(0, online) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Rigged Royale MP server on :" + PORT));
