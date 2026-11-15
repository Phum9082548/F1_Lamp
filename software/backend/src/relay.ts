import { Env, LampState } from './mongodb';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Key'
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const initial: LampState = { device: 'F1-Lamp', apiVersion: 3, power: true, color: '#ff0000', brightness: 40, speed: 100, effect: 'rev', zones: [true, true, true] };
const effects = new Set(['rev','static','chase','breathe','wave','scanner','ripple','heartbeat','ember','cascade']);
type Command = { type: 'command'; revision: number; apply: true; state: LampState & { replay: boolean } };
type Attachment = { heartbeat: number; ack: number; state?: LampState };

// Every HTTP command and device socket is routed to this same object.
// Attachments survive hibernation; revisions and pending commands survive restarts.
export class LampRelay {
  constructor(private ctx: DurableObjectState, private env: Env) {}

  private live(): WebSocket | undefined {
    return this.ctx.getWebSockets('device').find(ws => {
      const a = ws.deserializeAttachment() as Attachment;
      return ws.readyState === 1 && Date.now() - a.heartbeat < 45000;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (path === '/api/device/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply({ error: 'Expected WebSocket upgrade' }, 426);
      const token = (request.headers.get('OAI-Sites-Authorization') || request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (token !== this.env.SERVICE_SECRET || request.headers.get('X-Device-Key') !== this.env.DEVICE_KEY) return reply({ error: 'Unauthorized device' }, 401);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      for (const old of this.ctx.getWebSockets('device')) old.close(1000, 'New device connection');
      this.ctx.acceptWebSocket(server, ['device']);
      server.serializeAttachment({ heartbeat: Date.now(), ack: 0 } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (path !== '/api/state') return reply({ error: 'Not found' }, 404);
    if (request.method === 'GET') {
      const socket = this.live();
      const a = socket?.deserializeAttachment() as Attachment | undefined;
      const command = await this.ctx.storage.get<Command>('command');
      const state = a?.state || await this.ctx.storage.get<LampState>('lastState') || initial;
      return reply({ ...state, online: !!socket, lastHeartbeat: a?.heartbeat || 0, pending: !!command && (a?.ack || 0) < command.revision, revision: command?.revision || 0, ack: a?.ack || 0 });
    }
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    let values: Record<string, unknown>;
    try {
      values = (request.headers.get('Content-Type') || '').includes('application/json')
        ? await request.json() as Record<string, unknown>
        : Object.fromEntries(new URLSearchParams(await request.text()));
    } catch { return reply({ error: 'Invalid request' }, 400); }
    const bool = (v: unknown) => v === true || v === '1' || v === 'true';
    const zones = Array.isArray(values.zones) ? values.zones : typeof values.zones === 'string' && /^[01]{3}$/.test(values.zones) ? [...values.zones].map(v => v === '1') : null;
    const brightness = Number(values.brightness), speed = Number(values.speed), effect = String(values.effect);
    if (![true,false,'0','1','true','false'].includes(values.power as any) || !Number.isInteger(brightness) || brightness < 0 || brightness > 100 || !Number.isInteger(speed) || speed < 25 || speed > 250 || !effects.has(effect) || !zones || zones.length !== 3 || zones.some(v => typeof v !== 'boolean')) return reply({ error: 'Invalid lamp settings' }, 400);
    const previous = await this.ctx.storage.get<Command>('command');
    const revision = Math.max(Date.now(), (previous?.revision || 0) + 1);
    const state: LampState = { ...initial, power: bool(values.power), brightness, speed, effect, zones };
    const command: Command = { type: 'command', revision, apply: true, state: { ...state, replay: bool(values.replay) } };
    await this.ctx.storage.put('command', command);
    const socket = this.live();
    if (socket) socket.send(JSON.stringify(command));
    // Delivery is only confirmed after the ESP8266 echoes this revision in ack.
    return reply({ ...state, online: !!socket, pending: true, revision });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 8192) return;
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    if (msg.type !== 'sync' || !msg.state || msg.state.device !== 'F1-Lamp') return;
    const previous = ws.deserializeAttachment() as Attachment;
    const attachment: Attachment = { heartbeat: Date.now(), ack: Number(msg.ack) || 0, state: msg.state };
    ws.serializeAttachment(attachment);
    const command = await this.ctx.storage.get<Command>('command');
    if (command && attachment.ack < command.revision) ws.send(JSON.stringify(command));
    if (JSON.stringify(previous.state && { ...previous.state, phase: 0 }) !== JSON.stringify({ ...msg.state, phase: 0 })) await this.ctx.storage.put('lastState', msg.state);
  }

  webSocketClose(ws: WebSocket) { ws.close(1000, 'Disconnected'); }
  webSocketError(ws: WebSocket) { ws.close(1011, 'Socket error'); }
}
