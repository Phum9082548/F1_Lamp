/**
 * ============================================================================
 * F1 Lamp — Simple & Clean Web Controller
 * ============================================================================
 * Features:
 * - Direct Cloudflare Worker API sync
 * - Local Wi-Fi mDNS scanner (f1-lamp.local)
 * - Clean, minimalistic UI with zero emojis (100% English)
 */

'use strict';

import { modes, level, smooth } from './effects.js';

const $ = (s) => document.querySelector(s);
const RED = '#ff0000';
const counts = [4, 6, 9];
const names = Object.fromEntries(modes.map((m) => [m.id, m.name]));

const WORKER_ORIGIN = 'https://f1-lamp-relay.f1-lamp-control.workers.dev';

// Default initial state
const defaults = {
  power: true,
  color: RED,
  brightness: 40,
  speed: 100,
  effect: 'rev',
  zones: [true, true, true]
};

function isValidState(v) {
  return (
    v &&
    typeof v.power === 'boolean' &&
    Number.isInteger(v.brightness) &&
    v.brightness >= 0 &&
    v.brightness <= 100 &&
    Number.isInteger(v.speed) &&
    v.speed >= 25 &&
    v.speed <= 250 &&
    Object.hasOwn(names, v.effect) &&
    Array.isArray(v.zones) &&
    v.zones.length === 3
  );
}

// Local cache
let state = { ...defaults, zones: [...defaults.zones] };
try {
  const saved = JSON.parse(localStorage.getItem('f1-pit-v5'));
  if (isValidState(saved)) state = saved;
} catch {}

let connected = false;
let inFlight = false;
let desiredVersion = 0;
let appliedVersion = 0;
let replayPending = false;
let sendTimer = null;

// Determine environment
const host = location.hostname;
const isLocal = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.endsWith('.local') || host === 'localhost';
let apiBaseUrl = isLocal ? '.' : WORKER_ORIGIN;

// ----------------------------------------------------------------------------
// Render UI Components
// ----------------------------------------------------------------------------
const effectsContainer = $('#effects');
if (effectsContainer) {
  effectsContainer.innerHTML = modes
    .map(
      (m) =>
        `<button class="effect-card" data-effect="${m.id}" aria-label="${m.label}">
          <div class="effect-title">${m.label}</div>
          <div class="effect-sub">${m.name}</div>
        </button>`
    )
    .join('');
}

const zonesContainer = $('#zones');
if (zonesContainer) {
  zonesContainer.innerHTML = counts
    .map(
      (n, i) =>
        `<div class="zone-box">
          <div class="zone-header">
            <span class="zone-name">${['D1 (Front Accent)', 'D2 (Center Stripe)', 'D5 (Base Plate)'][i]}</span>
            <button class="zone-toggle" data-zone="${i}">ON</button>
          </div>
          <div class="zone-desc">${n} LEDs</div>
          <div class="dots">${'<i class="dot"></i>'.repeat(n)}</div>
        </div>`
    )
    .join('');
}

function syncUI() {
  state.color = RED;
  document.documentElement.style.setProperty('--light', RED);

  const bInput = $('#brightness');
  if (bInput) bInput.value = state.brightness;
  const bVal = $('#brightnessVal');
  if (bVal) bVal.textContent = state.brightness + '%';

  const sInput = $('#speed');
  if (sInput) sInput.value = state.speed;
  const sVal = $('#speedVal');
  if (sVal) sVal.textContent = (state.speed / 100).toFixed(2) + 'x';

  const powerBtn = $('#power');
  if (powerBtn) {
    powerBtn.textContent = state.power ? 'POWER ON' : 'POWER OFF';
    powerBtn.setAttribute('aria-pressed', String(state.power));
  }

  const effectLabel = $('#effectName');
  if (effectLabel) effectLabel.textContent = names[state.effect] || state.effect;

  document.querySelectorAll('[data-effect]').forEach((e) => {
    const active = e.dataset.effect === state.effect;
    e.classList.toggle('active', active);
    e.setAttribute('aria-pressed', String(active));
  });

  document.querySelectorAll('[data-zone]').forEach((e, i) => {
    const isOn = state.zones[i];
    e.textContent = isOn ? 'ON' : 'OFF';
    e.classList.toggle('off', !isOn);
  });

  try {
    localStorage.setItem('f1-pit-v5', JSON.stringify(state));
  } catch {}
}

function setBadge(text, type = '') {
  const badge = $('#connBadge');
  if (badge) {
    badge.textContent = text;
    badge.className = 'status-badge ' + type;
  }
}

function setBanner(text) {
  const banner = $('#bannerText');
  if (banner) banner.textContent = text;
}

// ----------------------------------------------------------------------------
// 3D Preview Frame Levels
// ----------------------------------------------------------------------------
let phase = 0;
let lastTick = performance.now();
let fadeStarted = lastTick;
let displayed = counts.map((n) => Array(n).fill(0));
let fadeFrom = counts.map((n) => Array(n).fill(0));

function beginTransition() {
  fadeFrom = displayed.map((a) => a.slice());
  fadeStarted = performance.now();
}

function frameLevels(now) {
  const dt = Math.max(0, now - lastTick) / 1000;
  lastTick = Math.max(lastTick, now);
  phase += (dt * state.speed) / 100;

  const blend = smooth((now - fadeStarted) / 700);

  displayed = counts.map((n, i) =>
    Array.from({ length: n }, (_, j) => {
      const target =
        state.power && state.zones[i]
          ? (level(state.effect, phase, i, j, n) * state.brightness) / 100
          : 0;
      return fadeFrom[i][j] + (target - fadeFrom[i][j]) * blend;
    })
  );
  return displayed;
}

window.lampPreview = {
  getState: () => state,
  levels: frameLevels
};

function animateUI(now) {
  let lit = 0;
  frameLevels(now).forEach((values, i) => {
    const zoneBox = document.querySelectorAll('.zone-box')[i];
    if (zoneBox) {
      const dots = zoneBox.querySelectorAll('.dot');
      values.forEach((v, j) => {
        if (dots[j]) {
          dots[j].style.opacity = 0.1 + 0.9 * v;
          if (v > 0.02) lit++;
        }
      });
    }
  });

  const outEl = $('#out');
  if (outEl) outEl.textContent = lit;
  requestAnimationFrame(animateUI);
}

// ----------------------------------------------------------------------------
// User Actions
// ----------------------------------------------------------------------------
function edit(replay = false) {
  beginTransition();
  if (replay) phase = 0;
  syncUI();

  if (connected) {
    desiredVersion++;
    replayPending ||= replay;
    setBanner('Sending command to lamp...');
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendStateToServer, 80);
  }
}

if ($('#power')) {
  $('#power').onclick = () => {
    state.power = !state.power;
    edit(state.power);
  };
}

const bRange = $('#brightness');
if (bRange) {
  bRange.oninput = (e) => {
    state.brightness = +e.target.value;
    edit();
  };
}

const sRange = $('#speed');
if (sRange) {
  sRange.oninput = (e) => {
    state.speed = +e.target.value;
    edit();
  };
}

// Brightness preset pills
document.querySelectorAll('[data-set-bright]').forEach((btn) => {
  btn.onclick = () => {
    state.brightness = +btn.dataset.setBright;
    edit();
  };
});

// Speed preset pills
document.querySelectorAll('[data-set-speed]').forEach((btn) => {
  btn.onclick = () => {
    state.speed = +btn.dataset.setSpeed;
    edit();
  };
});

document.querySelectorAll('[data-effect]').forEach((e) => {
  e.onclick = () => {
    state.effect = e.dataset.effect;
    edit(true);
  };
});

document.querySelectorAll('[data-zone]').forEach((e) => {
  e.onclick = () => {
    const i = +e.dataset.zone;
    state.zones[i] = !state.zones[i];
    edit();
  };
});

if ($('#replay')) {
  $('#replay').onclick = () => {
    state.power = true;
    edit(true);
    setBanner('Replaying effect: ' + names[state.effect]);
  };
}

// ----------------------------------------------------------------------------
// Network Sync (Cloudflare Worker & mDNS)
// ----------------------------------------------------------------------------
async function apiRequest(method = 'GET', body = null) {
  const endpoint = `${apiBaseUrl}/api/state`;
  const headers = body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined;

  const response = await fetch(endpoint, {
    method,
    body,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(4000)
  });

  if (!response.ok) throw new Error('HTTP ' + response.status);
  return await response.json();
}

function applyRemoteState(v) {
  const next = {
    power: v.power,
    color: RED,
    brightness: v.brightness,
    speed: v.speed,
    effect: v.effect,
    zones: v.zones
  };

  if (JSON.stringify(next) !== JSON.stringify(state)) {
    beginTransition();
  }
  state = next;
  phase = Number.isFinite(v.phase) ? v.phase : phase;
  lastTick = performance.now();
  syncUI();
}

async function checkStatus() {
  try {
    const v = await apiRequest();
    connected = isLocal || !!v.online;

    if (connected) {
      setBadge('Connected', 'connected');
      setBanner(isLocal ? 'Direct Local LAN connection active' : 'Lamp online · Synchronized via Cloudflare Relay');
    } else {
      setBadge('Offline', 'offline');
      setBanner('Lamp is currently offline · 3D simulation mode active');
    }
    applyRemoteState(v);
  } catch (err) {
    connected = false;
    setBadge('Simulation Mode', '');
    setBanner('Hardware offline · Interactive 3D simulator active');
  }
}

async function sendStateToServer() {
  if (inFlight || desiredVersion === appliedVersion) return;
  inFlight = true;

  const version = desiredVersion;
  const replay = replayPending;
  replayPending = false;

  const body = new URLSearchParams({
    power: state.power ? '1' : '0',
    brightness: state.brightness,
    speed: state.speed,
    effect: state.effect,
    zones: state.zones.map((x) => (x ? '1' : '0')).join(''),
    replay: replay ? '1' : '0'
  });

  try {
    const v = await apiRequest('POST', body);
    appliedVersion = version;
    if (desiredVersion === version) {
      applyRemoteState(v);
      setBanner('Command confirmed by relay');
    }
  } catch (err) {
    setBanner('Network error · Could not deliver command');
  } finally {
    inFlight = false;
    if (desiredVersion !== appliedVersion) {
      sendStateToServer();
    }
  }
}

// ----------------------------------------------------------------------------
// mDNS & Direct Connect Handler
// ----------------------------------------------------------------------------
const scanBtn = $('#scanMdns');
if (scanBtn) {
  scanBtn.onclick = async () => {
    // If user is on remote HTTPS (e.g. 4G/5G), inform them they are using Cloud Relay
    if (!isLocal) {
      setBanner('mDNS is only for home Wi-Fi. On 4G/5G, commands route via Cloud Relay.');
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning for f1-lamp.local...';
    setBanner('Searching for local hardware via mDNS...');

    try {
      const localUrl = 'http://f1-lamp.local';
      const img = new Image();

      const timer = setTimeout(() => {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Local Network (f1-lamp.local)';
        setBanner('Local lamp not responding. Ensure ESP8266 is powered on.');
      }, 3000);

      img.onload = () => {
        clearTimeout(timer);
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Local Network (f1-lamp.local)';
        setBanner('F1 Lamp found at f1-lamp.local');
      };

      img.onerror = () => {
        clearTimeout(timer);
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Local Network (f1-lamp.local)';
        setBanner('Cannot reach f1-lamp.local. Check home Wi-Fi connection.');
      };

      img.src = `${localUrl}/api/state?_=${Date.now()}`;
    } catch (e) {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan Local Network (f1-lamp.local)';
    }
  };
}

const directBtn = $('#directConnectBtn');
if (directBtn) {
  directBtn.onclick = () => {
    let input = $('#hostInput').value.trim();
    if (!input) input = 'f1-lamp.local';
    const target = input.startsWith('http') ? input : `http://${input}`;
    window.open(target, '_blank', 'noopener');
  };
}

// Polling status
setInterval(checkStatus, 4000);

// Startup
syncUI();
requestAnimationFrame(animateUI);
checkStatus();
