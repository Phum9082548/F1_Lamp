# F1 Lamp · Hardware & Firmware (ESP8266)

Firmware code for the ESP8266 microcontroller (NodeMCU 1.0 / ESP-12E).

## Pinout & Wiring
- **D1 (GPIO 5):** Strip Channel 0 (4 WS2812B Red LEDs)
- **D2 (GPIO 4):** Strip Channel 1 (6 WS2812B Red LEDs)
- **D5 (GPIO 14):** Strip Channel 2 (9 WS2812B Red LEDs)
- **Total LEDs:** 19 LEDs
- **Power:** Stable 5V DC (Minimum 2A recommended) with Common Ground.

## Flashing Instructions
1. Open `hardware/F1_Lamp/F1_Lamp.ino` in Arduino IDE.
2. Install required libraries via Library Manager:
   - `Adafruit NeoPixel`
   - `ArduinoJson` (v7)
   - `WebSockets by Markus Sattler`
3. Configure your Wi-Fi SSID and password in `config.h` (copy from `config.example.h`).
4. Select board: **NodeMCU 1.0 (ESP-12E)**.
   - Flash Size: **4MB (FS: 2MB / OTA: ~1019KB)**.
5. Upload via USB or ArduinoOTA.

