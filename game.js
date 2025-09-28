(() => {
  'use strict';

  // --- Config ---
  const CONFIG = {
    mapW: 2800,
    mapH: 2000,
    bots: 24, // default; overridden by difficulty
    targetFPS: 60,
    baseFriction: 0.88,
    playerSpeed: 290,
    botSpeed: 250,
    bulletSpeed: 900,
    bulletLife: 1.6,
    damageOutsideZonePerSec: 18,
    zone: {
      startRadius: 1500,
      endRadius: 140,
      phases: 5,
      holdTime: 8,
      shrinkTime: 14,
    },
    obstacles: 60,
    pickups: 60,
  };

  // Difficulty presets. Current gameplay equals 'insane'.
  const DIFFICULTY = {
    easy:   { label: 'Easy',   bots: 10, speedMult: 0.85, aimProb: 0.25, spreadAdd: 0.18, seeRange: 560, zoneDmgMult: 0.5, pickupsMult: 1.5,  botRofMult: 0.6, botDmgMult: 0.7, botHpMult: 0.8, botReloadMult: 1.2 },
    normal: { label: 'Normal', bots: 14, speedMult: 0.90, aimProb: 0.50, spreadAdd: 0.10, seeRange: 650, zoneDmgMult: 0.75, pickupsMult: 1.2,  botRofMult: 0.8, botDmgMult: 0.85, botHpMult: 0.9, botReloadMult: 1.1 },
    hard:   { label: 'Hard',   bots: 18, speedMult: 1.00, aimProb: 0.70, spreadAdd: 0.05, seeRange: 740, zoneDmgMult: 1.0,  pickupsMult: 1.0,  botRofMult: 1.0, botDmgMult: 1.0,  botHpMult: 1.0, botReloadMult: 1.0 },
    insane: { label: 'Insane', bots: 24, speedMult: 1.05, aimProb: 0.90, spreadAdd: 0.00, seeRange: 780, zoneDmgMult: 1.0,  pickupsMult: 0.8,  botRofMult: 1.1, botDmgMult: 1.05, botHpMult: 1.0, botReloadMult: 0.95 },
  };

  // Team modes and colors (defined early so world can reference it)
  const TEAM_MODES = {
    solos:  { label: 'Solos',  teamSize: 1 },
    duos:   { label: 'Duos',   teamSize: 2 },
    trios:  { label: 'Trios',  teamSize: 3 },
    squads: { label: 'Squads', teamSize: 4 },
  };
  const TEAM_COLORS = ['#74f7a9','#89a8ff','#ffd166','#f77171','#f6a6ff','#8be0d4','#ffa3a3','#a3ff75','#ffb86c','#a1ffe1'];

  // --- DOM / Canvas ---
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const bodyEl = document.body;
  const playBtn = document.getElementById('playBtn');
  const restartBtn = document.getElementById('restartBtn');
  const spectateBtn = document.getElementById('spectateBtn');
  const menuBtn = document.getElementById('menuBtn');
  const mainActions = document.getElementById('mainActions');
  const deathActions = document.getElementById('deathActions');
  const status = document.getElementById('status');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const diffBtns = Array.from(document.querySelectorAll('#diffBtns .diff'));
  const joystickToggle = document.getElementById('joystickToggle');
  const joystickRoot = document.getElementById('joystick');
  const joystickArea = document.getElementById('joystickArea');
  const joystickBase = document.getElementById('joystickBase');
  const joystickThumb = document.getElementById('joystickThumb');
  const modeBtns = Array.from(document.querySelectorAll('#modeBtns .mode'));

  let selectedDiff = 'insane';
  let selectedMode = 'solos';
  let joystickEnabled = false;
  let activeMatchCounter = null;
  let matchReadyUnsub = null;
  let startGamePromise = null;
  diffBtns.forEach(btn => btn.addEventListener('click', () => {
    selectedDiff = btn.dataset.diff;
    diffBtns.forEach(b => b.classList.toggle('selected', b === btn));
  }));
  modeBtns.forEach(btn => btn.addEventListener('click', () => {
    selectedMode = btn.dataset.mode;
    modeBtns.forEach(b => b.classList.toggle('selected', b === btn));
  }));
  if (joystickToggle) {
    joystickToggle.addEventListener('change', () => {
      setJoystickEnabled(joystickToggle.checked, true);
      saveJoystick();
    });
  }

  const toMatchCounter = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const getMpBridge = () =>
    (window.RiggedRoyale && window.RiggedRoyale.mp) || null;

  function ensureAutoMatchSubscription() {
    if (matchReadyUnsub) return;
    const mpBridge = getMpBridge();
    if (!mpBridge || typeof mpBridge.onMatchReady !== 'function') return;
    matchReadyUnsub = mpBridge.onMatchReady((info) => {
      if (!info) return;
      const partyCtx =
        typeof mpBridge.getPartyContext === 'function'
          ? mpBridge.getPartyContext()
          : null;
      const selfId =
        typeof mpBridge.getSelfId === 'function'
          ? mpBridge.getSelfId()
          : null;
      const inParty = partyCtx && partyCtx.code;
      const isHost = inParty && partyCtx && partyCtx.hostId === selfId;
      if (!inParty || isHost) return;
      const incomingCounter = toMatchCounter(info.counter);
      if (
        incomingCounter !== null &&
        activeMatchCounter !== null &&
        incomingCounter === activeMatchCounter
      ) {
        return;
      }
      if (startGamePromise) return;
      startGame().catch((err) => {
        console.warn('Failed to auto-start multiplayer match', err);
        showOverlay();
      });
    });
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('rr:mp:ready', ensureAutoMatchSubscription);
  }
  ensureAutoMatchSubscription();

  // Resize canvas to fill screen
  function fitCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // --- Utils ---
  let randomSource = Math.random;
  const setRandomSource = (fn) => {
    randomSource = typeof fn === 'function' ? fn : Math.random;
  };
  const rand = (a, b) => a + randomSource() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (x1, y1, x2, y2) => {
    const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mag = (x, y) => Math.hypot(x, y);
  const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return [x / m, y / m]; };
  const ang = (x, y) => Math.atan2(y, x);

  function makeSeededRng(seed) {
    let h = 2166136261 >>> 0;
    const text = String(seed || "");
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h += h << 13;
      h ^= h >>> 7;
      h += h << 3;
      h ^= h >>> 17;
      h += h << 5;
      return ((h >>> 0) & 0xffffffff) / 0xffffffff;
    };
  }

  function hash2(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  // --- Input ---
  const keys = new Set();
  let mouse = { x: 0, y: 0, down: false };
  const joystickState = { active: false, pointerId: null, x: 0, y: 0, radius: 60, lastUpdate: 0 };
  const JOYSTICK_DEADZONE = 0.12;

  window.addEventListener('keydown', (e) => { if (['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF','KeyP','Digit1','Digit2','Digit3','KeyE'].includes(e.code)) e.preventDefault(); keys.add(e.code); });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', () => mouse.down = true);
  window.addEventListener('mouseup', () => mouse.down = false);
  canvas.addEventListener('wheel', (e) => {
    const p = world.player; if (!p || !p.alive || p.downed) return;
    const dir = e.deltaY > 0 ? 1 : -1; cycleWeapon(p, dir);
  }, { passive: true });

  function resetJoystickThumb() {
    if (joystickThumb) joystickThumb.style.transform = 'translate(-50%, -50%)';
  }
  function resetJoystickState() {
    joystickState.active = false;
    joystickState.pointerId = null;
    joystickState.x = 0;
    joystickState.y = 0;
    joystickState.lastUpdate = 0;
    resetJoystickThumb();
    document.body.classList.remove('joystick-moving');
    if (joystickRoot) joystickRoot.classList.remove('joystick-active');
  }
  function updateJoystickOverlay() {
    if (!joystickRoot) return;
    if (!joystickEnabled) { resetJoystickState(); return; }
    const moving = Math.hypot(joystickState.x, joystickState.y) > JOYSTICK_DEADZONE;
    joystickRoot.classList.toggle('joystick-active', joystickState.active);
    document.body.classList.toggle('joystick-moving', moving && joystickState.active);
    if (!joystickState.active && !moving) resetJoystickThumb();
  }
  function updateJoystickVectorFromEvent(ev) {
    if (!joystickBase) return;
    const rect = joystickBase.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    let dx = ev.clientX - cx;
    let dy = ev.clientY - cy;
    const max = joystickState.radius = Math.min(rect.width, rect.height) * 0.45;
    const dist = Math.hypot(dx, dy);
    if (dist > max && dist > 0.0001) { const s = max / dist; dx *= s; dy *= s; }
    joystickState.x = dx / max;
    joystickState.y = dy / max;
    joystickState.lastUpdate = performance.now ? performance.now() : Date.now();
    if (joystickThumb) joystickThumb.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
    joystickRoot && joystickRoot.classList.add('joystick-active');
    const moving = Math.hypot(joystickState.x, joystickState.y) > JOYSTICK_DEADZONE;
    document.body.classList.toggle('joystick-moving', moving);
  }
  function handleJoystickPointerDown(ev) {
    if (!joystickEnabled || !joystickArea) return;
    if (ev.pointerType === 'mouse' && ev.buttons !== 1) return;
    if (joystickState.active && joystickState.pointerId !== ev.pointerId) return;
    joystickState.active = true;
    joystickState.pointerId = ev.pointerId;
    if (joystickArea.setPointerCapture) { try { joystickArea.setPointerCapture(ev.pointerId); } catch (_) {} }
    updateJoystickVectorFromEvent(ev);
    updateJoystickOverlay();
    ev.preventDefault();
  }
  function handleJoystickPointerMove(ev) {
    if (!joystickState.active || ev.pointerId !== joystickState.pointerId) return;
    if (!joystickEnabled) { resetJoystickState(); return; }
    updateJoystickVectorFromEvent(ev);
    updateJoystickOverlay();
    ev.preventDefault();
  }
  function handleJoystickPointerUp(ev) {
    if (!joystickState.active || ev.pointerId !== joystickState.pointerId) return;
    if (joystickArea && joystickArea.releasePointerCapture) { try { joystickArea.releasePointerCapture(ev.pointerId); } catch (_) {} }
    resetJoystickState();
    updateJoystickOverlay();
    ev.preventDefault();
  }
  if (joystickArea) {
    joystickArea.addEventListener('pointerdown', handleJoystickPointerDown);
  }
  window.addEventListener('pointermove', handleJoystickPointerMove, { passive: false });
  window.addEventListener('pointerup', handleJoystickPointerUp, { passive: false });
  window.addEventListener('pointercancel', handleJoystickPointerUp, { passive: false });

  // --- Audio (procedural blips) ---
  let audioCtx;
  let audioMuted = false;
  function blip(freq, duration = 0.07, type = 'square', gain = 0.05) {
    if (audioMuted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain; g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + duration);
    } catch (_) { /* ignore */ }
  }

  // --- World State ---
  const world = {
    time: 0,
    phase: 0,
    phaseTimer: 0,
    zoneState: { mode: 'hold', timer: 0, t: 0, T: 0, startR: 0, targetR: 0 },
    zone: { x: CONFIG.mapW / 2, y: CONFIG.mapH / 2, r: CONFIG.zone.startRadius, rTarget: CONFIG.zone.startRadius },
    obstacles: [],
    bushes: [],   // foliage that provides concealment
    trees: [],    // solid circular cover
    stones: [],   // solid circular cover
    crates: [],   // visuals for tinted weapon drops
    puddles: [],  // slows movement
    pickups: [],
    bullets: [],
    bots: [],
    player: null,
    running: false,
    paused: false,
    camera: { x: 0, y: 0, shake: 0 },
    diff: DIFFICULTY.insane,
    mode: TEAM_MODES.solos,
    teams: [],
    spectating: false,
    graceTimer: 0,
    remotePlayers: new Map(),
  };
﻿  const REMOTE_TIMEOUT_MS = 7000;
  const REMOTE_LERP_SPEED = 10;
  let localNetworkId = null;

  const nowMillis = () => (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : Date.now();

  const safeNumber = (value, min, max, fallback = 0) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    let result = num;
    if (typeof min === "number") result = Math.max(min, result);
    if (typeof max === "number") result = Math.min(max, result);
    return result;
  };

  function captureLocalState() {
    const player = world.player;
    if (!player) return null;
    return {
      x: safeNumber(player.x, -5000, CONFIG.mapW + 5000, 0),
      y: safeNumber(player.y, -5000, CONFIG.mapH + 5000, 0),
      vx: safeNumber(player.vx, -4000, 4000, 0),
      vy: safeNumber(player.vy, -4000, 4000, 0),
      hp: safeNumber(player.hp, -10, 250, 100),
      alive: Boolean(player.alive),
      downed: Boolean(player.downed),
      stamina: safeNumber(player.stamina, 0, 100, 100),
      teamId: typeof player.teamId === "number" ? player.teamId : null,
      teamColor: player.teamColor || null,
      weapon: player.weapon || null,
      spectator: Boolean(player.spectator),
      mode: selectedMode,
      diff: selectedDiff,
    };
  }

  function ensureRemotePlayer(id) {
    let remote = world.remotePlayers.get(id);
    if (!remote) {
      remote = {
        id,
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        vx: 0,
        vy: 0,
        hp: 100,
        stamina: 100,
        alive: true,
        downed: false,
        r: 16,
        teamId: -999,
        teamColor: '#8bbcff',
        displayName: '',
        snapshot: null,
        lastSeen: 0,
        spectator: false,
        weapon: null,
        initialized: false,
      };
      world.remotePlayers.set(id, remote);
    }
    return remote;
  }

  function applyRemoteSnapshot(snapshot) {
    if (!snapshot || !snapshot.id) return;
    const id = String(snapshot.id);
    if (localNetworkId && id === localNetworkId) return;
    const remote = ensureRemotePlayer(id);
    if (snapshot.name) remote.displayName = String(snapshot.name).slice(0, 24);
    if (snapshot.teamColor) remote.teamColor = String(snapshot.teamColor).slice(0, 32);
    if (Number.isFinite(Number(snapshot.x))) remote.targetX = safeNumber(snapshot.x, -5000, CONFIG.mapW + 5000, Number(snapshot.x));
    if (Number.isFinite(Number(snapshot.y))) remote.targetY = safeNumber(snapshot.y, -5000, CONFIG.mapH + 5000, Number(snapshot.y));
    const prev = remote.snapshot || {};
    remote.snapshot = {
      vx: safeNumber(snapshot.vx, -4000, 4000, Number.isFinite(prev.vx) ? prev.vx : remote.vx),
      vy: safeNumber(snapshot.vy, -4000, 4000, Number.isFinite(prev.vy) ? prev.vy : remote.vy),
      hp: safeNumber(snapshot.hp, -10, 250, Number.isFinite(prev.hp) ? prev.hp : remote.hp),
      stamina: safeNumber(snapshot.stamina, 0, 100, Number.isFinite(prev.stamina) ? prev.stamina : (typeof remote.stamina === 'number' ? remote.stamina : 100)),
      alive: snapshot.alive !== undefined ? !!snapshot.alive : (typeof prev.alive === 'boolean' ? prev.alive : remote.alive),
      downed: snapshot.downed !== undefined ? !!snapshot.downed : (typeof prev.downed === 'boolean' ? prev.downed : remote.downed),
      spectator: snapshot.spectator !== undefined ? !!snapshot.spectator : (typeof prev.spectator === 'boolean' ? prev.spectator : remote.spectator),
      teamId: Number.isFinite(Number(snapshot.teamId)) ? Math.round(Number(snapshot.teamId)) : (Number.isFinite(prev.teamId) ? prev.teamId : remote.teamId),
      teamColor: remote.teamColor,
      weapon: typeof snapshot.weapon === 'string' ? snapshot.weapon : (typeof prev.weapon === 'string' ? prev.weapon : remote.weapon),
      name: remote.displayName,
      updatedAt: Number.isFinite(Number(snapshot.updatedAt)) ? Number(snapshot.updatedAt) : nowMillis(),
    };
    remote.teamId = remote.snapshot.teamId ?? remote.teamId;
    remote.spectator = remote.snapshot.spectator ?? remote.spectator;
    remote.weapon = remote.snapshot.weapon ?? remote.weapon;
    remote.lastSeen = remote.snapshot.updatedAt;
    if (!remote.initialized) {
      if (typeof remote.targetX === 'number') remote.x = remote.targetX;
      if (typeof remote.targetY === 'number') remote.y = remote.targetY;
      remote.initialized = true;
    }
  }

  function removeRemotePlayer(id) {
    if (!id) return;
    world.remotePlayers.delete(String(id));
  }

  function clearRemotePlayers() {
    world.remotePlayers.clear();
  }

  function updateRemoteEntities(dt) {
    if (!world.remotePlayers.size) return;
    const now = nowMillis();
    const lerpFactor = Math.min(1, dt * REMOTE_LERP_SPEED);
    for (const remote of world.remotePlayers.values()) {
      if (typeof remote.targetX === 'number') {
        remote.x += (remote.targetX - remote.x) * lerpFactor;
      }
      if (typeof remote.targetY === 'number') {
        remote.y += (remote.targetY - remote.y) * lerpFactor;
      }
      const snap = remote.snapshot;
      if (snap && typeof snap === 'object') {
        if (snap.vx !== undefined) remote.vx = snap.vx;
        if (snap.vy !== undefined) remote.vy = snap.vy;
        if (snap.hp !== undefined) remote.hp = snap.hp;
        if (snap.alive !== undefined) remote.alive = snap.alive;
        if (snap.downed !== undefined) remote.downed = snap.downed;
        if (snap.stamina !== undefined) remote.stamina = snap.stamina;
        if (snap.teamColor) remote.teamColor = snap.teamColor;
        if (snap.name) remote.displayName = snap.name;
        if (snap.spectator !== undefined) remote.spectator = snap.spectator;
        if (snap.weapon) remote.weapon = snap.weapon;
        remote.lastSeen = snap.updatedAt || now;
      }
    }
    for (const [id, remote] of Array.from(world.remotePlayers.entries())) {
      if (now - (remote.lastSeen || 0) > REMOTE_TIMEOUT_MS) {
        world.remotePlayers.delete(id);
      }
    }
  }

  const networkBridge = {
    captureLocalState,
    applyRemoteSnapshot,
    removeRemotePlayer,
    clearRemotePlayers,
    setLocalId: (id) => { localNetworkId = id ? String(id) : null; },
    listRemoteIds: () => Array.from(world.remotePlayers.keys()),
  };

  window.RiggedRoyale = Object.assign(window.RiggedRoyale || {}, { net: networkBridge });


  function makeTeam(id, color) { return { id, color, alive: 0 }; }
  function assignTeam(ent, team) { ent.teamId = team.id; ent.teamColor = team.color; team.alive++; }

  const COLORS = {
    bg: '#0b0e12',
    ground1: '#1f3d21',
    ground2: '#2a4d27',
    zone: 'rgba(20,160,255,0.2)',
    zoneEdge: 'rgba(80,200,255,0.6)',
    player: '#74f7a9',
    bot: '#f77171',
    bullet: '#ffd166',
    health: '#75e06b',
    ammo: '#89a8ff',
    wall: '#213042',
    wall2: '#1a2736',
  };

  const GRASS_SWATCHES = ['#2f6d31','#2b6130','#347437','#27572a'];

  const HEDGE_SWATCHES = ['#26492a','#2d5b31','#214024'];

  // Optional local assets (Option A) with safe fallbacks
  function assetPath(folder, name) {
    // ensure exactly one extension
    let file = String(name);
    if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(file)) file += '.png';

    // normalize slashes; enforce lowercase folder "props"
    const f = String(folder || '').replace(/\\/g, '/');
    const folderNorm = f.toLowerCase() === 'props' ? 'props' : f;
    return `/assets/${folderNorm}/${file}`;
  }

  const ASSET_PATHS = {
    water: assetPath('tiles', 'puddle_1'),
    bush: ['bush_1', 'bush_2', 'bush_3'].map((name) => assetPath('props', name)),
    tree: ['tree_1', 'tree_2', 'tree_3'].map((name) => assetPath('props', name)),
    crate: ['crate_1', 'crate_2'].map((name) => assetPath('props', name)),
    stone: ['stone_1', 'stone_2', 'stone_3'].map((name) => assetPath('props', name)),
    puddle: ['puddle_1', 'puddle_2', 'puddle_3'].map((name) => assetPath('props', name)),
  };
  const ASSETS = { water: null, bush: [], tree: [], crate: [], stone: [], puddle: [] };
  function withCaseVariants(path){
    if (!path) return [];
    const normalized = String(path).replace(/\\/g, '/');
    return [normalized];
  }
  function loadWithFallback(basePath, onSuccess){
    const variants = withCaseVariants(basePath);
    let idx = 0;
    let finished = false;
    const tryNext = () => {
      if (finished) return;
      if (idx >= variants.length) {
        finished = true;
        if (onSuccess) onSuccess(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (finished) return;
        finished = true;
        onSuccess && onSuccess(img);
      };
      img.onerror = () => {
        idx += 1;
        tryNext();
      };
      img.src = variants[idx];
    };
    tryNext();
  }
  (function initAssets(){
    loadWithFallback(ASSET_PATHS.water, (img) => {
      if (img && !ASSETS.water) ASSETS.water = img;
    });
    for (const key of ['bush','tree','crate','stone','puddle']) {
      const sources = ASSET_PATHS[key] || [];
      for (const base of sources) {
        loadWithFallback(base, (img) => {
          if (img) ASSETS[key].push(img);
        });
      }
    }
  })();

  const WEAPONS = {
    pistol: { name: 'Pistol', dmg: 16, spread: 0.06, rof: 6, speed: CONFIG.bulletSpeed, bulletsPerShot: 1, mag: 12, reload: 1.0, color: '#ddd' },
    rifle:  { name: 'Rifle',  dmg: 10, spread: 0.03, rof: 10, speed: CONFIG.bulletSpeed, bulletsPerShot: 1, mag: 24, reload: 1.2, color: '#9fe' },
    shotgun:{ name: 'Shotgun',dmg: 8,  spread: 0.25, rof: 1.6, speed: CONFIG.bulletSpeed*0.8, bulletsPerShot: 6, mag: 6, reload: 1.6, color: '#ffb' },
  };

  // (moved TEAM_MODES/TEAM_COLORS above world state)

  // --- Entities ---
  function makePlayer(x, y) {
    return {
      type: 'player',
      x, y, r: 16,
      vx: 0, vy: 0,
      speed: CONFIG.playerSpeed,
      hp: 100, alive: true, downed: false, bleed: 0, reviveProgress: 0,
      stamina: 100,
      weapon: 'rifle',
      inventory: ['rifle'], slot: 0,
      ammo: { pistol: 60, rifle: 120, shotgun: 36 },
      mag: WEAPONS['rifle'].mag,
      shootCd: 0, reloadT: 0,
      name: 'You',
      kills: 0,
      teamId: -1, teamColor: '#74f7a9',
    };
  }

  function makeBot(x, y, id) {
    const pool = ['pistol', 'rifle', 'shotgun'];
    const w = pool[randi(0, pool.length)];
    return {
      type: 'bot',
      id,
      x, y, r: 16,
      vx: 0, vy: 0,
      speed: CONFIG.botSpeed * world.diff.speedMult * rand(0.9, 1.05),
      hp: 100 * (world.diff.botHpMult || 1), alive: true, downed: false, bleed: 0, reviveProgress: 0,
      weapon: w,
      inventory: [w], slot: 0,
      ammo: { pistol: 60, rifle: 90, shotgun: 24 },
      mag: WEAPONS[w].mag,
      shootCd: 0, reloadT: 0,
      target: null,
      aggro: 0,
      name: 'Bot ' + (id+1),
      kills: 0,
      teamId: -1, teamColor: '#f77171',
    };
  }

  function makeBullet(owner, x, y, dx, dy, dmg, speed, ttl, color) {
    const [nx, ny] = norm(dx, dy);
    return { owner, x, y, vx: nx*speed, vy: ny*speed, ttl, dmg, r: 3, color, teamId: owner.teamId };
  }

  function makePickup(kind, x, y) {
    // kind: 'med', 'ammo-pistol', 'ammo-rifle', 'ammo-shotgun', 'weapon-...'
    return { kind, x, y, r: 12, spin: rand(0, Math.PI*2) };
  }

  function makeObstacle(x, y, w, h) {
    return { x, y, w, h };
  }

  // --- Map Generation ---
  function generateWorld() {
    // Center zone
    world.zone.x = CONFIG.mapW/2; world.zone.y = CONFIG.mapH/2; world.zone.r = CONFIG.zone.startRadius; world.zone.rTarget = world.zone.r;
    // Obstacles
    world.obstacles = [];
    for (let i=0;i<CONFIG.obstacles;i++) {
      const w = randi(70, 180), h = randi(70, 180);
      const x = randi(100, CONFIG.mapW - w - 100);
      const y = randi(100, CONFIG.mapH - h - 100);
      world.obstacles.push(makeObstacle(x, y, w, h));
    }
    // Decorative props (no collisions)
    world.bushes = [];
    for (let i=0;i<40;i++) {
      const r = randi(26, 42);
      const x = randi(r+10, CONFIG.mapW-r-10);
      const y = randi(r+10, CONFIG.mapH-r-10);
      world.bushes.push({ x, y, r, rot: rand(0, Math.PI*2) });
    }
    // Trees (decor)
    world.trees = [];
    for (let i=0;i<28;i++) {
      const r = randi(32, 54);
      const x = randi(r+10, CONFIG.mapW-r-10);
      const y = randi(r+10, CONFIG.mapH-r-10);
      world.trees.push({ x, y, r, rot: rand(0, Math.PI*2) });
    }
    // Stones (decor)
    world.stones = [];
    for (let i=0;i<26;i++) {
      const r = randi(22, 34);
      const x = randi(r+10, CONFIG.mapW-r-10);
      const y = randi(r+10, CONFIG.mapH-r-10);
      world.stones.push({ x, y, r, rot: rand(0, Math.PI*2) });
    }
    // Crates now ride on weapon pickups for visuals
    world.crates = [];
    world.puddles = [];
    for (let i=0;i<20;i++) {
      const r = randi(35, 60);
      const x = randi(r+10, CONFIG.mapW-r-10);
      const y = randi(r+10, CONFIG.mapH-r-10);
      world.puddles.push({ x, y, r, rot: rand(0, Math.PI*2) });
    }

    // Pickups
    world.pickups = [];
    const kinds = ['med','ammo-pistol','ammo-rifle','ammo-shotgun','weapon-pistol','weapon-rifle','weapon-shotgun'];
    const count = Math.max(8, Math.round(CONFIG.pickups * (world.diff.pickupsMult || 1)));
    for (let i=0;i<count;i++) {
      const x = randi(80, CONFIG.mapW-80);
      const y = randi(80, CONFIG.mapH-80);
      world.pickups.push(makePickup(kinds[randi(0, kinds.length)], x, y));
    }
  }

  // --- Prop Helpers ---
  function circleContains(obj, x, y, pad = 0) {
    if (!obj) return false;
    const r = (obj.r || 0) + pad;
    if (r <= 0) return false;
    return dist2(obj.x, obj.y, x, y) <= r * r;
  }
  function findPropAt(list, x, y, pad = 0) {
    if (!list) return null;
    for (const item of list) {
      if (circleContains(item, x, y, pad)) return item;
    }
    return null;
  }
  function getBushAt(x, y) {
    return findPropAt(world.bushes, x, y);
  }
  function getPuddleAt(x, y) {
    return findPropAt(world.puddles, x, y);
  }
  function updatePropState(ent) {
    if (!ent) return;
    ent._bush = getBushAt(ent.x, ent.y);
    ent.inBush = !!ent._bush;
    ent._puddle = getPuddleAt(ent.x, ent.y);
    ent.inPuddle = !!ent._puddle;
  }

  function computeAvoidance(ent) {
    if (!ent) return [0, 0];
    let ax = 0, ay = 0;
    const rectAvoid = (ob) => {
      const pad = ent.r + 60;
      const cx = clamp(ent.x, ob.x - pad, ob.x + ob.w + pad);
      const cy = clamp(ent.y, ob.y - pad, ob.y + ob.h + pad);
      let dx = ent.x - cx;
      let dy = ent.y - cy;
      const d2 = dx*dx + dy*dy;
      if (d2 < pad*pad && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const strength = (pad - d) / pad;
        ax += (dx / d) * strength;
        ay += (dy / d) * strength;
      } else if (d2 <= 0.0001) {
        const angle = Math.random() * Math.PI * 2;
        ax += Math.cos(angle) * 0.35;
        ay += Math.sin(angle) * 0.35;
      }
    };
    const circleAvoid = (obj) => {
      const or = (obj.r || 0);
      const radius = or + ent.r + 45;
      if (radius <= 0) return;
      const dx = ent.x - obj.x;
      const dy = ent.y - obj.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < radius * radius && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const strength = (radius - d) / radius;
        ax += (dx / d) * strength;
        ay += (dy / d) * strength;
      }
    };
    for (const ob of world.obstacles) rectAvoid(ob);
    for (const st of world.stones) circleAvoid(st);
    for (const tr of world.trees) circleAvoid(tr);
    return [ax, ay];
  }

  const PUDDLE_SLOW_MULT = 0.55;
  function getSpeedMultiplier(ent) {
    if (!ent) return 1;
    const puddle = ent._puddle || getPuddleAt(ent.x, ent.y);
    return puddle ? PUDDLE_SLOW_MULT : 1;
  }
  function isEntityHiddenFrom(observer, target) {
    if (!observer || !target) return false;
    const bush = target._bush || getBushAt(target.x, target.y);
    if (!bush) return false;
    if (circleContains(bush, observer.x, observer.y)) return false;
    const targetRadius = target.r || 16;
    const revealRadius = targetRadius + Math.max(18, bush.r * 0.4);
    if (dist2(observer.x, observer.y, target.x, target.y) <= revealRadius * revealRadius) return false;
    return true;
  }

  // --- Helpers: Collision ---
  function moveWithCollisions(ent, dt) {
    let nx = ent.x + ent.vx * dt;
    let ny = ent.y + ent.vy * dt;
    // Map bounds
    nx = clamp(nx, ent.r, CONFIG.mapW - ent.r);
    ny = clamp(ny, ent.r, CONFIG.mapH - ent.r);
    // Resolve against obstacles
    for (const ob of world.obstacles) {
      // Compute closest point on rect to circle center
      const cx = clamp(nx, ob.x, ob.x + ob.w);
      const cy = clamp(ny, ob.y, ob.y + ob.h);
      let dx = nx - cx;
      let dy = ny - cy;
      const d2 = dx*dx + dy*dy;
      if (d2 <= ent.r * ent.r) {
        if (dx !== 0 || dy !== 0) {
          // Push out along normal
          const d = Math.sqrt(d2) || 1;
          const ux = dx / d, uy = dy / d;
          const pen = ent.r - d + 0.5;
          nx += ux * pen; ny += uy * pen;
        } else {
          // Center is inside the rect; push out along smallest axis to nearest edge
          const left = Math.abs(nx - ob.x);
          const right = Math.abs(ob.x + ob.w - nx);
          const top = Math.abs(ny - ob.y);
          const bottom = Math.abs(ob.y + ob.h - ny);
          const minEdge = Math.min(left, right, top, bottom);
          if (minEdge === left) nx = ob.x - ent.r - 0.5;
          else if (minEdge === right) nx = ob.x + ob.w + ent.r + 0.5;
          else if (minEdge === top) ny = ob.y - ent.r - 0.5;
          else ny = ob.y + ob.h + ent.r + 0.5;
        }
      }
    }
    const resolveCircleSolids = (solids, radiusScale = 1) => {
      if (!solids) return;
      for (const solid of solids) {
        const sr = (solid.r || 0) * radiusScale;
        const total = ent.r + sr;
        if (total <= 0) continue;
        const dx = nx - solid.x;
        const dy = ny - solid.y;
        const d2 = dx*dx + dy*dy;
        if (d2 < total * total) {
          const d = Math.sqrt(d2);
          const pen = total - d + 0.5;
          if (d > 0.0001) {
            const ux = dx / d;
            const uy = dy / d;
            nx += ux * pen;
            ny += uy * pen;
          } else {
            const theta = (Math.atan2(ent.vy, ent.vx) || 0) + Math.PI;
            nx = solid.x + Math.cos(theta) * (total + 0.5);
            ny = solid.y + Math.sin(theta) * (total + 0.5);
          }
        }
      }
    };
    resolveCircleSolids(world.stones, 0.95);
    resolveCircleSolids(world.trees, 1.05);
    ent.x = nx; ent.y = ny;
    updatePropState(ent);
  }

  function bulletHitsWall(b) {
    for (const ob of world.obstacles) {
      if (b.x >= ob.x && b.x <= ob.x+ob.w && b.y >= ob.y && b.y <= ob.y+ob.h) return true;
    }
    for (const st of world.stones) {
      if (circleContains(st, b.x, b.y, b.r)) return true;
    }
    for (const tr of world.trees) {
      if (circleContains(tr, b.x, b.y, b.r)) return true;
    }
    return false;
  }

  // --- Weapons / Shooting ---
  function canShoot(e) { return e.alive && !e.downed && e.reloadT <= 0 && e.shootCd <= 0 && e.mag > 0; }
  function doShoot(e, tx, ty, spreadAdd = 0, rofMult = 1, dmgMult = 1) {
    const W = WEAPONS[e.weapon];
    if (!canShoot(e)) return false;
    e.mag--;
    e.shootCd = 1 / (W.rof * rofMult);
    const baseAng = Math.atan2(ty - e.y, tx - e.x);
    for (let i=0;i<W.bulletsPerShot;i++) {
      const s = W.spread + spreadAdd;
      const a = baseAng + rand(-s, s);
      const dx = Math.cos(a), dy = Math.sin(a);
      world.bullets.push(makeBullet(e, e.x + dx*(e.r+2), e.y + dy*(e.r+2), dx, dy, W.dmg * dmgMult, W.speed, CONFIG.bulletLife, COLORS.bullet));
    }
    blip(420 + Math.random()*60, 0.045, 'square', 0.04);
    world.camera.shake = Math.min(10, world.camera.shake + (e.type==='player'?3:1));
    return true;
  }
  function tryReload(e) {
    const W = WEAPONS[e.weapon];
    const need = W.mag - e.mag;
    if (need <= 0 || e.reloadT > 0) return;
    const pool = Math.max(0, e.ammo[e.weapon] || 0);
    if (pool <= 0) return;
    const take = Math.min(need, pool);
    const reloadMult = e.type === 'bot' ? (world.diff.botReloadMult || 1) : 1;
    e.reloadT = W.reload * reloadMult;
    e.ammo[e.weapon] -= take;
    e._pendingMag = (e.mag + take);
    blip(220, 0.08, 'sawtooth', 0.05);
  }

  // --- Game Flow ---
  function computePartySpawn(matchSeed, partyCtx, selfId) {
    if (!matchSeed || !matchSeed.seed || !partyCtx || !partyCtx.code) return null;
    const baseKey = `${partyCtx.code}:${matchSeed.seed}:${matchSeed.counter || 0}`;
    const baseRng = makeSeededRng(baseKey);
    const centerX = clamp(Math.round(200 + baseRng() * (CONFIG.mapW - 400)), 200, CONFIG.mapW - 200);
    const centerY = clamp(Math.round(200 + baseRng() * (CONFIG.mapH - 400)), 200, CONFIG.mapH - 200);
    if (!selfId) {
      return { x: centerX, y: centerY };
    }
    const memberRng = makeSeededRng(`${baseKey}:${selfId}`);
    const angle = memberRng() * Math.PI * 2;
    const radius = 50 + memberRng() * 90;
    const spawnX = clamp(centerX + Math.cos(angle) * radius, 120, CONFIG.mapW - 120);
    const spawnY = clamp(centerY + Math.sin(angle) * radius, 120, CONFIG.mapH - 120);
    return { x: spawnX, y: spawnY };
  }

  async function startGame() {
    if (startGamePromise) {
      return startGamePromise;
    }
    startGamePromise = (async () => {
      let spawnOverride = null;
      let seededRng = null;
      let started = false;
      const mpBridge = getMpBridge();
      let partyCtx = null;
      let selfId = null;
      if (mpBridge) {
        if (typeof mpBridge.getPartyContext === 'function') {
          partyCtx = mpBridge.getPartyContext();
        }
        if (typeof mpBridge.getSelfId === 'function') {
          selfId = mpBridge.getSelfId();
        }
      }
      const inParty = partyCtx && partyCtx.code;
      const isHost = inParty && partyCtx && partyCtx.hostId === selfId;
      if (!inParty) {
        activeMatchCounter = null;
      }
      if (mpBridge) {
        ensureAutoMatchSubscription();
        try {
          const ensureSeed =
            typeof mpBridge.ensureMatchSeed === 'function'
              ? mpBridge.ensureMatchSeed({ fresh: true })
              : null;
          const info = ensureSeed ? await ensureSeed : null;
          if (!info) {
            if (inParty && !isHost) {
              if (typeof mpBridge.notifyAwaitingHost === 'function') {
                mpBridge.notifyAwaitingHost();
              }
              subtitle.textContent = 'Waiting for host to start the match';
              showOverlay();
              return false;
            }
            activeMatchCounter = null;
          } else {
            const counter = toMatchCounter(info.counter);
            activeMatchCounter = counter;
            spawnOverride = computePartySpawn(info, partyCtx, selfId);
            const seedKey = `${info.seed}:${info.counter || 0}:${
              partyCtx && partyCtx.code ? partyCtx.code : ''
            }`;
            seededRng = makeSeededRng(seedKey);
            if (typeof mpBridge.markSeedActive === 'function') {
              mpBridge.markSeedActive(info.counter);
            }
          }
        } catch (err) {
          console.warn('Failed to synchronize multiplayer match seed', err);
        }
      } else {
        activeMatchCounter = null;
      }

      let seededApplied = false;
      if (seededRng) {
        setRandomSource(seededRng);
        seededApplied = true;
      } else {
        setRandomSource(null);
      }

      try {
        world.time = 0;
        world.phase = 0;
        world.phaseTimer = CONFIG.zone.holdTime;
        world.zone.r = CONFIG.zone.startRadius;
        world.zone.rTarget = CONFIG.zone.startRadius;
        world.zoneState = { mode: 'hold', timer: CONFIG.zone.holdTime, t: 0, T: 0, startR: world.zone.r, targetR: world.zone.r };
        world.diff = DIFFICULTY[selectedDiff] || DIFFICULTY.insane;
        world.mode = TEAM_MODES[selectedMode] || TEAM_MODES.solos;
        generateWorld();
        world.bullets = [];
        world.bots = [];
        clearRemotePlayers();
        world.teams = [];
        let colorIdx = 0;
        const nextColor = () => TEAM_COLORS[colorIdx++ % TEAM_COLORS.length];
        const spawn =
          spawnOverride || { x: randi(200, CONFIG.mapW - 200), y: randi(200, CONFIG.mapH - 200) };
        const px = clamp(spawn.x, 120, CONFIG.mapW - 120);
        const py = clamp(spawn.y, 120, CONFIG.mapH - 120);
        world.player = makePlayer(px, py);
        world.graceTimer = 1.0;
        // Player team
        const teamSize = world.mode.teamSize;
        const playerTeam = makeTeam(0, nextColor());
        world.teams.push(playerTeam);
        assignTeam(world.player, playerTeam);
        // Teammates
        let remainingBots = Math.max(0, world.diff.bots);
        for (let i = 0; i < teamSize - 1; i++) {
          const mate = makeBot(px + randi(-120, 120), py + randi(-120, 120), i);
          assignTeam(mate, playerTeam);
          world.bots.push(mate);
        }
        remainingBots -= Math.max(0, teamSize - 1);
        // Enemy teams
        let teamId = 1;
        while (remainingBots > 0) {
          const t = makeTeam(teamId++, nextColor());
          world.teams.push(t);
          const spawnCount = Math.min(world.mode.teamSize, remainingBots);
          let x, y;
          do {
            x = randi(100, CONFIG.mapW - 100);
            y = randi(100, CONFIG.mapH - 100);
          } while (dist2(x, y, px, py) < 600 * 600);
          for (let k = 0; k < spawnCount; k++) {
            const b = makeBot(x + randi(-140, 140), y + randi(-140, 140), world.bots.length);
            assignTeam(b, t);
            world.bots.push(b);
          }
          remainingBots -= spawnCount;
        }
        hideOverlay();
        world.running = true;
        world.paused = false;
        started = true;
      } finally {
        if (seededApplied) {
          setRandomSource(null);
        }
      }
      return started;
    })();
    try {
      return await startGamePromise;
    } finally {
      startGamePromise = null;
    }
  }

  // --- Weapons & Inventory helpers ---
  function setWeapon(e, idx) {
    if (!e.inventory || idx < 0 || idx >= e.inventory.length) return;
    e.slot = idx; e.weapon = e.inventory[e.slot];
    if (e.mag > WEAPONS[e.weapon].mag) e.mag = WEAPONS[e.weapon].mag;
  }
  function cycleWeapon(e, dir) {
    if (!e.inventory || e.inventory.length <= 1) return;
    const n = e.inventory.length; setWeapon(e, (e.slot + dir + n) % n);
  }
  function addWeaponToInv(e, w) {
    if (!WEAPONS[w]) return;
    if (!e.inventory) e.inventory = [];
    if (!e.inventory.includes(w)) {
      if (e.inventory.length < 3) e.inventory.push(w); else e.inventory[e.slot] = w;
      e.slot = Math.min(e.slot, e.inventory.length-1);
    } else {
      e.slot = e.inventory.indexOf(w);
    }
    e.weapon = e.inventory[e.slot];
    e.mag = WEAPONS[e.weapon].mag;
  }

  function saveDiff() {
    try { localStorage.setItem('riggedroyale.diff', selectedDiff); } catch (_) {}
  }
  function loadDiff() {
    try {
      const v = localStorage.getItem('riggedroyale.diff');
      if (v && DIFFICULTY[v]) selectedDiff = v;
      diffBtns.forEach(b => b.classList.toggle('selected', b.dataset.diff === selectedDiff));
    } catch (_) {}
  }
  function saveMode() {
    try { localStorage.setItem('riggedroyale.mode', selectedMode); } catch (_) {}
  }
  function loadMode() {
    try {
      const v = localStorage.getItem('riggedroyale.mode');
      if (v && TEAM_MODES[v]) selectedMode = v;
      modeBtns.forEach(b => b.classList.toggle('selected', b.dataset.mode === selectedMode));
    } catch (_) {}
  }

  function setJoystickEnabled(enabled, fromToggle = false) {
    joystickEnabled = !!enabled;
    if (joystickToggle && joystickToggle.checked !== joystickEnabled) {
      joystickToggle.checked = joystickEnabled;
    }
    document.body.classList.toggle('joystick-enabled', joystickEnabled);
    if (!fromToggle) saveJoystick();
    if (typeof updateJoystickOverlay === 'function') updateJoystickOverlay();
  }
  function saveJoystick() {
    try { localStorage.setItem('riggedroyale.joystick', joystickEnabled ? '1' : '0'); } catch (_) {}
  }
  function loadJoystick() {
    try {
      const v = localStorage.getItem('riggedroyale.joystick');
      if (v === '1') setJoystickEnabled(true);
      else setJoystickEnabled(false);
    } catch (_) { setJoystickEnabled(false); }
  }

  function hideOverlay(){
    try {
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
      overlay.style.opacity = '0';
      bodyEl.classList.add('playing');
    } catch(_) {}
  }
  function showOverlay(){
    try {
      // Don't show during active unpaused gameplay
      if (world && world.running && !world.paused) { hideOverlay(); return; }
      overlay.classList.remove('hidden');
      overlay.style.display = 'grid';
      overlay.style.visibility = 'visible';
      overlay.style.pointerEvents = 'auto';
      overlay.style.opacity = '1';
      bodyEl.classList.remove('playing');
    } catch(_) {}
  }
  playBtn.addEventListener('click', async () => {
    hideOverlay();
    let started = true;
    if (!world.running || !world.player) {
      started = await startGame();
    } else {
      world.paused = false;
    }
    if (started) {
      // double-check in next frame
      requestAnimationFrame(() => hideOverlay());
    }
  });
  restartBtn.addEventListener('click', async () => {
    const started = await startGame();
    if (started) {
      saveDiff();
      saveMode();
    }
  });
  spectateBtn.addEventListener('click', () => {
    if (!world.player) return;
    world.spectating = true;
    world.paused = false;
    hideOverlay();
    world.player.spectator = true;
    world.player.downed = false; // ensure free movement
  });
  function goToMenu() {
    world.running = false; world.paused = false; world.spectating = false;
    title.textContent = 'Rigged Royale';
    subtitle.textContent = 'Last one standing wins. Good luck!';
    playBtn.textContent = 'Play';
    restartBtn.classList.add('hidden');
    deathActions.classList.add('hidden');
    mainActions.classList.remove('hidden');
    showOverlay();
  }
  menuBtn.addEventListener('click', goToMenu);
  loadDiff(); loadMode(); loadJoystick();

  // --- AI ---
  function botAI(bot, dt) {
    if (!bot.alive) return;
    if (bot.downed) { bot.vx *= 0.8; bot.vy *= 0.8; return; }
    const p = world.player;
    const seeRange2 = world.diff.seeRange * world.diff.seeRange;
    const tooClose2 = 160*160;
    const terrainMul = getSpeedMultiplier(bot);

    // find nearest visible enemy
    let best = null, bestD2 = Infinity;
    const consider = (e) => {
      if (!e || !e.alive || e.downed) return; // ignore dead/downed
      if (e.teamId === bot.teamId) return; // skip allies (in solos every bot has unique team)
      if (isEntityHiddenFrom(bot, e)) return;
      const d2 = dist2(bot.x, bot.y, e.x, e.y);
      if (d2 < bestD2 && d2 < seeRange2 && lineOfSight(bot.x, bot.y, e.x, e.y)) { bestD2 = d2; best = e; }
    };
    consider(p);
    for (const o of world.bots) consider(o);
    if (best) bot.aggro = 3; else bot.aggro = Math.max(0, bot.aggro - dt);

    // revive nearest downed ally if close
    let downAlly = null, downD2 = Infinity;
    for (const o of [p, ...world.bots]) {
      if (!o || !o.alive || !o.downed) continue;
      if (o.teamId !== bot.teamId) continue;
      const d2 = dist2(bot.x, bot.y, o.x, o.y);
      if (d2 < downD2) { downD2 = d2; downAlly = o; }
    }

    if (downAlly && downD2 < 220*220) {
      let [dxr, dyr] = norm(downAlly.x - bot.x, downAlly.y - bot.y);
      const [ax, ay] = computeAvoidance(bot);
      if (ax || ay) {
        const mix = norm(dxr + ax * 1.6, dyr + ay * 1.6);
        dxr = mix[0]; dyr = mix[1];
      }
      bot.vx = lerp(bot.vx, dxr * bot.speed * terrainMul, 0.12);
      bot.vy = lerp(bot.vy, dyr * bot.speed * terrainMul, 0.12);
      if (downD2 < (bot.r+28)*(bot.r+28)) downAlly.reviveProgress = Math.min(1, (downAlly.reviveProgress||0) + dt/2.5);
      return;
    }

    let tx = world.zone.x, ty = world.zone.y;
    if (bot.aggro > 0 && best) {
      const a = Math.atan2(best.y - bot.y, best.x - bot.x);
      const dist = Math.sqrt(bestD2);
      const desired = dist < Math.sqrt(tooClose2) ? a + Math.PI : a + (Math.random()<0.5?Math.PI/2:-Math.PI/2);
      const radius = dist < 300 ? 120 : 220;
      tx = best.x + Math.cos(desired) * radius;
      ty = best.y + Math.sin(desired) * radius;
      const jitter = Math.random()*0.12;
      if (Math.random() < world.diff.aimProb) {
        doShoot(bot,
          best.x + Math.cos(a)*jitter*100,
          best.y + Math.sin(a)*jitter*100,
          world.diff.spreadAdd,
          world.diff.botRofMult || 1,
          world.diff.botDmgMult || 1);
      }
      if (bot.mag <= 0) tryReload(bot);
    } else {
      // ally follow player; others wander toward safe
      if (bot.teamId === p.teamId) {
        const t = world.time + bot.id*2.7;
        const radius = 140;
        tx = p.x + Math.cos(t)*radius; ty = p.y + Math.sin(t*0.9)*radius;
      } else {
        const t = world.time + bot.id*12.3;
        tx = world.zone.x + Math.cos(t*0.2)*world.zone.r*0.45;
        ty = world.zone.y + Math.sin(t*0.25)*world.zone.r*0.45;
      }
    }

    let [dx, dy] = norm(tx - bot.x, ty - bot.y);
    const [ax, ay] = computeAvoidance(bot);
    if (ax || ay) {
      const mixed = norm(dx + ax * 1.8, dy + ay * 1.8);
      dx = mixed[0]; dy = mixed[1];
    }
    bot.vx = lerp(bot.vx, dx * bot.speed * terrainMul, 0.12);
    bot.vy = lerp(bot.vy, dy * bot.speed * terrainMul, 0.12);
  }

  function lineOfSight(x1,y1,x2,y2) {
    // coarse check: step along the segment and see if inside any obstacle
    const steps = 12;
    for (let i=1;i<=steps;i++) {
      const t = i/steps; const x = lerp(x1,x2,t), y = lerp(y1,y2,t);
      for (const ob of world.obstacles) {
        if (x>=ob.x && x<=ob.x+ob.w && y>=ob.y && y<=ob.y+ob.h) return false;
      }
      for (const st of world.stones) {
        if (circleContains(st, x, y)) return false;
      }
      for (const tr of world.trees) {
        if (circleContains(tr, x, y)) return false;
      }
    }
    return true;
  }

  // --- Update ---
  let lastT = 0;
  // draw function handle initialized; assigned later
  let draw = function(){};
  function tick(ts) {
    if (!lastT) lastT = ts;
    const dt = Math.min(0.05, (ts - lastT) / 1000);
    lastT = ts;
    if (world.running && !world.paused) update(dt);
    draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function update(dt) {
    world.time += dt;
    if (world.graceTimer > 0) world.graceTimer -= dt;

    // Hotkeys
    if (keys.has('KeyP')) {
      world.paused = !world.paused; keys.delete('KeyP');
      if (world.paused) {
        title.textContent = 'Paused';
        subtitle.textContent = 'Press Play to resume or Restart';
        playBtn.textContent = 'Resume';
        restartBtn.classList.remove('hidden');
        showOverlay();
      } else {
        hideOverlay();
      }
    }
    if (keys.has('KeyM')) { audioMuted = !audioMuted; keys.delete('KeyM'); }

    // Ensure overlay is hidden during active play (force every tick)
    if (world.running && !world.paused) {
      hideOverlay(); bodyEl.classList.add('playing');
    } else {
      bodyEl.classList.remove('playing');
    }

    // Zone phase logic (hold -> shrink)
    const phaseCount = CONFIG.zone.phases;
    if (world.phase < phaseCount) {
      if (world.zoneState.mode === 'hold') {
        world.zoneState.timer -= dt;
        if (world.zoneState.timer <= 0) {
          const t = (world.phase + 1) / phaseCount;
          world.zone.rTarget = lerp(CONFIG.zone.startRadius, CONFIG.zone.endRadius, t);
          world.zoneState = { mode: 'shrink', timer: 0, t: 0, T: CONFIG.zone.shrinkTime, startR: world.zone.r, targetR: world.zone.rTarget };
        }
      } else if (world.zoneState.mode === 'shrink') {
        world.zoneState.t += dt;
        const a = clamp(world.zoneState.t / world.zoneState.T, 0, 1);
        world.zone.r = lerp(world.zoneState.startR, world.zoneState.targetR, a);
        if (a >= 1) {
          world.phase++;
          if (world.phase >= phaseCount) {
            world.zoneState = { mode: 'final', timer: 0, t: 0, T: 0, startR: world.zone.r, targetR: world.zone.r };
          } else {
            world.zoneState = { mode: 'hold', timer: CONFIG.zone.holdTime, t: 0, T: 0, startR: world.zone.r, targetR: world.zone.r };
          }
        }
      }
    }

    // Player input
    const p = world.player;
    if (p && (p.alive || p.spectator)) {
      if (p.downed) { p.vx *= 0.85; p.vy *= 0.85; }
      const mx = mouse.x + world.camera.x;
      const my = mouse.y + world.camera.y;
      const aimAng = Math.atan2(my - p.y, mx - p.x);
      const up = keys.has('KeyW') ? 1 : 0;
      const down = keys.has('KeyS') ? 1 : 0;
      const left = keys.has('KeyA') ? 1 : 0;
      const right = keys.has('KeyD') ? 1 : 0;
      let ix = right - left;
      let iy = down - up;
      let joystickMag = 0;
      if (joystickEnabled) {
        const jm = Math.hypot(joystickState.x, joystickState.y);
        joystickMag = jm;
        if (jm > JOYSTICK_DEADZONE) {
          const normX = joystickState.x / (jm || 1);
          const normY = joystickState.y / (jm || 1);
          const scaled = clamp((jm - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE), 0, 1);
          ix += normX * scaled;
          iy += normY * scaled;
        }
      }
      const moveIntensity = clamp(Math.hypot(ix, iy), 0, 1);
      [ix, iy] = norm(ix, iy);
      // sprint with Shift or analog deflection
      if (p.spectator) {
        // Ghost movement: free fly, boost with Shift; ignore stamina
        const ghostBase = CONFIG.playerSpeed * 2.0;
        const ghostMul = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1.8 : 1.0;
        const accel = 0.28;
        p.vx = lerp(p.vx, ix * ghostBase * ghostMul * moveIntensity, accel);
        p.vy = lerp(p.vy, iy * ghostBase * ghostMul * moveIntensity, accel);
      } else {
        const usingJoystick = joystickEnabled && joystickMag > JOYSTICK_DEADZONE + 0.02;
        const sprintHold = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && p.stamina > 0.5 && moveIntensity > 0;
        const sprintAnalog = usingJoystick && joystickMag > 0.92 && p.stamina > 0.5;
        const sprinting = (sprintHold || sprintAnalog) && (ix !== 0 || iy !== 0);
        const spdMul = sprinting ? 1.5 : 1.0;
        const accel = 0.25;
        if (!p.downed) {
          const terrainMul = getSpeedMultiplier(p);
          p.vx = lerp(p.vx, ix * p.speed * spdMul * moveIntensity * terrainMul, accel);
          p.vy = lerp(p.vy, iy * p.speed * spdMul * moveIntensity * terrainMul, accel);
        }
        // stamina drain/regeneration
        const drain = 30, regen = 18;
        if (sprinting) p.stamina = Math.max(0, p.stamina - drain * dt);
        else p.stamina = Math.min(100, p.stamina + regen * dt);

        if (p.alive && !p.downed && mouse.down) doShoot(p, mx, my);
        if (keys.has('KeyR')) { tryReload(p); keys.delete('KeyR'); }
        if (keys.has('Digit1')) { setWeapon(p,0); keys.delete('Digit1'); }
        if (keys.has('Digit2')) { setWeapon(p,1); keys.delete('Digit2'); }
        if (keys.has('Digit3')) { setWeapon(p,2); keys.delete('Digit3'); }
        if (keys.has('KeyE')) {
          let target=null, best=1e9;
          for (const o of world.bots) if (o.alive && o.downed && o.teamId===p.teamId) {
            const d2 = dist2(p.x,p.y,o.x,o.y); if (d2<best) { best=d2; target=o; }
          }
          if (target && best < (p.r+32)*(p.r+32)) target.reviveProgress = Math.min(1, (target.reviveProgress||0) + dt/2.5);
        }
      }

    // Update reloads and cooldowns
    for (const e of [p, ...world.bots]) if (e) {
      if (e.shootCd > 0) e.shootCd -= dt;
      if (e.reloadT > 0) { e.reloadT -= dt; if (e.reloadT <= 0 && e._pendingMag != null) { e.mag = e._pendingMag; delete e._pendingMag; } }
      if (e.downed) {
        if (e.reviveProgress && e.reviveProgress >= 1) {
          e.downed = false; e.hp = 40; e.reviveProgress = 0;
        } else if (e.reviveProgress) {
          // small decay when no one reviving
          e.reviveProgress = Math.max(0, e.reviveProgress - dt*0.2);
        }
      }
    }

    // Move entities
    if (p && p.alive) moveWithCollisions(p, dt);
    // Ghost movement ignores collisions
    if (p && p.spectator) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      updatePropState(p);
    }
    for (const b of world.bots) if (b.alive) {
      botAI(b, dt);
      moveWithCollisions(b, dt);
    }

    // Friction
    if (p) { p.vx *= CONFIG.baseFriction; p.vy *= CONFIG.baseFriction; }
    for (const b of world.bots) { b.vx *= CONFIG.baseFriction; b.vy *= CONFIG.baseFriction; }
    updateRemoteEntities(dt);

    // Bullets
    const survivors = [];
    for (const b of world.bullets) {
      b.ttl -= dt; if (b.ttl <= 0) continue;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0 || b.y < 0 || b.x > CONFIG.mapW || b.y > CONFIG.mapH) continue;
      if (bulletHitsWall(b)) continue;
      let hit = false;
      if (p && p.alive && !p.downed && b.owner !== p && b.teamId !== p.teamId) {
        if (dist2(b.x, b.y, p.x, p.y) <= (p.r+2)*(p.r+2)) { p.hp -= b.dmg; hit = true; if (p.hp <= 0 && p.alive) { if (world.mode && world.mode.teamSize>1) { p.hp = 0; p.downed = true; p.bleed = 45; } else { p.alive = false; } blip(120, 0.2, 'triangle', 0.06); } }
      }
      for (const bot of world.bots) if (bot.alive && !bot.downed && b.owner !== bot && b.teamId !== bot.teamId) {
        if (dist2(b.x, b.y, bot.x, bot.y) <= (bot.r+2)*(bot.r+2)) { bot.hp -= b.dmg; hit = true; if (bot.hp <= 0 && bot.alive) { if (world.mode && world.mode.teamSize>1) { bot.hp = 0; bot.downed = true; bot.bleed = 45; } else { bot.alive = false; } b.owner && (b.owner.kills = (b.owner.kills||0)+1); blip(160, 0.12, 'triangle', 0.05); } }
      }
      if (!hit) survivors.push(b);
    }
    world.bullets = survivors;

    // Outside zone damage
    const applyZoneDmg = (e) => {
      const inZone = dist2(e.x, e.y, world.zone.x, world.zone.y) <= world.zone.r*world.zone.r;
      if (!inZone && !e.downed) e.hp -= (CONFIG.damageOutsideZonePerSec * (world.diff.zoneDmgMult||1)) * dt;
      if (e.hp <= 0 && e.alive) {
        if (world.mode && world.mode.teamSize>1 && !e.downed) { e.hp = 0; e.downed = true; e.bleed = 45; }
        else e.alive = false;
      }
      if (e.downed) { e.bleed -= dt; if (e.bleed <= 0) { e.alive = false; e.downed = false; } }
    };
    if (p && p.alive) applyZoneDmg(p);
    for (const b of world.bots) if (b.alive) applyZoneDmg(b);

    // Pickups
    const pkSurvivors = [];
    for (const pk of world.pickups) {
      pk.spin += dt * 2;
      let taken = false;
      const tryTake = (e) => {
        if (!e || !e.alive) return false;
        if (dist2(e.x, e.y, pk.x, pk.y) > (e.r+pk.r)*(e.r+pk.r)) return false;
        const k = pk.kind;
        if (k === 'med') { e.hp = clamp(e.hp + 50, 0, 100); taken = true; blip(520, 0.1, 'sine', 0.04); return true; }
        if (k.startsWith('ammo-')) { const t = k.split('-')[1]; e.ammo[t] = (e.ammo[t]||0)+ (t==='shotgun'?12: t==='rifle'?36:30); taken = true; blip(340, 0.08, 'sine', 0.04); return true; }
        if (k.startsWith('weapon-')) { const w = k.split('-')[1]; addWeaponToInv(e, w); taken = true; blip(600, 0.09, 'square', 0.045); return true; }
        return false;
      };
      if (tryTake(p)) {} else {
        for (const b of world.bots) { if (tryTake(b)) break; }
      }
      if (!taken) pkSurvivors.push(pk);
    }
    world.pickups = pkSurvivors;

    // Camera follows player
    const vw = canvas.clientWidth, vh = canvas.clientHeight;
    const targetCx = clamp((p? p.x: CONFIG.mapW/2) - vw/2, 0, CONFIG.mapW - vw);
    const targetCy = clamp((p? p.y: CONFIG.mapH/2) - vh/2, 0, CONFIG.mapH - vh);
    world.camera.x = lerp(world.camera.x, targetCx, 0.15);
    world.camera.y = lerp(world.camera.y, targetCy, 0.15);
    if (world.camera.shake > 0) world.camera.shake -= 60*dt;

    // Win/Lose and Spectate flow
    const playerTeamId = p ? p.teamId : -1;
    const aliveByTeam = new Map();
    const mark = (e) => { if (e && e.alive) aliveByTeam.set(e.teamId, (aliveByTeam.get(e.teamId)||0) + 1); };
    mark(p); for (const b of world.bots) mark(b);
    const aliveTeams = Array.from(aliveByTeam.keys());
    const playerTeamAlive = (aliveByTeam.get(playerTeamId) || 0) > 0;
    if (world.graceTimer <= 0 && (!p || !p.alive)) {
      if (!world.spectating) {
        // Show You Died screen with Spectate/Menu
        world.paused = true;
        title.textContent = 'You Died';
        subtitle.textContent = 'Spectate or return to menu';
        playBtn.textContent = 'Resume';
        restartBtn.classList.add('hidden');
        mainActions.classList.add('hidden');
        deathActions.classList.remove('hidden');
        showOverlay();
      } else {
        // If spectating, show Game Ended only when match ends
        if (aliveTeams.length === 1) {
          world.running = false;
          world.paused = true;
          title.textContent = 'Game Ended';
          subtitle.textContent = 'Thanks for watching';
          deathActions.classList.add('hidden');
          mainActions.classList.remove('hidden');
          playBtn.textContent = 'Play';
          restartBtn.classList.add('hidden');
          showOverlay();
          world.spectating = false;
        }
      }
    } else {
      // Player alive; normal victory condition
      if (world.graceTimer <= 0 && aliveTeams.length === 1 && aliveTeams[0] === playerTeamId) {
        world.running = false;
        title.textContent = 'Victory Royale!';
        subtitle.textContent = `Your team won. Kills: ${p? p.kills:0}`;
        playBtn.textContent = 'Play Again';
        restartBtn.classList.add('hidden');
        showOverlay();
      }
    }
  }

  // --- Render ---
  draw = function() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0,0,w,h);

    // Camera
    const shakeX = (Math.random()-0.5) * (world.camera.shake||0) * 0.6;
    const shakeY = (Math.random()-0.5) * (world.camera.shake||0) * 0.6;
    ctx.save();
    ctx.translate(-Math.floor(world.camera.x - shakeX), -Math.floor(world.camera.y - shakeY));

    // Ground
    ctx.fillStyle = COLORS.ground1; ctx.fillRect(0,0,CONFIG.mapW, CONFIG.mapH);
    const patchSize = 110;
    for (let y=0; y<CONFIG.mapH; y+=patchSize) {
      for (let x=0; x<CONFIG.mapW; x+=patchSize) {
        const n = hash2((x/patchSize)|0, (y/patchSize)|0);
        const shade = GRASS_SWATCHES[Math.floor(n * GRASS_SWATCHES.length) % GRASS_SWATCHES.length];
        const wobble = (n - 0.5) * 20;
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.ellipse(x + patchSize*0.5 + wobble, y + patchSize*0.5 - wobble, patchSize*0.65, patchSize*0.38, (n * Math.PI*2), 0, Math.PI*2);
        ctx.fill();
      }
    }

    // Zone
    ctx.beginPath(); ctx.arc(world.zone.x, world.zone.y, world.zone.r, 0, Math.PI*2);
    ctx.fillStyle = COLORS.zone; ctx.fill();
    ctx.strokeStyle = COLORS.zoneEdge; ctx.lineWidth = 4; ctx.stroke();

    // Obstacles (hedge walls)
    if (world.obstacles && world.obstacles.length) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 10;
      for (const ob of world.obstacles) {
        const n = hash2(ob.x|0, ob.y|0);
        const base = HEDGE_SWATCHES[Math.floor(n * HEDGE_SWATCHES.length) % HEDGE_SWATCHES.length];
        const grad = ctx.createLinearGradient(ob.x, ob.y, ob.x, ob.y + ob.h);
        grad.addColorStop(0, 'rgba(92,150,86,0.95)');
        grad.addColorStop(0.38, base);
        grad.addColorStop(1, 'rgba(18,36,20,0.95)');
        ctx.fillStyle = grad;
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(ob.x + 4, ob.y + 4, ob.w - 8, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.fillRect(ob.x + 3, ob.y + ob.h - 6, ob.w - 6, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        for (let yy = ob.y + 11; yy <= ob.y + ob.h - 12; yy += 16) {
          ctx.fillRect(ob.x + 6, yy, ob.w - 12, 2);
        }
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 8;
        ctx.strokeStyle = 'rgba(10,24,12,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(ob.x - 1.5, ob.y - 1.5, ob.w + 3, ob.h + 3);
        ctx.strokeStyle = 'rgba(210,255,205,0.25)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(ob.x + 1.5, ob.y + 1.5, ob.w - 3, ob.h - 3);
      }
      ctx.restore();
    }

    // Puddles (ground decals)
    if (world.puddles && world.puddles.length) {
      for (const pd of world.puddles) {
        const imgs = ASSETS.puddle || [];
        const sprite = imgs.length ? imgs[(Math.abs((pd.x|0)+(pd.y|0)) % imgs.length)] : null;
        if (sprite && sprite.complete && sprite.naturalWidth > 0) {
          const s = pd.r*2; ctx.save(); ctx.translate(pd.x, pd.y); ctx.rotate(pd.rot||0);
          ctx.globalAlpha = 0.85; ctx.drawImage(sprite, -s/2, -s/2, s, s); ctx.globalAlpha = 1; ctx.restore();
        }
      }
    }

    // Bushes (render-only)
    if (world.bushes && world.bushes.length) {
      for (const bsh of world.bushes) {
        const imgs = ASSETS.bush || [];
        const sprite = imgs.length ? imgs[(Math.abs((bsh.x|0)+(bsh.y|0)) % imgs.length)] : null;
        if (!(sprite && sprite.complete && sprite.naturalWidth > 0)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(bsh.x, bsh.y + bsh.r*0.28, bsh.r*0.9, bsh.r*0.5, 0, 0, Math.PI*2); ctx.fill();
        const s = bsh.r*2; ctx.save(); ctx.translate(bsh.x, bsh.y); ctx.rotate(bsh.rot||0);
        ctx.drawImage(sprite, -s/2, -s/2, s, s); ctx.restore();
      }
    }

    // Trees (render-only)
    if (world.trees && world.trees.length) {
      for (const tr of world.trees) {
        const imgs = ASSETS.tree || [];
        const sprite = imgs.length ? imgs[(Math.abs((tr.x|0)-(tr.y|0)) % imgs.length)] : null;
        if (!(sprite && sprite.complete && sprite.naturalWidth > 0)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        ctx.beginPath(); ctx.ellipse(tr.x, tr.y + tr.r*0.32, tr.r*0.95, tr.r*0.55, 0, 0, Math.PI*2); ctx.fill();
        const s = tr.r*2.2; ctx.save(); ctx.translate(tr.x, tr.y); ctx.rotate(tr.rot||0);
        ctx.drawImage(sprite, -s/2, -s/2, s, s); ctx.restore();
      }
    }

    // Stones (render-only)
    if (world.stones && world.stones.length) {
      for (const st of world.stones) {
        const imgs = ASSETS.stone || [];
        const sprite = imgs.length ? imgs[(Math.abs((st.x|0)*3+(st.y|0)) % imgs.length)] : null;
        if (!(sprite && sprite.complete && sprite.naturalWidth > 0)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.ellipse(st.x, st.y + st.r*0.2, st.r*0.8, st.r*0.38, 0, 0, Math.PI*2); ctx.fill();
        const s = st.r*2; ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.rot||0);
        ctx.drawImage(sprite, -s/2, -s/2, s, s); ctx.restore();
      }
    }

    // Pickups
    for (const pk of world.pickups) {
      if (pk.kind && pk.kind.startsWith('weapon-')) {
        const weaponKey = pk.kind.split('-')[1] || '';
        const weaponDef = WEAPONS[weaponKey] || {};
        const tint = weaponDef.color || '#fce38a';
        const imgs = ASSETS.crate || [];
        const sprite = imgs.length ? imgs[(Math.abs((pk.x|0)*5 + (pk.y|0)) % imgs.length)] : null;
        if (!(sprite && sprite.complete && sprite.naturalWidth > 0)) continue;
        const size = pk.r * 2.8;
        ctx.save();
        ctx.translate(pk.x, pk.y);
        ctx.rotate(pk.spin * 0.15);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(0, pk.r * 0.8, size * 0.55, size * 0.28, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.drawImage(sprite, -size/2, -size/2, size, size);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = tint;
        ctx.fillRect(-size/2, -size/2, size, size);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(-size/2, -size/2, size, size);
        ctx.restore();
        continue;
      }
      const s = 8 + Math.sin(pk.spin)*2;
      if (pk.kind==='med') ctx.fillStyle = COLORS.health;
      else if (pk.kind && pk.kind.startsWith('ammo-')) ctx.fillStyle = COLORS.ammo;
      else ctx.fillStyle = '#fce38a';
      ctx.beginPath();
      ctx.ellipse(pk.x, pk.y, s, s*0.6, pk.spin*0.5, 0, Math.PI*2);
      ctx.fill();
    }

    // Bullets
    for (const b of world.bullets) {
      ctx.fillStyle = COLORS.bullet;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
    }

    // Entities
    const drawEntity = (e, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI*2); ctx.fill();
      if (e.alive) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.vx*0.08, e.y + e.vy*0.08); ctx.stroke();
      }
      const hw = 32, hh = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(e.x-hw/2, e.y-e.r-14, hw, hh);
      if (!e.downed) {
        ctx.fillStyle = COLORS.health; ctx.fillRect(e.x-hw/2, e.y-e.r-14, hw*(clamp((e.hp || 0),0,100)/100), hh);
      } else {
        ctx.fillStyle = '#f7c46c';
        const remain = Math.max(0, e.bleed) / 45;
        ctx.fillRect(e.x-hw/2, e.y-e.r-14, hw*(1-remain), hh);
      }
      if (e.displayName) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '12px system-ui';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(e.displayName, e.x, e.y - e.r - 20);
        ctx.fillStyle = '#f4f7ff';
        ctx.fillText(e.displayName, e.x, e.y - e.r - 21);
        ctx.restore();
      }
    };
    const p = world.player;
    for (const b of world.bots) if (b.alive) drawEntity(b, b.teamColor || COLORS.bot);
    for (const remote of world.remotePlayers.values()) {
      if (!remote) continue;
      if (remote.spectator) continue;
      drawEntity(remote, remote.teamColor || '#8bbcff');
    }
    if (p) drawEntity(p, p.teamColor || COLORS.player);

    // (props and water rendering reverted)

    // End camera
    ctx.restore();

    // Offscreen teammate arrows
    if (p) {
      const pad = 18; const cw = w, ch = h, cx = cw/2, cy = ch/2;
      const drawArrow = (ent, tint) => {
        if (!ent) return;
        const active = ent.alive || ent.downed;
        if (!active) return;
        const sx = ent.x - world.camera.x, sy = ent.y - world.camera.y;
        if (sx>=0 && sx<=cw && sy>=0 && sy<=ch) return;
        const dx = sx - cx, dy = sy - cy; if (!dx && !dy) return;
        const tVals = [];
        if (dx) { tVals.push((pad - cx)/dx); tVals.push((cw - pad - cx)/dx); }
        if (dy) { tVals.push((pad - cy)/dy); tVals.push((ch - pad - cy)/dy); }
        let t = Infinity; for (const tt of tVals) if (tt > 0) t = Math.min(t, tt);
        if (!isFinite(t)) return;
        const ex = cx + dx*t, ey = cy + dy*t;
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = tint;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-12,7); ctx.lineTo(-12,-7); ctx.closePath(); ctx.fill(); ctx.restore();
      };
      for (const mate of world.bots) {
        if (!mate || !mate.alive || mate.teamId !== p.teamId) continue;
        drawArrow(mate, mate.teamColor || '#74f7a9');
      }
      for (const remote of world.remotePlayers.values()) {
        if (!remote || remote.teamId !== p.teamId || remote.spectator) continue;
        drawArrow(remote, remote.teamColor || '#8bbcff');
      }
    }
    // HUD text (clean header)
    const aliveBots = world.bots.filter(b=>b.alive).length; const aliveRemotes = Array.from(world.remotePlayers.values()).filter(r => r && r.alive && !r.spectator).length;
    const aliveCount = aliveBots + aliveRemotes + (p && p.alive ? 1 : 0);
    const W = p ? WEAPONS[p.weapon] : WEAPONS.rifle;
    let zoneTxt = `Zone: ${world.phase+1}/${CONFIG.zone.phases}`;
    if (world.zoneState.mode === 'hold') zoneTxt += ` (hold ${Math.ceil(world.zoneState.timer)}s)`;
    if (world.zoneState.mode === 'shrink') zoneTxt += ` (shrink ${Math.ceil(Math.max(0, world.zoneState.T - world.zoneState.t))}s)`;
    status.innerHTML = [
      `Alive: ${aliveCount}`,
      p ? `HP: ${Math.max(0, p.hp|0)}` : 'HP: 0',
      p ? `Gun: ${W.name} [${p.mag}/${W.mag}] Ammo: ${p.ammo[p.weapon]||0}` : '',
      zoneTxt,
    ].filter(Boolean).join(' • ');

    // Minimap (top-right)
    const mmW = 200, mmH = Math.round(mmW * (CONFIG.mapH/CONFIG.mapW));
    const pad = 10;
    const mmX = w - mmW - pad;
    const mmY = pad;
    ctx.save(); ctx.translate(mmX, mmY);
    ctx.fillStyle = 'rgba(12,16,22,0.85)'; ctx.fillRect(0,0,mmW,mmH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.strokeRect(0.5,0.5,mmW-1,mmH-1);
    const sx = mmW / CONFIG.mapW, sy = mmH / CONFIG.mapH;
    ctx.beginPath(); ctx.strokeStyle = 'rgba(80,200,255,0.8)';
    ctx.arc(world.zone.x*sx, world.zone.y*sy, world.zone.r*sx, 0, Math.PI*2); ctx.stroke();
    for (const b of world.bots) if (b.alive) { ctx.fillStyle = b.teamColor || 'rgba(247,113,113,0.9)'; ctx.fillRect(b.x*sx-1, b.y*sy-1, 2, 2); }
    for (const remote of world.remotePlayers.values()) { if (!remote || remote.spectator) continue; if (!remote.alive && !remote.downed) continue; ctx.fillStyle = remote.teamColor || '#8bbcff'; ctx.fillRect(remote.x*sx-1, remote.y*sy-1, 2, 2); }
    if (p) { ctx.fillStyle = p.teamColor || '#74f7a9'; ctx.fillRect(p.x*sx-2, p.y*sy-2, 4, 4); }
    ctx.restore();

    // Slots panel (bottom-right text 1..5)
    const lines = [];
    for (let i=0; i<5; i++) {
      const wn = (p && p.inventory && p.inventory[i]) ? (WEAPONS[p.inventory[i]].name) : '-';
      const sel = (p && p.slot === i) ? ' <' : '';
      lines.push(`${i+1}: ${wn}${sel}`);
    }
    const invPad = 10, lh = 16, invW = 170, invH = lines.length*lh + invPad*2;
    const invX = w - invW - pad, invY = h - invH - pad;
    ctx.save(); ctx.fillStyle = 'rgba(12,16,22,0.75)'; ctx.fillRect(invX, invY, invW, invH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.strokeRect(invX+0.5, invY+0.5, invW-1, invH-1);
    ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let i=0;i<lines.length;i++) { const isSel = (p && p.slot === i); ctx.fillStyle = isSel ? '#2aa9ff' : '#e6edf3'; ctx.fillText(lines[i], invX + invPad, invY + invPad + i*lh); }
    ctx.restore();
  }

  // --- Boot ---
  showOverlay();
  // Persist difficulty and mode selection
  diffBtns.forEach(btn => btn.addEventListener('click', () => { selectedDiff = btn.dataset.diff; diffBtns.forEach(b => b.classList.toggle('selected', b === btn)); saveDiff(); }));
  modeBtns.forEach(btn => btn.addEventListener('click', () => { selectedMode = btn.dataset.mode; modeBtns.forEach(b => b.classList.toggle('selected', b === btn)); saveMode(); }));
}

})();









