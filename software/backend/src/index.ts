/**
 * ============================================================================
 * F1 Lamp — Cloudflare Worker WebSocket Relay & REST API
 * ============================================================================
 * Bridges the Web App (Cloudflare Pages) with the physical ESP8266 Lamp.
 * - Outbound WebSocket handling via Cloudflare Workers WebSocketPair
 * - Command serialization & revision synchronization
 * - MongoDB Atlas persistence for state and presets
 */

import { Env, LampState, getLampState, saveLampState, getPresets, savePreset } from './mongodb';

// Active WebSocket session for the physical ESP8266
let deviceSocket: WebSocket | null = null;
let lastHeartbeat = 0;
let commandRevision = 1;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Key'
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ------------------------------------------------------------------------
    // 1. WebSocket Endpoint for ESP8266: /api/device/ws
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/device/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Verify device credentials
      const authHeader = request.headers.get('OAI-Sites-Authorization') || request.headers.get('Authorization') || '';
      const deviceKey  = request.headers.get('X-Device-Key') || '';

      const expectedSecret = env.SERVICE_SECRET || 'f1_secret_service_auth_token_xyz';
      const expectedKey    = env.DEVICE_KEY     || 'f1_secure_device_secret_key_1234567890';

      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (token !== expectedSecret || deviceKey !== expectedKey) {
        return new Response('Unauthorized device credentials', { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      deviceSocket = server;
      lastHeartbeat = Date.now();

      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          lastHeartbeat = Date.now();

          // Sync message from ESP8266
          if (msg.type === 'sync' && msg.state) {
            await saveLampState(env, msg.state);
          }
        } catch (e) {
          console.error('[Worker] Error parsing device message:', e);
        }
      });

      server.addEventListener('close', () => {
        if (deviceSocket === server) {
          deviceSocket = null;
        }
      });

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // ------------------------------------------------------------------------
    // 2. REST API: GET /api/state
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/state' && request.method === 'GET') {
      const isOnline = deviceSocket !== null && Date.now() - lastHeartbeat < 45000;
      const state = await getLampState(env);

      return jsonResponse({
        ...state,
        online: isOnline,
        lastHeartbeat
      });
    }

    // ------------------------------------------------------------------------
    // 3. REST API: POST /api/state
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/state' && request.method === 'POST') {
      let params: URLSearchParams;
      const contentType = request.headers.get('Content-Type') || '';

      if (contentType.includes('application/json')) {
        const body = await request.json() as any;
        params = new URLSearchParams();
        for (const [k, v] of Object.entries(body)) {
          params.set(k, Array.isArray(v) ? v.map((b) => (b ? '1' : '0')).join('') : String(v));
        }
      } else {
        params = new URLSearchParams(await request.text());
      }

      const power      = params.get('power') === '1' || params.get('power') === 'true';
      const brightness = parseInt(params.get('brightness') || '40', 10);
      const speed      = parseInt(params.get('speed') || '100', 10);
      const effect     = params.get('effect') || 'rev';
      const zonesRaw   = params.get('zones') || '111';
      const replay     = params.get('replay') === '1' || params.get('replay') === 'true';

      const zones = [
        zonesRaw.charAt(0) !== '0',
        zonesRaw.charAt(1) !== '0',
        zonesRaw.charAt(2) !== '0'
      ];

      const newState: LampState = {
        device: 'F1-Lamp',
        apiVersion: 3,
        power,
        color: '#ff0000',
        brightness: Math.max(0, Math.min(100, brightness)),
        speed: Math.max(25, Math.min(250, speed)),
        effect,
        zones
      };

      // Save to MongoDB Atlas
      await saveLampState(env, newState);

      const isOnline = deviceSocket !== null && Date.now() - lastHeartbeat < 45000;
      commandRevision++;

      // Dispatch command to physical ESP8266 via WebSocket
      if (isOnline && deviceSocket) {
        try {
          deviceSocket.send(
            JSON.stringify({
              type: 'command',
              revision: commandRevision,
              apply: true,
              state: {
                ...newState,
                replay
              }
            })
          );
        } catch (err) {
          console.error('[Worker] Failed to push to socket:', err);
        }
      }

      return jsonResponse({
        ...newState,
        online: isOnline,
        pending: !isOnline
      });
    }

    // ------------------------------------------------------------------------
    // 4. REST API: GET & POST /api/presets
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/presets') {
      if (request.method === 'GET') {
        const presets = await getPresets(env);
        return jsonResponse(presets);
      }

      if (request.method === 'POST') {
        const body = await request.json() as any;
        if (!body.name) {
          return jsonResponse({ error: 'Missing preset name' }, 400);
        }
        const created = await savePreset(env, {
          name: body.name,
          power: body.power ?? true,
          brightness: body.brightness ?? 40,
          speed: body.speed ?? 100,
          effect: body.effect ?? 'rev',
          zones: body.zones ?? [true, true, true]
        });
        return jsonResponse(created, 201);
      }
    }

    // ------------------------------------------------------------------------
    // 5. REST API: POST /api/pair-code
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/pair-code' && request.method === 'POST') {
      const pairingPayload = {
        host: url.hostname,
        service: env.SERVICE_SECRET || 'f1_secret_service_auth_token_xyz',
        key: env.DEVICE_KEY || 'f1_secure_device_secret_key_1234567890'
      };

      return jsonResponse({
        code: JSON.stringify(pairingPayload)
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

