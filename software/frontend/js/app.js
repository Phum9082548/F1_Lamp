/**
 * ============================================================================
 * F1 Lamp — Web Controller Application
 * ============================================================================
 * Supports both Local Wi-Fi (ESP8266 REST API) and Cloud Relay (Cloudflare Workers + MongoDB)
 */

'use strict';

import { modes, level, smooth } from './effects.js';

const $ = (s) => document.querySelector(s);
const RED = '#ff0000';
const counts = [4, 6, 9];
const names = Object.fromEntries(modes.map((m) => [m.id, m.name]));

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
    /^#[0-9a-f]{6}$/i.test(v.color) &&
    Number.isInteger(v.brightness) &&
    v.brightness >= 0 &&
    v.brightness <= 100 &&
    Number.isInteger(v.speed) &&
    v.speed >= 25 &&
    v.speed <= 250 &&
    Object.hasOwn(names, v.effect) &&
    Array.isArray(v.zones) &&
    v.zones.length === 3 &&
    v.zones.every((x) => typeof x === 'boolean')
  );
}

// Local cache
let state = { ...defaults, zones: [...defaults.zones] };
try {
  const saved = JSON.parse(localStorage.getItem('f1-pit-v3'));
  if (isValidState(saved)) state = saved;
} catch {}

let connected = false;
let deviceMode = false;
let desiredVersion = 0;
let appliedVersion = 0;
let inFlight = false;
let replayPending = false;
let sendTimer = null;

const WORKER_ORIGIN = 'https://f1-lamp-relay.f1-lamp-control.workers.dev';

// Determine environment
const host = location.hostname;
const localHost = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.endsWith('.local');
const isCloudMode = location.protocol === 'https:' || (!localHost && host !== 'localhost');
const apiAvailable = true;

// Build UI Elements
const effectsContainer = $('#effects');
if (effectsContainer) {
  effectsContainer.innerHTML = modes
    .map(
      (m) =>
        `<button class="effect" data-effect="${m.id}" aria-label="${m.label}">
          <span>${m.icon} &nbsp; ${m.label}</span>
          <small>${m.name}</small>
        </button>`
    )
    .join('');
}

const zonesContainer = $('#zones');
if (zonesContainer) {
  zonesContainer.innerHTML = counts
    .map(
      (n, i) =>
        `<div class="zone">
          <div class="zone-top">
            <b>${['D1', 'D2', 'D5'][i]}</b>
            <button data-zone="${i}"></button>
          </div>
          <small>${n} LEDs${i === 0 ? ' · delayed' : ''}</small>
          <div class="dots">${'<i class="dot"></i>'.repeat(n)}</div>
        </div>`
    )
    .join('');
}

function syncUI() {
  state.color = RED;
  document.documentElement.style.setProperty('--light', RED);

  for (const k of ['brightness', 'speed']) {
    const el = $('#' + k);
    if (el) el.value = state[k];
  }

  if ($('#brightnessVal')) $('#brightnessVal').textContent = state.brightness + '%';
  if ($('#speedVal')) $('#speedVal').textContent = (state.speed / 100).toFixed(2) + '×';

  const powerBtn = $('#power');
  if (powerBtn) {
    powerBtn.textContent = state.power ? '⏻   เปิดอยู่' : '⏻   ปิดอยู่';
    powerBtn.setAttribute('aria-pressed', String(state.power));
  }

  if ($('#effectName')) $('#effectName').textContent = names[state.effect] || state.effect;

  document.querySelectorAll('[data-effect]').forEach((e) => {
    const active = e.dataset.effect === state.effect;
    e.classList.toggle('active', active);
    e.setAttribute('aria-pressed', String(active));
  });

  document.querySelectorAll('[data-zone]').forEach((e, i) => {
    const isOn = state.zones[i];
    e.textContent = isOn ? 'ON' : 'OFF';
    e.classList.toggle('off', !isOn);
    e.setAttribute('aria-pressed', String(isOn));
  });

  try {
    localStorage.setItem('f1-pit-v3', JSON.stringify(state));
  } catch {}
}

function setConnectionBadge(text, kind = '') {
  const badge = $('.badge');
  if (badge) {
    badge.textContent = text;
    badge.className = 'badge ' + kind;
  }
}

// ----------------------------------------------------------------------------
// Animation & Preview Engine
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
    const zoneEl = document.querySelectorAll('.zone')[i];
    if (zoneEl) {
      const dots = zoneEl.querySelectorAll('.dot');
      values.forEach((v, j) => {
        if (dots[j]) {
          dots[j].style.opacity = 0.08 + 0.92 * v;
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

  if (isCloudMode && !connected) {
    if ($('#status')) $('#status').textContent = 'โคมออฟไลน์ · การเปลี่ยนค่ายังไม่ส่ง';
  }

  if (connected) {
    desiredVersion++;
    replayPending ||= replay;
    if ($('#deviceStatus')) $('#deviceStatus').textContent = 'กำลังส่งคำสั่ง…';
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendStateToServer, 90);
  }
}

if ($('#power')) {
  $('#power').onclick = () => {
    state.power = !state.power;
    edit(state.power);
  };
}

['brightness', 'speed'].forEach((k) => {
  const input = $('#' + k);
  if (input) {
    input.oninput = (e) => {
      state[k] = +e.target.value;
      edit();
    };
  }
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
    if ($('#status')) $('#status').textContent = 'เล่น ' + names[state.effect];
  };
}

// ----------------------------------------------------------------------------
// Network Sync (REST API & Cloud Relay)
// ----------------------------------------------------------------------------
async function apiRequest(method = 'GET', body = null) {
  const base = isCloudMode ? WORKER_ORIGIN : '.';
  const endpoint = `${base}/api/state`;
  const headers = body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined;

  const response = await fetch(endpoint, {
    method,
    body,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  return data;
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

async function connectToDevice() {
  const retryBtn = $('#retryDevice');
  if (retryBtn) retryBtn.disabled = true;
  if ($('#deviceStatus')) $('#deviceStatus').textContent = 'กำลังตรวจสอบสถานะ…';

  try {
    const v = await apiRequest();
    deviceMode = true;
    connected = !isCloudMode || v.online;
    desiredVersion = appliedVersion = 0;
    replayPending = false;
    applyRemoteState(v);

    setConnectionBadge(
      isCloudMode ? (v.online ? 'เชื่อมต่อผ่านอินเทอร์เน็ต' : 'โคมออฟไลน์') : 'เชื่อมต่อโคมแล้ว',
      connected ? 'connected' : ''
    );

    if ($('#deviceStatus')) {
      $('#deviceStatus').textContent = isCloudMode
        ? v.online
          ? 'โคมออนไลน์ · เชื่อมต่อผ่าน Cloud Relay'
          : 'โคมยังไม่ออนไลน์ · รอการเชื่อมต่อ'
        : 'เชื่อมต่อ ' + host + ' · อ่านค่าจริงจากบอร์ดแล้ว';
    }

    if ($('#status')) {
      $('#status').textContent = connected
        ? 'พร้อมควบคุมโคมไฟแบบ Real-time'
        : 'รอโคมต่ออินเทอร์เน็ต';
    }
  } catch (e) {
    connected = false;
    setConnectionBadge(deviceMode ? 'ขาดการเชื่อมต่อ' : 'โหมดจำลอง', deviceMode ? 'failed' : '');
    if ($('#deviceStatus')) {
      $('#deviceStatus').textContent = 'ยังเชื่อมต่อไม่ได้ · โหมดจำลองแสง 3D กำลังทำงาน';
    }
    if ($('#status')) {
      $('#status').textContent = 'การเปลี่ยนค่ายังไม่ถูกส่งไปที่โคมจริง';
    }
  } finally {
    if (retryBtn) retryBtn.disabled = false;
  }
}

async function sendStateToServer() {
  if (inFlight || !connected || desiredVersion === appliedVersion) return;
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
      if ($('#deviceStatus')) {
        $('#deviceStatus').textContent = v.pending ? 'ส่งถึงระบบแล้ว · รอโคมยืนยัน' : 'ส่งสำเร็จ · โคมยืนยันแล้ว';
      }
      if ($('#status')) {
        $('#status').textContent = v.pending ? 'กำลังส่งคำสั่งไปที่โคม' : 'โคมยืนยันการตั้งค่าแล้ว';
      }
    }
  } catch (e) {
    connected = false;
    setConnectionBadge('ขาดการเชื่อมต่อ', 'failed');
    if ($('#deviceStatus')) {
      $('#deviceStatus').textContent = 'ส่งไม่สำเร็จ · กดตรวจสอบการเชื่อมต่ออีกครั้ง';
    }
  } finally {
    inFlight = false;
    if (connected && desiredVersion !== appliedVersion) {
      sendStateToServer();
    }
  }
}

if ($('#retryDevice')) $('#retryDevice').onclick = connectToDevice;

if ($('#openDevice')) {
  $('#openDevice').onclick = () => {
    const ip = $('#deviceIp').value.trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      alert('กรอก IP เช่น 192.168.1.104');
      return;
    }
    window.open('http://' + ip + '/', '_blank', 'noopener');
  };
}

// Polling interval
setInterval(async () => {
  if ((!connected && !isCloudMode) || inFlight || desiredVersion !== appliedVersion) return;
  try {
    const v = await apiRequest();
    if (!inFlight && desiredVersion === appliedVersion) {
      applyRemoteState(v);
      if (isCloudMode) {
        connected = !!v.online;
        setConnectionBadge(connected ? 'เชื่อมต่อผ่านอินเทอร์เน็ต' : 'โคมออฟไลน์', connected ? 'connected' : '');
      }
    }
  } catch {
    // Ignore transient poll failures
  }
}, 3000);

// Initialize
syncUI();
requestAnimationFrame(animateUI);
connectToDevice();

