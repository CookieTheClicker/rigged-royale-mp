/* Multiplayer party + chat using Socket.IO */
(function () {
  // Auto-detect server:
  // - on localhost: use http://localhost:3000
  // - on Render/production: same origin (empty string = auto)
  const DEFAULT_URL =
    window.location.hostname === "localhost" ? "http://localhost:3000" : "";
  const SERVER_URL = DEFAULT_URL;

  if (window.__riggedMpInit) return;
  window.__riggedMpInit = true;

  const host = document.body;

  const style = document.createElement("style");
  style.textContent = `
#mpPanel {
  position: fixed;
  pointer-events: auto;
  right: 12px;
  bottom: 12px;
  width: 300px;
  max-height: 70vh;
  background: rgba(0, 0, 0, 0.65);
  border: 1px solid rgba(0, 0, 255, 0.15);
  border-radius: 12px;
  padding: 12px;
  color: #fff;
  font: 13px/1.4 system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 9999;
  box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45);
}
#mpPanel button, #mpPanel input {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  padding: 6px 8px;
  font: inherit;
}
#mpPanel button {
  cursor: pointer;
  padding: 6px 10px;
}
#mpPanel button:disabled, #mpPanel input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
#mpPanel .mp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
#mpPanel .mp-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#mpPanel .mp-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
#mpPanel .mp-subtle {
  opacity: 0.75;
  font-size: 12px;
}
#mpPanel #mpLog {
  overflow: auto;
  max-height: 160px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.25);
}
#mpPanel #mpLog div {
  white-space: pre-wrap;
  word-break: break-word;
}
#mpPanel .mp-members {
  list-style: none;
  margin: 0;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  max-height: 140px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#mpPanel .mp-chip {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
#mpPanel .mp-message {
  min-height: 16px;
  font-size: 12px;
}
#mpPanel .mp-code {
  font-weight: 600;
  letter-spacing: 2px;
}
#mpPanel .mp-close {
  background: transparent;
  border: none;
  color: #fff;
  opacity: 0.6;
}
#mpPanel .mp-close:hover {
  opacity: 1;
}
`;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "mpPanel";
  panel.innerHTML = `
    <div class="mp-header">
      <div>
        <strong>Multiplayer</strong>
        <span id="mpStatus" class="mp-subtle">offline</span>
      </div>
      <button id="mpHide" class="mp-close" title="Close">X</button>
    </div>

    <div class="mp-section">
      <label class="mp-subtle" for="mpName">Display name</label>
      <div class="mp-inline">
        <input id="mpName" type="text" maxlength="20" placeholder="Enter a name">
        <button id="mpSaveName">Save</button>
      </div>
    </div>

    <div class="mp-section">
      <div class="mp-inline" style="justify-content: space-between;">
        <span>Party</span>
        <span id="mpPartyMeta" class="mp-subtle"></span>
      </div>
      <div id="mpPartyCode" class="mp-code">Not in a party</div>
      <div class="mp-inline">
        <button id="mpCreate">Create</button>
        <input id="mpJoinCode" type="text" maxlength="6" placeholder="Code">
        <button id="mpJoin">Join</button>
        <button id="mpLeave">Leave</button>
      </div>
      <label id="mpReadyWrap" class="mp-inline mp-subtle" style="align-items:center;">
        <input type="checkbox" id="mpReady" style="width:auto;">
        <span>Ready</span>
      </label>
      <ul id="mpPartyMembers" class="mp-members"></ul>
      <div id="mpPartyMessage" class="mp-message"></div>
    </div>

    <div class="mp-section" style="flex:1; min-height:160px;">
      <span class="mp-subtle">Chat</span>
      <div id="mpLog"></div>
      <form id="mpForm" class="mp-inline">
        <input id="mpInput" placeholder="Type to chat..." maxlength="300" autocomplete="off">
        <button type="submit">Send</button>
      </form>
    </div>
  `;
  host.appendChild(panel);

  const elements = {
    status: panel.querySelector("#mpStatus"),
    hide: panel.querySelector("#mpHide"),
    nameInput: panel.querySelector("#mpName"),
    saveName: panel.querySelector("#mpSaveName"),
    createBtn: panel.querySelector("#mpCreate"),
    joinCode: panel.querySelector("#mpJoinCode"),
    joinBtn: panel.querySelector("#mpJoin"),
    leaveBtn: panel.querySelector("#mpLeave"),
    readyWrap: panel.querySelector("#mpReadyWrap"),
    readyToggle: panel.querySelector("#mpReady"),
    members: panel.querySelector("#mpPartyMembers"),
    partyCode: panel.querySelector("#mpPartyCode"),
    partyMeta: panel.querySelector("#mpPartyMeta"),
    partyMessage: panel.querySelector("#mpPartyMessage"),
    log: panel.querySelector("#mpLog"),
    form: panel.querySelector("#mpForm"),
    input: panel.querySelector("#mpInput"),
  };

  const state = {
    socket: null,
    connected: false,
    selfId: null,
    online: 0,
    party: null,
    name: "",
    messageTimer: null,
  };

  const storedName = localStorage.getItem("rrDisplayName");
  if (storedName) {
    state.name = cleanName(storedName);
    elements.nameInput.value = state.name;
  }

  elements.joinCode.addEventListener("input", () => {
    elements.joinCode.value = elements.joinCode.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  });

  elements.saveName.addEventListener("click", (e) => {
    e.preventDefault();
    if (saveName()) {
      setPartyMessage("Name saved");
    }
  });

  elements.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (saveName()) setPartyMessage("Name saved");
    }
  });

  elements.createBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!checkSocket() || !ensureName()) return;
    state.socket.emit("party:create", { name: state.name });
    setPartyMessage("Creating party...");
  });

  elements.joinBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!checkSocket() || !ensureName()) return;
    const code = elements.joinCode.value.trim();
    if (!code) {
      setPartyMessage("Enter a party code", "error");
      elements.joinCode.focus();
      return;
    }
    state.socket.emit("party:join", { code, name: state.name });
    setPartyMessage("Joining party...");
  });

  elements.leaveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!checkSocket()) return;
    state.socket.emit("party:leave");
  });

  elements.readyToggle.addEventListener("change", () => {
    if (!checkSocket()) return;
    state.socket.emit("party:ready", {
      ready: elements.readyToggle.checked,
    });
  });

  elements.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!checkSocket()) return;
    const raw = (elements.input.value || "").trim();
    if (!raw) return;
    state.socket.emit("chat", raw);
    elements.input.value = "";
  });

  elements.hide.addEventListener("click", () => {
    cleanup();
    panel.remove();
  });

  function cleanup() {
    if (state.socket) {
      state.socket.disconnect();
    }
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
    }
  }

  function cleanName(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .slice(0, 20);
  }

  function saveName() {
    const cleaned = cleanName(elements.nameInput.value);
    if (!cleaned) {
      setPartyMessage("Enter at least one character for your name", "error");
      elements.nameInput.focus();
      return false;
    }
    state.name = cleaned;
    localStorage.setItem("rrDisplayName", cleaned);
    if (state.socket && state.socket.connected) {
      state.socket.emit("identity:set", { name: cleaned });
    }
    return true;
  }

  function ensureName() {
    if (state.name) return true;
    return saveName();
  }

  function checkSocket() {
    if (state.socket && state.socket.connected) return true;
    setPartyMessage("Not connected to server yet", "error");
    return false;
  }

  function updateStatus() {
    const parts = [];
    parts.push(state.connected ? "connected" : "offline");
    parts.push(`${Math.max(0, state.online)} online`);
    elements.status.textContent = parts.join(" | ");
  }

  function stopStateLoop() {
    if (state.stateLoop) {
      clearInterval(state.stateLoop);
      state.stateLoop = null;
    }
  }

  function ensureStateLoop() {
    if (state.stateLoop) return;
    if (!netBridge || typeof netBridge.captureLocalState !== "function") return;
    state.stateLoop = setInterval(maybeSendState, 120);
  }

  function ensurePingLoop() {
    if (state.pingTimer) return;
    if (!state.socket) return;
    state.pingTimer = setInterval(() => {
      if (!state.socket || !state.socket.connected) return;
      state.socket.emit("pingcheck", Date.now());
    }, 5000);
  }

  function stopPingLoop() {
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
  }

  function maybeSendState() {
    if (!state.socket || !state.socket.connected) return;
    if (!state.party || !state.party.code) return;
    if (!netBridge || typeof netBridge.captureLocalState !== "function") return;
    const payload = netBridge.captureLocalState();
    if (!payload) return;
    payload.updatedAt = Date.now();
    if (typeof state.lastLatency === "number") {
      payload.latency = state.lastLatency;
    }
    state.socket.emit("state:update", payload);
  }
  function setPartyMessage(text, type = "info") {
    elements.partyMessage.textContent = text || "";
    elements.partyMessage.style.color =
      type === "error" ? "#ff9a9a" : "#f8c471";
    if (state.messageTimer) clearTimeout(state.messageTimer);
    if (text) {
      state.messageTimer = setTimeout(() => {
        if (elements.partyMessage.textContent === text) {
          elements.partyMessage.textContent = "";
        }
      }, 4500);
    }
  }

  function updatePartyUI() {
    const hasParty = Boolean(state.party && state.party.code);
    const members =
      hasParty && Array.isArray(state.party.members)
        ? state.party.members
        : [];
    const maxSize = hasParty ? state.party.maxSize : 0;

    elements.partyCode.textContent = hasParty
      ? `Code: ${state.party.code}`
      : "Not in a party";
    elements.partyMeta.textContent = hasParty
      ? `${members.length}/${maxSize} players`
      : "";

    elements.createBtn.disabled = !state.connected || hasParty;
    elements.joinBtn.disabled = !state.connected || hasParty;
    elements.joinCode.disabled = !state.connected || hasParty;
    elements.leaveBtn.disabled = !state.connected || !hasParty;
    elements.readyToggle.disabled = !state.connected || !hasParty;
    elements.readyWrap.style.display = hasParty ? "flex" : "none";

    elements.members.innerHTML = "";
    if (hasParty) {
      members.forEach((member) => {
        const li = document.createElement("li");
        li.className = "mp-chip";
        const nameSpan = document.createElement("span");
        const statusSpan = document.createElement("span");
        const isHost = state.party.hostId === member.id;
        const isSelf = member.id === state.selfId;

        const pieces = [];
        if (isHost) pieces.push("[H]");
        pieces.push(
          member.name || (member.id ? member.id.slice(0, 5) : "player")
        );
        if (isSelf) pieces.push("(you)");
        nameSpan.textContent = pieces.join(" ");

        statusSpan.textContent = member.ready ? "ready" : "waiting";
        statusSpan.style.opacity = member.ready ? "1" : "0.6";

        li.appendChild(nameSpan);
        li.appendChild(statusSpan);
        elements.members.appendChild(li);
      });
    }

    const me = members.find((m) => m.id === state.selfId);
    elements.readyToggle.checked = Boolean(me && me.ready);
  }

  function logLine(text) {
    const stamp = new Date();
    const hh = String(stamp.getHours()).padStart(2, "0");
    const mm = String(stamp.getMinutes()).padStart(2, "0");
    const div = document.createElement("div");
    div.textContent = `[${hh}:${mm}] ${text}`;
    elements.log.appendChild(div);
    while (elements.log.childNodes.length > 80) {
      elements.log.removeChild(elements.log.firstChild);
    }
    elements.log.scrollTop = elements.log.scrollHeight;
  }

  function initSocket() {
    if (state.socket) return;
    const socket = SERVER_URL
      ? io(SERVER_URL, { transports: ["websocket", "polling"] })
      : io({ transports: ["websocket", "polling"] });
    state.socket = socket;

    socket.on("connect", () => {
      state.connected = true;
      state.selfId = socket.id;
      updateStatus();
      logLine("Connected to multiplayer server.");
      if (state.name) {
        socket.emit("identity:set", { name: state.name });
      }
      socket.emit("party:sync");
      setPartyMessage("");
    });

    socket.on("disconnect", () => {
      const hadParty = Boolean(state.party && state.party.code);
      state.connected = false;
      state.selfId = null;
      state.party = null;
      updateStatus();
      updatePartyUI();
      logLine("Disconnected from server.");
      if (hadParty) {
        setPartyMessage("Party closed");
      }
    });

    socket.on("connect_error", (err) => {
      setPartyMessage(
        `Connection error: ${
          err && err.message ? err.message : "unknown"
        }`,
        "error"
      );
    });

    socket.on("presence", ({ online }) => {
      state.online = Number(online) || 0;
      updateStatus();
    });
    socket.on("pongcheck", (stamp) => {
      const now = Date.now();
      const sent = Number(stamp);
      const latency = Number.isFinite(sent) ? now - sent : now;
      if (Number.isFinite(latency) && latency >= 0) {
        state.lastLatency = latency;
        updateStatus();
      }
    });

    socket.on("chat", ({ id, name, msg }) => {
      const label = name || (id ? id.slice(0, 5) : "anon");
      logLine(`${label}: ${msg}`);
    });

    socket.on("party:update", (data) => {
      const previous = state.party && state.party.code;
      state.party = data && data.code ? data : null;
      updatePartyUI();
      const current = state.party && state.party.code;
      if (previous && !current) {
        logLine("Left party.");
        setPartyMessage("Left party");
      }
    });

    socket.on("party:error", ({ message }) => {
      setPartyMessage(message || "Party error", "error");
    });

    socket.on("party:created", ({ code }) => {
      if (code) elements.joinCode.value = code;
      setPartyMessage(`Party created: ${code}`);
      logLine(`Party created (${code})`);
    });

    socket.on("party:joined", ({ code }) => {
      setPartyMessage(`Joined party ${code}`);
      logLine(`Joined party ${code}`);
    });

    socket.on("identity:ack", ({ name }) => {
      if (name) {
        state.name = name;
        elements.nameInput.value = name;
        localStorage.setItem("rrDisplayName", name);
      }
    });

    socket.on("state:bulk", (entries = []) => {
      if (!Array.isArray(entries)) return;
      if (!netBridge || typeof netBridge.applyRemoteSnapshot !== "function") return;
      entries.forEach((entry) => {
        if (!entry || entry.id === state.selfId) return;
        netBridge.applyRemoteSnapshot(entry);
      });
    });

    socket.on("state:delta", (entry) => {
      if (!netBridge || typeof netBridge.applyRemoteSnapshot !== "function") return;
      if (!entry || entry.id === state.selfId) return;
      netBridge.applyRemoteSnapshot(entry);
    });

    socket.on("state:remove", ({ id }) => {
      if (!netBridge || typeof netBridge.removeRemotePlayer !== "function") return;
      if (!id || id === state.selfId) return;
      netBridge.removeRemotePlayer(id);
    });
    socket.on("reconnect", () => {
      logLine("Reconnected.");
      socket.emit("party:sync");
      if (state.name) socket.emit("identity:set", { name: state.name });
    });
  }

  const script = document.createElement("script");
  script.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
  script.onload = initSocket;
  script.onerror = () =>
    setPartyMessage("Failed to load multiplayer client", "error");
  document.head.appendChild(script);

  updateStatus();
  updatePartyUI();
})();















