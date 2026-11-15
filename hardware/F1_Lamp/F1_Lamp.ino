/**
 * ============================================================================
 * F1 Lamp — Firmware for ESP8266 (NodeMCU 1.0 / ESP-12E)
 * ============================================================================
 * Hardware:
 *   - Board: ESP8266 (ESP-12E / NodeMCU) with 4MB Flash (FS: 2MB, OTA: ~1019KB)
 *   - Strips: WS2812B Addressable Red LEDs
 *       Channel 0: D1 (GPIO 5)  -> 4 LEDs
 *       Channel 1: D2 (GPIO 4)  -> 6 LEDs
 *       Channel 2: D5 (GPIO 14) -> 9 LEDs
 *       Total: 19 LEDs
 *
 * Features:
 *   - Local REST API (/api/state) & embedded Web UI with 3D model
 *   - ArduinoOTA Wireless firmware update
 *   - Cloud Relay integration (Outbound WSS to Cloudflare Worker)
 *   - 10 Red-only effects with smooth 700ms quintic crossfade
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ArduinoOTA.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"
#include "web_assets.h"
#include "effects.h"
#include "cloud.h"

// ----------------------------------------------------------------------------
// Pin & LED Configuration
// ----------------------------------------------------------------------------
Adafruit_NeoPixel stripA(4, 5,  NEO_GRB + NEO_KHZ800);  // D1 / GPIO5  (4 LEDs)
Adafruit_NeoPixel stripB(6, 4,  NEO_GRB + NEO_KHZ800);  // D2 / GPIO4  (6 LEDs)
Adafruit_NeoPixel stripC(9, 14, NEO_GRB + NEO_KHZ800);  // D5 / GPIO14 (9 LEDs)

Adafruit_NeoPixel* strips[] = {&stripA, &stripB, &stripC};
const int NUM_STRIPS = sizeof(strips) / sizeof(strips[0]);

// Web server on default HTTP port 80
ESP8266WebServer server(80);

// ----------------------------------------------------------------------------
// Device State Variables
// ----------------------------------------------------------------------------
bool powerOn = true;
bool zones[3] = {true, true, true};
bool otaReady = false;
bool updating = false;

uint8_t  brightness   = 40;     // 0 - 100%
uint16_t speedPercent = 100;    // 25 - 250%
String   effect       = "rev";  // Startup with Engine Rev effect

uint32_t lastFrame     = 0;
uint32_t lastPhaseTick = 0;
uint32_t fadeStart     = 0;

float phaseSeconds = 0.0f;
float displayed[3][9] = {};
float fadeFrom[3][9]  = {};

// ----------------------------------------------------------------------------
// Phase & Crossfade Management
// ----------------------------------------------------------------------------
void updatePhase() {
  uint32_t now = millis();
  phaseSeconds += (now - lastPhaseTick) / 1000.0f * (speedPercent / 100.0f);
  lastPhaseTick = now;
}

void beginTransition() {
  for (int s = 0; s < 3; s++) {
    for (int j = 0; j < 9; j++) {
      fadeFrom[s][j] = displayed[s][j];
    }
  }
  fadeStart = millis();
}

void clearAll() {
  for (auto p : strips) {
    p->clear();
    p->show();
  }
}

// ----------------------------------------------------------------------------
// JSON State Serializer
// ----------------------------------------------------------------------------
String stateJson() {
  updatePhase();
  String json;
  json.reserve(260);

  json = "{\"device\":\"F1-Lamp\",\"apiVersion\":3,\"power\":";
  json += powerOn ? "true" : "false";
  json += ",\"color\":\"#ff0000\",\"brightness\":";
  json += brightness;
  json += ",\"speed\":";
  json += speedPercent;
  json += ",\"effect\":\"";
  json += effect;
  json += "\",\"zones\":[";
  for (int i = 0; i < 3; i++) {
    if (i > 0) json += ',';
    json += zones[i] ? "true" : "false";
  }
  json += "],\"phase\":";
  json += String(phaseSeconds, 4);
  json += '}';

  return json;
}

void sendState() {
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", stateJson());
}

bool isNumber(const String& s, unsigned minValue, unsigned maxValue) {
  if (s.length() == 0 || s.length() > 4) return false;
  for (unsigned i = 0; i < s.length(); i++) {
    if (!isDigit(s[i])) return false;
  }
  long n = s.toInt();
  return (n >= (long)minValue && n <= (long)maxValue);
}

// ----------------------------------------------------------------------------
// REST API: POST /api/state
// ----------------------------------------------------------------------------
void setState() {
  // Security check: Only accept requests originating from this device's web page
  String origin = server.header("Origin");
  if (origin != "http://" + server.hostHeader()) {
    server.send(403, "application/json", "{\"error\":\"Open the page from this device IP\"}");
    return;
  }

  const char* requiredKeys[] = {"power", "brightness", "speed", "effect", "zones", "replay"};
  for (auto key : requiredKeys) {
    if (!server.hasArg(key)) {
      server.send(400, "application/json", "{\"error\":\"Missing field\"}");
      return;
    }
  }

  String p = server.arg("power");
  String z = server.arg("zones");
  String e = server.arg("effect");
  String r = server.arg("replay");

  bool ok = (p == "0" || p == "1") && (r == "0" || r == "1") && (z.length() == 3);
  for (unsigned i = 0; i < z.length(); i++) {
    ok = ok && (z[i] == '0' || z[i] == '1');
  }

  ok = ok && isNumber(server.arg("brightness"), 0, 100) && isNumber(server.arg("speed"), 25, 250);
  ok = ok && validEffect(e);

  if (!ok) {
    server.send(400, "application/json", "{\"error\":\"Invalid setting\"}");
    return;
  }

  bool restart = (r == "1") || (e != effect) || (!powerOn && p == "1");

  updatePhase();
  beginTransition();

  powerOn      = (p == "1");
  brightness   = server.arg("brightness").toInt();
  speedPercent = server.arg("speed").toInt();
  effect       = e;

  for (int i = 0; i < 3; i++) {
    zones[i] = (z[i] == '1');
  }

  if (restart) {
    phaseSeconds = 0;
  }

  sendState();
}

// ----------------------------------------------------------------------------
// Lighting Engine (Called each loop tick)
// ----------------------------------------------------------------------------
void renderLights() {
  // Frame limit ~80 FPS (every 12ms)
  if (updating || millis() - lastFrame < 12) return;
  lastFrame = millis();

  updatePhase();
  float blend = smooth((millis() - fadeStart) / 700.0f);

  for (int s = 0; s < 3; s++) {
    int numPixels = strips[s]->numPixels();
    for (int j = 0; j < numPixels; j++) {
      float target = (powerOn && zones[s])
                       ? (effectLevel(effect, phaseSeconds, s, j, numPixels) * (brightness / 100.0f))
                       : 0.0f;
      float v = fadeFrom[s][j] + (target - fadeFrom[s][j]) * blend;
      displayed[s][j] = v;

      // Pure red WS2812B output
      uint8_t redByte = (uint8_t)(constrain(v, 0.0f, 1.0f) * 255.0f + 0.5f);
      strips[s]->setPixelColor(j, redByte, 0, 0);
    }
    strips[s]->show();
  }
}

// ----------------------------------------------------------------------------
// Arduino Setup
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n[F1-Lamp] Booting up...");

  // Initialize LED Strips
  for (auto p : strips) {
    p->begin();
  }
  clearAll();
  lastPhaseTick = fadeStart = millis();

  // Configure Wi-Fi
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.hostname("F1-Lamp");
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  // Configure ArduinoOTA for wireless firmware update
  ArduinoOTA.setHostname("F1-Lamp");
  ArduinoOTA.setPassword(OTA_PASS);

  ArduinoOTA.onStart([]() {
    updating = true;
    clearAll();
    Serial.println("[OTA] Firmware update starting...");
  });

  ArduinoOTA.onError([](ota_error_t e) {
    updating = false;
    memset(displayed, 0, sizeof(displayed));
    beginTransition();
    Serial.printf("[OTA] Error code: %u\n", e);
  });

  // Setup Web Server Endpoints
  server.collectHeaders("Origin");
  server.on("/api/state", HTTP_GET, sendState);
  server.on("/api/state", HTTP_POST, setState);

  // Setup Cloud & Web Assets
  cloudSetup(server);
  registerWebAssets(server);

  server.onNotFound([]() {
    server.send(404, "text/plain", "Not found");
  });

  server.begin();
  Serial.println("[F1-Lamp] HTTP Server ready");
}

// ----------------------------------------------------------------------------
// Main Loop
// ----------------------------------------------------------------------------
void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!otaReady) {
      ArduinoOTA.begin();
      otaReady = true;
      Serial.print("[WiFi] Connected! IP: http://");
      Serial.println(WiFi.localIP());
    }
    ArduinoOTA.handle();
    server.handleClient();
    cloudLoop();
  }

  renderLights();
  delay(1);
}

