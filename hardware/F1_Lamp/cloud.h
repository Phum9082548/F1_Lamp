/**
 * ============================================================================
 * F1 Lamp — Cloud WebSocket Relay Client
 * ============================================================================
 * Enables remote control over 4G/5G Internet without router port-forwarding.
 * - Pre-configured to connect automatically to your Cloudflare Worker Relay.
 * - Connects via outbound WSS (Port 443).
 * - Synchronizes state bidirectionally with automatic revision tracking.
 */

#pragma once

#include <Arduino.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

// Default Cloudflare Worker Relay credentials (matches wrangler.toml)
static const char DEFAULT_CLOUD_HOST[]   = "f1-lamp-relay.f1-lamp-control.workers.dev";
static const char DEFAULT_CLOUD_SECRET[] = "f1_secret_service_auth_token_xyz";
static const char DEFAULT_DEVICE_KEY[]   = "f1_secure_device_secret_key_1234567890";

WebSocketsClient cloudSocket;

// Pre-populated so the lamp connects automatically on boot without manual pairing
String cloudHost    = DEFAULT_CLOUD_HOST;
String cloudService = DEFAULT_CLOUD_SECRET;
String cloudKey     = DEFAULT_DEVICE_KEY;
String cloudHeaders;

bool cloudConfigured = true;
bool cloudStarted    = false;
bool cloudConnected  = false;

uint32_t cloudLastSync = 0;
uint64_t cloudRevision = 0;

// Forward declarations from F1_Lamp.ino
extern bool powerOn;
extern uint8_t brightness;
extern uint16_t speedPercent;
extern String effect;
extern bool zones[3];
extern float phaseSeconds;
extern bool updating;

void updatePhase();
void beginTransition();
String stateJson();
bool validEffect(const String& e);

/**
 * Parse and validate custom pairing JSON string (optional override).
 * Format: {"host":"...","service":"...","key":"..."}
 */
bool readCloudCode(const String& code) {
  if (code.length() > 4096) return false;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, code);
  if (err) return false;

  String host    = doc["host"] | "";
  String service = doc["service"] | "";
  String key     = doc["key"] | "";

  if (host.length() < 3 || service.length() < 16 || key.length() < 16) {
    return false;
  }

  if (service.indexOf('\r') >= 0 || service.indexOf('\n') >= 0 ||
      key.indexOf('\r') >= 0     || key.indexOf('\n') >= 0) {
    return false;
  }

  cloudHost       = host;
  cloudService    = service;
  cloudKey        = key;
  cloudConfigured = true;
  return true;
}

/**
 * WebSocket event callback from WebSocketsClient
 */
void cloudEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      cloudConnected = true;
      cloudLastSync  = 0;
      Serial.println("[Cloud] Connected to Cloudflare Relay via WSS!");
      break;

    case WStype_DISCONNECTED:
      cloudConnected = false;
      Serial.println("[Cloud] Disconnected from Cloudflare Relay (will retry)");
      break;

    case WStype_TEXT: {
      if (length > 2048) return;

      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;

      if (doc["type"] != "command" || !doc["revision"].is<uint64_t>()) return;

      uint64_t rev = doc["revision"].as<uint64_t>();
      if (rev <= cloudRevision) return;

      // Apply incoming command from Cloud
      if (doc["apply"] == true) {
        JsonObject s = doc["state"];
        if (!s["power"].is<bool>() || !s["brightness"].is<int>() ||
            !s["speed"].is<int>() || !s["effect"].is<const char*>() ||
            !s["zones"].is<JsonArray>()) {
          return;
        }

        int level   = s["brightness"];
        int speed   = s["speed"];
        String mode = s["effect"].as<String>();
        JsonArray z = s["zones"];

        if (level < 0 || level > 100 || speed < 25 || speed > 250 ||
            !validEffect(mode) || z.size() != 3) {
          return;
        }

        for (int i = 0; i < 3; i++) {
          if (!z[i].is<bool>()) return;
        }

        bool restart = (s["replay"] == true) || (mode != effect) || (!powerOn && s["power"] == true);

        updatePhase();
        beginTransition();

        powerOn      = s["power"];
        brightness   = level;
        speedPercent = speed;
        effect       = mode;

        for (int i = 0; i < 3; i++) {
          zones[i] = z[i];
        }

        if (restart) {
          phaseSeconds = 0;
        }

        Serial.printf("[Cloud] Applied remote command: power=%d, effect=%s, bright=%d\n",
                      powerOn, effect.c_str(), brightness);
      }

      cloudRevision = rev;
      cloudLastSync = 0; // Trigger immediate state echo
      break;
    }

    default:
      break;
  }
}

/**
 * Initialize Cloud endpoints on local WebServer
 */
void cloudSetup(ESP8266WebServer& server) {
  if (LittleFS.begin()) {
    File f = LittleFS.open("/cloud.json", "r");
    if (f && f.size() <= 4096) {
      if (readCloudCode(f.readString())) {
        Serial.println("[Cloud] Loaded custom pairing config from LittleFS");
      }
    }
    f.close();
  }

  // REST API: GET /api/cloud/status
  server.on("/api/cloud/status", HTTP_GET, [&server]() {
    server.sendHeader("Cache-Control", "no-store");
    String res = "{\"configured\":";
    res += cloudConfigured ? "true" : "false";
    res += ",\"connected\":";
    res += cloudConnected ? "true" : "false";
    res += ",\"host\":\"" + cloudHost + "\"}";
    server.send(200, "application/json", res);
  });

  // REST API: POST /api/cloud/setup
  server.on("/api/cloud/setup", HTTP_POST, [&server]() {
    String code = server.arg("code");
    if (!readCloudCode(code)) {
      server.send(400, "text/plain", "Invalid pairing code");
      return;
    }

    File f = LittleFS.open("/cloud.json", "w");
    if (f) {
      f.print(code);
      f.close();
    }

    cloudSocket.disconnect();
    cloudStarted   = false;
    cloudConnected = false;

    server.send(200, "application/json", "{\"ok\":true}");
  });
}

/**
 * Handle WebSocket loop & periodic state reporting
 */
void cloudLoop() {
  if (updating || WiFi.status() != WL_CONNECTED || !cloudConfigured) {
    return;
  }

  if (!cloudStarted) {
    // setExtraHeaders automatically appends CRLF
    cloudHeaders = "OAI-Sites-Authorization: Bearer " + cloudService + "\r\nX-Device-Key: " + cloudKey;

    Serial.printf("[Cloud] Connecting to wss://%s/api/device/ws ...\n", cloudHost.c_str());
    cloudSocket.beginSSL(cloudHost.c_str(), 443, "/api/device/ws");
    cloudSocket.setExtraHeaders(cloudHeaders.c_str());
    cloudSocket.onEvent(cloudEvent);
    cloudSocket.setReconnectInterval(5000);
    cloudSocket.enableHeartbeat(15000, 3000, 2);
    cloudStarted = true;
  }

  cloudSocket.loop();

  // Periodic heartbeat / state sync every 2000ms when connected
  if (cloudConnected && (cloudLastSync == 0 || millis() - cloudLastSync >= 2000)) {
    cloudLastSync = millis();

    JsonDocument msg, state;
    deserializeJson(state, stateJson());
    msg["type"]  = "sync";
    msg["ack"]   = cloudRevision;
    msg["state"] = state;

    String body;
    serializeJson(msg, body);
    cloudSocket.sendTXT(body);
  }
}
