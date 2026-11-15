# F1 Lamp · Real 3D + Wi-Fi & Cloud Relay Control

[![Cloudflare Pages](https://img.shields.io/badge/Frontend-Cloudflare%20Pages-orange?logo=cloudflare)](https://f1-lamp.pages.dev)
[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare%20Workers-f38020?logo=cloudflare)](https://f1-lamp-relay.f1-lamp-control.workers.dev)
[![ESP8266](https://img.shields.io/badge/Hardware-ESP8266%20NodeMCU-blue)](https://www.espressif.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE-three.txt)

โคมไฟ LED โลโก้ Formula 1 (F1) ควบคุมด้วยไมโครคอนโทรลเลอร์ **ESP8266** รองรับการสั่งงานแบบ Real-time ทั้งผ่าน **Wi-Fi ภายในบ้าน (mDNS: `f1-lamp.local`)** และ **ผ่านอินเทอร์เน็ตนอกบ้าน 4G/5G (Cloud Relay บน Cloudflare Workers + MongoDB)** พร้อมหน้าเว็บ Web App สไตล์ F1 Pit Wall ที่มี **3D Simulator (Three.js)** จำลองไฟบนโมเดล 3MF จริง (23,506 สามเหลี่ยม)

---

## 🌟 จุดเด่นของระบบ (Key Features)

* **สถาปัตยกรรมแยกส่วนชัดเจน (Clean Architecture):** แยกเด็ดขาดระหว่าง **Hardware (เฟิร์มแวร์ C++)** และ **Software (Frontend + Backend บน Cloudflare)**
* **เว็บแอปพลิเคชันออนไลน์ระดับโลก:** โฮสต์บน **Cloudflare Pages** ที่ [https://f1-lamp.pages.dev](https://f1-lamp.pages.dev) เร็วระดับมิลลิวินาที ไม่มีการหลับ (No Cold Start)
* **ควบคุมนอกบ้านไม่ต้อง Forward Port:** เชื่อมต่อผ่าน Outbound TLS WebSocket (`wss://`) เข้าหา Cloudflare Worker Relay ปลอดภัยสูงด้วย Root CA ในตัว
* **ค้นหาโคมไฟอัตโนมัติ (mDNS):** ไม่ต้องจำเลข IP เข้าผ่านชื่อ `http://f1-lamp.local` ในบ้านได้ทันที พร้อมปุ่มสแกนหาโคมไฟจากหน้าเว็บ
* **ระบบจำลอง 3D เสมือนจริง:** แสดงผลชิ้นงานจริง 8 ชิ้นส่วน 23,506 สามเหลี่ยม หมุน ซูม แยกชิ้นส่วน (Exploded View) และคำนวณแสงไฟบนเว็บตรงกับฮาร์ดแวร์จริง 1:1
* **รองรับ Database ถาวร:** มีโมดูลเชื่อมต่อกับ **MongoDB Atlas** บันทึกสถานะไฟล่าสุดและสูตรไฟโปรด (Presets)
* **UI Minimalist & ใช้งานง่าย:** ดีไซน์สไตล์ F1 Telemetry ตัดไอคอนรกตา/อีโมจิออกทั้งหมด เน้นความคลีน ปุ่มลัดปรับความสว่างและความเร็วได้ในคลิกเดียว

---

## 📁 โครงสร้างโฟลเดอร์ (Project Structure)

```text
F1_Lamp/
├── hardware/                    # ══════ ฝั่งฮาร์ดแวร์ & เฟิร์มแวร์ ESP8266 ══════
│   ├── README.md                # รายละเอียดการต่อสายไฟและสเปกพิน
│   └── F1_Lamp/
│       ├── F1_Lamp.ino          # โค้ดหลัก Arduino IDE (Clean code พร้อมคอมเมนต์ครบ)
│       ├── effects.h            # สูตรคณิตศาสตร์แสงไฟ 10 โหมด
│       ├── cloud.h              # ไคลเอนต์ Secure WebSocket เชื่อม Cloudflare Worker
│       ├── config.example.h     # เทมเพลตสำหรับใส่ชื่อ Wi-Fi & รหัส OTA
│       ├── relay_ca.h           # ใบรับรอง Root CA (TLS X.509)
│       └── web_assets.h         # เว็บและโมเดล 3D สำรองแบบ Gzip ใน Flash Memory
│
├── software/                    # ══════ ฝั่งซอฟต์แวร์ คลาวด์ และเว็บแอป ══════
│   ├── frontend/                # [Cloudflare Pages] Web App + 3D Simulator
│   │   ├── index.html           # หน้าเว็บหลัก สไตล์มินิมอล คลีน ไม่มีอีโมจิ
│   │   ├── css/style.css        # ดีไซน์ F1 Pit Wall Telemetry Theme
│   │   └── js/
│   │       ├── app.js           # ระบบควบคุม State, ซิงก์เน็ต และสแกน mDNS
│   │       ├── effects.js       # โมดูลสูตรแสงไฟ 10 โหมด (ตรงกับ C++ 1:1)
│   │       ├── viewer.js        # Three.js WebGL Renderer & Diffuser Custom Shader
│   │       └── model.json       # พิกัด 3D Mesh จริง (23,506 Triangles)
│   │
│   └── backend/                 # [Cloudflare Workers + MongoDB]
│       ├── wrangler.toml        # คอนฟิกการ Deploy Cloudflare Worker
│       ├── package.json         # ไลบรารี Wrangler & TypeScript
│       └── src/
│           ├── index.ts         # WebSocket Relay (`/api/device/ws`) & REST API
│           └── mongodb.ts       # โมดูลบันทึก State & Presets ลง MongoDB Atlas
│
├── .gitignore                   # ป้องกันการ Push ข้อมูลลับ (config.h, node_modules)
├── README.md                    # คู่มือภาพรวมโปรเจกต์
└── วิธีใช้.txt                  # ขั้นตอนการติดตั้งและใช้งานฉบับย่อภาษาไทย
```

---

## 🔌 วงจรและการต่อขาฮาร์ดแวร์ (Hardware & Pinout)

* **บอร์ดควบคุม:** ESP8266 (NodeMCU 1.0 / ESP-12E), Flash 4MB (ตั้งค่า FS 2MB / OTA)
* **ไฟ LED:** ไฟเส้น WS2812B แสงสีแดง (Signature Red) ทั้งหมด 19 ดวง:
  * **โซน 1 (D1 / GPIO 5):** 4 ดวง (แถบโลโก้ด้านหน้า)
  * **โซน 2 (D2 / GPIO 4):** 6 ดวง (แถบกลาง)
  * **โซน 3 (D5 / GPIO 14):** 9 ดวง (ฐานล่าง)
* **ไฟเลี้ยง:** แนะนำใช้แหล่งจ่ายไฟ 5V นิ่งๆ (กระแสอย่างน้อย 2A) ต่อกราวด์ร่วม (Common Ground) ระหว่างบอร์ดและไฟเส้น

---

## 💡 โหมดแสงไฟ 10 รูปแบบ (Lighting Effects)

ทุกโหมดมีการเปลี่ยนผ่านด้วย **Quintic Smootherstep 700ms** นุ่มนวล ไม่กระตุก:

| ลำดับ | ชื่อภาษาไทย | ชื่อโหมด (ID) | คำอธิบายลักษณะแสง |
| :---: | :--- | :--- | :--- |
| 1 | **เร่งเครื่อง** | `rev` | สตาร์ทเครื่องยนต์ D2 และ D5 เร่งขึ้นพร้อมกัน D1 ตามหลัง 3 สเต็ป |
| 2 | **ไฟค้าง** | `static` | แสงสีแดงสว่างนิ่งเต็มดวง |
| 3 | **ดาวหาง** | `chase` | หางแสงดาวหางวิ่งวนรอบตัวโคมอย่างรวดเร็ว |
| 4 | **หายใจ** | `breathe` | ไฟค่อยๆ วาบสว่างและหรี่ลงเป็นจังหวะนุ่มนวล |
| 5 | **คลื่นแสง** | `wave` | คลื่นแสงวิ่งผ่านต่อเนื่องข้ามแต่ละโซน |
| 6 | **สแกนไปกลับ** | `scanner` | ลำแสงสแกนกวาดไป-กลับสไตล์ Knight Rider |
| 7 | **แผ่ออกจากกลาง** | `ripple` | คลื่นแสงกระจายตัวออกจากศูนย์กลางสู่ขอบนอก |
| 8 | **หัวใจเต้น** | `heartbeat` | จังหวะกระพริบคู่คล้ายชีพจรหัวใจเต้น |
| 9 | **ประกายไฟ** | `ember` | แสงระยิบระยับแบบสุ่มคล้ายสะเก็ดไฟในท่อไอเสีย |
| 10 | **ไหลสลับโซน** | `cascade` | แสงไฟไหลสลับลำดับจากโซนสู่โซน |

---

## 🚀 ขั้นตอนการติดตั้งและเริ่มต้นใช้งาน (Getting Started)

### 1. ฝั่ง Hardware (ESP8266)
1. เปิดโปรแกรม Arduino IDE
2. ติดตั้งไลบรารีผ่าน Library Manager:
   * `Adafruit NeoPixel`
   * `ArduinoJson` (v7)
   * `WebSockets by Markus Sattler`
3. คัดลอก `hardware/F1_Lamp/config.example.h` เป็น `config.h` แล้วใส่ชื่อ Wi-Fi และรหัสผ่าน
4. เปิดไฟล์ [hardware/F1_Lamp/F1_Lamp.ino](file:///c:/Users/user/Desktop/F1_Lamp/hardware/F1_Lamp/F1_Lamp.ino)
5. เลือกบอร์ด **NodeMCU 1.0 (ESP-12E)** -> Flash: **4MB (FS: 2MB / OTA: ~1019KB)** แล้วกด **Upload**

### 2. ฝั่ง Software (Cloudflare Deploy)
* **Backend (Workers):**
  ```bash
  cd software/backend
  npm install
  npx wrangler deploy
  ```
* **Frontend (Pages):**
  ```bash
  npx wrangler pages deploy software/frontend --project-name f1-lamp
  ```

---

## 📱 การควบคุมใช้งาน

* **ควบคุมผ่านอินเทอร์เน็ต (4G/5G/ทุกที่ทั่วโลก):**
  * เปิดเว็บ: **[https://f1-lamp.pages.dev](https://f1-lamp.pages.dev)**
* **ควบคุมตรงในบ้านผ่าน Wi-Fi (ไม่ต้องพึ่งเน็ต):**
  * เปิดเบราว์เซอร์เข้า: **`http://f1-lamp.local/`** (หรือกดปุ่มสแกนบนหน้าเว็บ)

---

## 📄 License
* 3D Mesh Assets: Based on `F1_Logo_Led_Lamp.3mf`
* Libraries: Three.js (MIT), Adafruit NeoPixel (LGPL), ArduinoJson (MIT), WebSockets (LGPL)
