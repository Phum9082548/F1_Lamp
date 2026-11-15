# F1 Lamp — ESP8266 and Cloudflare Control

**Last updated: 2026-11-16 01:17 ICT (UTC+07:00)**
**UTC timestamp: 2026-11-15T18:17:40Z**

An ESP8266 F1 logo lamp with three independent WS2812B strips, ten red lighting effects, local Wi-Fi control, remote Cloudflare control, and a browser-based 3D simulator.

- [Live controller](https://f1-lamp.pages.dev)
- [Cloud relay status](https://f1-lamp-relay.f1-lamp-control.workers.dev/api/state)
- Local controller: `http://f1-lamp.local/` or the board's IP address.

## Latest repair

The relay now routes device WebSockets and HTTP commands through one named **Cloudflare Durable Object**. Previously, the socket was stored in a Worker module variable: requests handled by another instance could report success without delivering the command.

The repair persists command revisions and the latest pending command, retries unacknowledged commands on device sync and reconnect, and retains socket metadata across hibernation. A command remains `pending` until the ESP8266 echoes its revision in `ack`. The controller displays an acknowledgment wait message instead of immediately claiming success.

**Production verification, 2026-11-16 ICT:** cloud OFF and ON commands both matched the board's reported state and acknowledgment revision. The controller loaded with the lamp online. This verifies command delivery and firmware state; actual LED illumination also depends on wiring and power.

## Project layout

```text
hardware/F1_Lamp/       Arduino firmware and bundled local web assets
software/backend/      Cloudflare Worker and Durable Object relay
software/frontend/     Static Pages controller and 3D viewer
tests/                 Local relay integration test
```

Use `hardware/F1_Lamp/` for firmware development. The firmware files at the repository root are legacy copies; do not mix the two sets.

## Hardware and wiring

Target: **ESP8266 NodeMCU 1.0 (ESP-12E Module), 4 MB flash**.

| Channel | Board pin | GPIO | LED count |
| --- | --- | --- | --- |
| Front accent | D1 | 5 | 4 |
| Center stripe | D2 | 4 | 6 |
| Base plate | D5 | 14 | 9 |

The firmware expects 19 WS2812B addressable LEDs, GRB order, 800 kHz signaling, and renders red only. Connect signals to each strip's **DIN**. Use regulated **5 V, at least 2 A recommended**, with common ground between the board, strips, and supply. Do not power strips from 3V3.

There is no complete power/level-shifter schematic in this repository. Confirm board power connections before combining external power and USB. Confirm the actual board, LED type, counts, and pin mapping before flashing another assembly. Channels larger than nine LEDs also require changes to the firmware's effect buffers.

## Flash with Arduino IDE

1. Clone or download this repository.
2. Add the following URL in Preferences → Additional Boards Manager URLs:

   ```text
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```

3. Install **esp8266 by ESP8266 Community** using Boards Manager.
4. Install **Adafruit NeoPixel**, **ArduinoJson version 7**, and **WebSockets by Markus Sattler** using Library Manager.
5. Copy `hardware/F1_Lamp/config.example.h` to `hardware/F1_Lamp/config.h`:

   ```cpp
   #pragma once
   #define WIFI_SSID "YOUR_2_4_GHZ_WIFI"
   #define WIFI_PASS "YOUR_WIFI_PASSWORD"
   #define OTA_PASS  "YOUR_OTA_PASSWORD"
   ```

6. Open **hardware/F1_Lamp/F1_Lamp.ino**. Keep `config.h`, `effects.h`, `cloud.h`, `relay_ca.h`, and `web_assets.h` in that same folder.
7. Select **NodeMCU 1.0 (ESP-12E Module)**, **4MB (FS:2MB OTA:~1019KB)**, and the board's USB port. Start with upload speed 115200 and board defaults for other options.
8. Click Verify, then Upload. The first installation uses USB; later updates can use ArduinoOTA with `OTA_PASS`.
9. Open Serial Monitor at **115200 baud**, read the Wi-Fi IP, and open it from the same network.

Verified build: **ESP8266 core 3.1.2**, **NeoPixel 1.15.4**, **ArduinoJson 7.4.3**, **WebSockets 2.6.1**. Wi-Fi, HTTP server, mDNS, ArduinoOTA, and LittleFS are provided by the ESP8266 core.

Header files compile into one firmware image automatically. **No separate LittleFS/SPIFFS asset upload is required** because `web_assets.h` embeds the fallback website. The firmware uses configured 2.4 GHz Wi-Fi credentials and has no Wi-Fi setup hotspot. Never commit `config.h` or credentials.

## Deploy the cloud

### Backend

```bash
cd software/backend
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` selects the existing account and binds `LAMP_RELAY` to `LampRelay`. Retain its SQLite migration. For a fork, replace `account_id` with an account you can deploy to.

`SERVICE_SECRET` and `DEVICE_KEY` must match the board's pairing. Checked-in values are public development defaults; use private values for a private installation and keep replacements out of public Git history.

### Frontend

Set `WORKER_ORIGIN` in `software/frontend/js/app.js` to the intended Worker origin. From the repository root:

```bash
npx wrangler pages deploy software/frontend --project-name f1-lamp --branch main
```

For multiple Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` to the intended account for Pages deployment. The frontend requires no build command. For Git-based Pages deployment, use root `software/frontend` and output directory `.`.

### Pair an existing board

Defaults are in `hardware/F1_Lamp/cloud.h`, but a saved LittleFS `/cloud.json` overrides them even after firmware updates.

Request a pairing code with **POST /api/pair-code** on the intended Worker. Submit the returned `code` as a form field to **POST http://<board-ip>/api/cloud/setup**. This saves the new pairing and reconnects without reflashing. Treat the pairing code as a credential.

The board needs outbound WSS on port 443 and NTP time synchronization for TLS certificate validation. No router port forwarding is required.

## Verify command delivery

1. Check the board's `/api/cloud/status` for the intended host and `connected: true`.
2. Check the cloud `/api/state` for `online: true`.
3. Send an ON or OFF command from the controller.
4. Confirm the board's `/api/state` changes accordingly.
5. Confirm cloud `pending: false` and that `ack` matches the command `revision`.

An online connection alone does not confirm a command was applied. Reload an already open controller with **Ctrl+Shift+R** after updates.

## Local integration test

Start the local relay in one terminal:

```bash
cd software/backend
npx wrangler dev --ip 127.0.0.1 --port 8787
```

From the repository root in another terminal:

```bash
python -m pip install -r tests/requirements.txt
python tests/test_relay.py
```

The simulated device checks command delivery, acknowledgment, offline queuing, reconnect replay, and increasing revisions against the local Worker. It does not change the production lamp.

## Effects and storage

Effects: Engine Rev, Static Glow, Comet Trail, Soft Breath, Red Wave, Scanner, Center Ripple, Heartbeat, Ember Glow, and Zone Cascade. Firmware transitions crossfade over 700 ms.

The Durable Object coordinates active state and pending commands. `mongodb.ts` retains a legacy optional preset integration; it is not required for device command delivery. Presets use a non-durable in-memory fallback when no external store is configured.

## Credits

The viewer uses Three.js and geometry derived from `F1_Logo_Led_Lamp.3mf`. Firmware dependencies include Adafruit NeoPixel, ArduinoJson, and arduinoWebSockets. Third-party components retain their upstream licenses; see `LICENSE-three.txt` and the respective projects.
