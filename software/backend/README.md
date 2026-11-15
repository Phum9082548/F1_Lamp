# F1 Lamp Cloud Relay

Last updated: **2026-11-16 01:17 ICT (UTC+07:00)** / **2026-11-15T18:17:40Z**.

HTTP commands and device WebSockets are routed through one named `LampRelay` Durable Object. Do not reintroduce module-level socket storage: different Worker instances cannot share it.

## Deploy

```bash
npx wrangler login
npx wrangler deploy
```

Use an account authorized to deploy the existing Worker. For forks, update `account_id` in `wrangler.toml`. Retain the `LAMP_RELAY` binding and SQLite migration.

## Configuration

- `SERVICE_SECRET`: device handshake token matching the board pairing.
- `DEVICE_KEY`: device key matching the board pairing.
- `MONGODB_DATABASE`: legacy preset database name.
- Optional legacy preset settings: `MONGODB_DATA_API_URL`, `MONGODB_DATA_API_KEY`, and `MONGODB_DATA_SOURCE`.

Checked-in credentials are public development defaults. Use private values for private installations and do not commit replacements. The optional legacy MongoDB integration is separate from device command delivery.

## Endpoints

- POST `/api/pair-code`: obtain a pairing code for the board's local `/api/cloud/setup` endpoint.
- GET `/api/state`: device-reported state, online status, pending command status, command revision, and device acknowledgment.
- POST `/api/state`: form or JSON fields `power`, `brightness`, `speed`, `effect`, `zones`, and optional `replay`.
- WSS `/api/device/ws`: authenticated device connection exchanging command and sync messages.
- GET/POST `/api/presets`: legacy preset behavior.

Commands use persistent increasing revisions. Pending commands are retried on device sync and reconnect. Delivery is confirmed only when the board echoes the revision in `ack`. `online: true` alone does not prove a command was applied.

WebSocket attachments preserve heartbeat, acknowledged revision, and device state across hibernation. Durable storage preserves the latest command and reported settings. No firmware change is needed for this relay repair.

See the root [README](../../README.md) for flashing, wiring, deployment, and integration test instructions.
