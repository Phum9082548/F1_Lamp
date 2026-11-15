# F1 Lamp · Real 3D + Wi-Fi & Cloud Relay Control

[![Cloudflare Pages](https://img.shields.io/badge/Frontend-Cloudflare%20Pages-orange)](https://f1-lamp.pages.dev)
[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare%20Workers-f38020)](https://f1-lamp-relay.f1-lamp-control.workers.dev)
[![ESP8266](https://img.shields.io/badge/Hardware-ESP8266%20NodeMCU-blue)](https://www.espressif.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE-three.txt)

Formula 1 (F1) LED logo lamp powered by an **ESP8266** microcontroller. Features dual-mode control: **Local LAN via mDNS (`f1-lamp.local`)** and **Remote Internet Control via Cloudflare Workers WebSocket Relay + MongoDB Atlas**. Includes an interactive **3D WebGL simulator (Three.js)** using original 3MF mesh geometry (23,506 triangles).

Live Web App: [https://f1-lamp.pages.dev](https://f1-lamp.pages.dev)  
Live Cloud Relay: [https://f1-lamp-relay.f1-lamp-control.workers.dev](https://f1-lamp-relay.f1-lamp-control.workers.dev)

---

## Key Features

- **Strict Architecture Separation:** Clean decoupling between embedded C++ firmware (`hardware/`) and modern web/serverless cloud applications (`software/`).
- **Global Serverless Hosting:** Frontend deployed on Cloudflare Pages with zero cold-starts and worldwide edge distribution.
- **Outbound TLS Cloud Relay:** Outbound WSS connection (port 443) from ESP8266 to Cloudflare Workers with verified Root CA certificate. No router port forwarding or public IP exposure required.
- **Zero-Config Local Discovery (mDNS):** Broadcasts as `http://f1-lamp.local` for instant local browser access without static IP configuration.
- **Real-Time 3D Simulation:** WebGL rendering with real vertices and normals from `F1_Logo_Led_Lamp.3mf`. Supports camera orbit, zoom, auto-rotation, exploded component view, and custom diffuser GLSL shader.
- **Persistent State & Presets:** Ready for MongoDB Atlas integration to persist lamp state and user presets across reboots.
- **Minimalist Telemetry UI:** Clean, dark-mode responsive interface with zero emojis, high-contrast controls, and one-click quick presets.

---

## Directory Structure

```text
F1_Lamp/
├── hardware/                    # Embedded Firmware (ESP8266 C++)
│   ├── README.md                # Wiring guide and hardware specifications
│   └── F1_Lamp/
│       ├── F1_Lamp.ino          # Primary Arduino sketch (modular, commented)
│       ├── effects.h            # 10 LED lighting effect math algorithms
│       ├── cloud.h              # Outbound TLS WebSocket client for Cloudflare
│       ├── config.example.h     # Wi-Fi & OTA credentials template
│       ├── relay_ca.h           # Root CA certificate (TLS X.509)
│       └── web_assets.h         # Offline fallback Gzip web bundle in Flash
│
├── software/                    # Web & Cloud Applications
│   ├── frontend/                # [Cloudflare Pages] Web App + 3D Simulator
│   │   ├── index.html           # Minimalist HTML5 interface (English, zero emojis)
│   │   ├── css/style.css        # F1 Telemetry dark theme styling
│   │   └── js/
│   │       ├── app.js           # UI state machine, network sync, mDNS scanner
│   │       ├── effects.js       # Effect formulas matching hardware 1:1
│   │       ├── viewer.js        # Three.js 3D model loader and shader uniforms
│   │       └── model.json       # Extracted 3MF mesh geometry (23,506 triangles)
│   │
│   └── backend/                 # [Cloudflare Workers + MongoDB]
│       ├── wrangler.toml        # Cloudflare Workers configuration
│       ├── package.json         # Worker dependencies & scripts
│       ├── tsconfig.json        # TypeScript configuration
│       └── src/
│           ├── index.ts         # WebSocket Relay (/api/device/ws) & REST API
│           └── mongodb.ts       # MongoDB Atlas Data API integration
│
├── .gitignore                   # Protects private keys, config.h, node_modules
├── README.md                    # Project documentation
└── วิธีใช้.txt                  # Quick start guide (Thai)
```

---

## Hardware Specifications & Pinout

- **Microcontroller:** ESP8266 (NodeMCU 1.0 / ESP-12E), 4MB Flash (Layout: FS 2MB / OTA ~1019KB).
- **LED Strips:** WS2812B Addressable Red LEDs (19 total LEDs across 3 distinct channels):
  - **Channel 0 (D1 / GPIO 5):** 4 LEDs (Front logo accent)
  - **Channel 1 (D2 / GPIO 4):** 6 LEDs (Center stripe)
  - **Channel 2 (D5 / GPIO 14):** 9 LEDs (Bottom base plate)
- **Power Supply:** Regulated 5V DC (minimum 2A recommended) with shared common ground between the board and LED strips.

---

## Lighting Effects (10 Modes)

All mode, channel, brightness, and power transitions use a 700ms quintic smootherstep crossfade:

| ID | Name | Description |
| :--- | :--- | :--- |
| `rev` | **Engine Rev** | Engine acceleration curve. D2 and D5 ignite simultaneously; D1 follows with a 3-step delay. |
| `static` | **Static Glow** | Continuous solid illumination at chosen brightness. |
| `chase` | **Comet Trail** | Fast-moving comet trail looping smoothly across the strip. |
| `breathe` | **Soft Breath** | Gentle sinusoidal pulsation for ambient lighting. |
| `wave` | **Red Wave** | Harmonic traveling light wave moving across all three channels. |
| `scanner` | **Scanner** | Knight Rider-style back-and-forth beam oscillation. |
| `ripple` | **Center Ripple** | Expansion wave propagating outward from center to edges. |
| `heartbeat` | **Heartbeat** | Dual-rhythmic arterial pulse simulation. |
| `ember` | **Ember Glow** | Multi-frequency harmonic flicker resembling glowing exhaust coals. |
| `cascade` | **Zone Cascade** | Sequential cascading phase shift cycling through channels D1, D2, and D5. |

---

## Getting Started

### 1. Hardware Firmware (Arduino IDE)

1. Open Arduino IDE and install the following libraries via Library Manager:
   - `Adafruit NeoPixel`
   - `ArduinoJson` (v7)
   - `WebSockets by Markus Sattler`
2. Copy `hardware/F1_Lamp/config.example.h` to `hardware/F1_Lamp/config.h` and configure your local 2.4 GHz Wi-Fi SSID, password, and OTA secret.
3. Open `hardware/F1_Lamp/F1_Lamp.ino`.
4. Select board: **NodeMCU 1.0 (ESP-12E)** -> Flash Size: **4MB (FS: 2MB / OTA: ~1019KB)**.
5. Connect USB cable and click **Upload**.

### 2. Software Deployment (Cloudflare)

#### Deploy Backend (Workers)
```bash
cd software/backend
npm install
npx wrangler deploy
```

*(Optional) Configure MongoDB Atlas Data API credentials:*
```bash
npx wrangler secret put MONGODB_DATA_API_KEY
npx wrangler secret put MONGODB_DATA_API_URL
```

#### Deploy Frontend (Pages)
```bash
cd ../frontend
npx wrangler pages deploy . --project-name f1-lamp
```

---

## Control & Operations

1. **Remote Internet Control (Anywhere via 4G/5G/Wi-Fi):**
   - Access the web interface: **[https://f1-lamp.pages.dev](https://f1-lamp.pages.dev)**
   - Add to mobile Home Screen for a fullscreen Progressive Web App experience.
2. **Local LAN Control (No Internet Required):**
   - In home network, navigate to: **`http://f1-lamp.local/`** or use the "Scan Local Network" button on the web app.

---

## License

- 3D Geometry: Derived from `F1_Logo_Led_Lamp.3mf`.
- Vendored Libraries: Three.js (MIT), Adafruit NeoPixel (LGPL), ArduinoJson (MIT), WebSockets (LGPL).
