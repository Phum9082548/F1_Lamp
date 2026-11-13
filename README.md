# F1 Lamp · Real 3D + Wi-Fi control

## Internet control

Handshake fix: do not append CRLF to the end of `setExtraHeaders` content.
WebSockets 2.6.1 appends CRLF itself before writing User-Agent. An extra blank
line caused User-Agent to be interpreted as a WebSocket frame (RSV 2/3 error).
`node test_handshake.cjs` checks the exact installed-library header layout.

The private hosted Site now includes an authenticated Cloudflare Worker relay
with D1 command/report storage. Owner browsers sign in using the existing Site
access policy. The ESP makes an outbound TLS-verified WebSocket connection; no
router forwarding or inbound Internet exposure is needed. Local Wi-Fi control
and ArduinoOTA remain available.

Install ArduinoJson 7 and WebSockets by Markus Sattler, as well as Adafruit
NeoPixel. Compile-tested with the installed ESP8266 core 3.1.2. Flash use is
about 87% of the 1 MB sketch budget; use the 4 MB flash / 2 MB FS OTA layout.

Pair once at home: upload the firmware, open the private hosted Site, and use
Copy pairing code. Open the ESP's HTTP IP on home Wi-Fi, paste the code into
the pairing field and save. The device stores it in LittleFS. The firmware ZIP
does not contain the relay's service/device credentials. After pairing, use the
same private hosted URL from mobile data or another Wi-Fi network.

The code includes the current verified public TLS root. NTP sets the clock for
certificate validation. There is no insecure TLS fallback. The Site's service
and device keys are stored as secret runtime variables, never in client bundles.
Pairing codes must be kept private. Re-pair if access keys are changed.

Online state is based on device heartbeats. Commands are marked pending until
the ESP acknowledges them. Offline commands are rejected; unacknowledged commands
expire after 30 seconds and are not replayed on a later boot. A persistent
WebSocket avoids a TLS handshake for every command. Reconnection can briefly
pause rendering on the ESP8266 while its TLS stack connects.

Tests: `node test_relay.mjs` (Node 24 SQLite) and `node test_effects.cjs`.
Build Worker: `python build_worker.py`. Hosting manifest retains the existing
private Site ID, uses the `DB` D1 binding, and migrations live under `drizzle/`.

Uses the real vertices and triangles from `F1_Logo_Led_Lamp.3mf`: 8 meshes,
11,753 vertices, 23,506 triangles. The source contains separate parts arranged
for printing, so presentation assembly transforms are applied. Mesh topology is
preserved. The physical LED path and channel placement are illustrative.

## Firmware

Open `F1_Lamp/F1_Lamp.ino` in Arduino IDE. Install the ESP8266 board package
and Adafruit NeoPixel. Copy `config.example.h` to `config.h` and fill in local
Wi-Fi (2.4 GHz) and OTA credentials. `config.h` is excluded from the repository.

Tested compilation: ESP8266 core 3.1.2, Adafruit NeoPixel 1.15.4,
NodeMCU 1.0 / ESP-12E, 4 MB flash, FS 2 MB / OTA ~1019 KB.
Firmware size with Internet support: about 945 KB. Actual hardware operation has not been tested.

Pins: D1 / GPIO5 = 4 LEDs, D2 / GPIO4 = 6 LEDs, D5 / GPIO14 = 9 LEDs.
Use a stable 5 V supply for the board's appropriate 5 V input and the WS2812B
strips, with a common ground. The earlier ~3.8 V supply needs resolving.

Upload via the existing OTA network port using the password currently in the
board; use USB if authentication fails. This firmware retains ArduinoOTA.
The entire website, model, and renderer are gzipped into `web_assets.h` in
program flash. No LittleFS tool or separate filesystem upload is required.
After boot, open the IP printed at 115200 baud, such as
`http://192.168.1.104/`, from a computer or phone on the same LAN.
IP addresses can change after reboot.

The device serves GET and same-origin POST `/api/state`, validates all fields,
and returns its confirmed state. The UI reads the board before controlling it,
coalesces slider changes, serializes writes, and reports failed requests.
Controls are LAN-local; no router port forwarding is needed. HTTP control is
intended for a trusted home LAN. POST requests from other origins are rejected.
Settings are held in RAM on the ESP; reboot restores the startup defaults.

## Website

The private hosted HTTPS Site controls the paired lamp through the relay.
The standalone HTML is a simulator. Neither silently attempts HTTP requests
to private LAN addresses. Use the Open lamp button to navigate to the ESP's
same-origin page for local control and first-time pairing.

Drag to rotate, wheel or pinch to zoom; reset, auto-rotate, and exploded view
are available. Brightness, speed, channel toggles, and ten red-only effects update
the real mesh visualization. Engine rev starts D2 and D5 together; D1 is delayed
three steps. Rendering and firmware use matching per-pixel formulas generated
by make_effects.py. All modes fade in; power, channel, brightness and mode
changes use a 700 ms quintic crossfade. Speed changes preserve effect phase.
Static assets are streamed in 1 KB chunks while rendering continues.
API version 3 is required; upload the new firmware before using these controls.

`dist/` is buildless. Serve with `python -m http.server --directory dist`.
Three.js 0.170.0 is vendored locally with its MIT license. The optional web font
uses Google Fonts; system font fallback works without Internet.

To regenerate: `python convert_model.py <3mf-path>`, then `python embed_assets.py`.
Do not rerun upgrade.py; it is the one-time migration from the original mockup.

References:
- https://arduino-esp8266.readthedocs.io/en/latest/ota_updates/readme.html
- https://github.com/esp8266/Arduino/tree/master/libraries/ESP8266WebServer
- https://threejs.org/docs/#examples/en/controls/OrbitControls
