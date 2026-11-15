/**
 * ============================================================================
 * F1 Lamp — Cloudflare Worker WebSocket Relay & REST API
 * ============================================================================
 * Bridges the Web App (Cloudflare Pages) with the physical ESP8266 Lamp.
 * - Outbound WebSocket handling via Cloudflare Workers WebSocketPair
 * - Command serialization & revision synchronization
 * - MongoDB Atlas persistence for state and presets
 */

import { Env, getPresets, savePreset } from './mongodb';
export { LampRelay } from './relay';


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

    if (url.pathname === '/api/state' || url.pathname === '/api/device/ws') {
      const id = env.LAMP_RELAY.idFromName('F1-Lamp');
      return env.LAMP_RELAY.get(id).fetch(request);
    }

    // Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
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

