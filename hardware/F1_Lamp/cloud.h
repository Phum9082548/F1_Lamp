/**
 * ============================================================================
 * F1 Lamp — Cloud WebSocket Relay Client
 * ============================================================================
 * Enables secure remote control over the Internet without router port-forwarding.
 * - Connects via outbound TLS WebSocket (WSS on Port 443) to Cloudflare Worker.
 * - Stores device pairing credentials securely in LittleFS (/cloud.json).
 * - Validates server certificates using verified Root CA (relay_ca.h).
 * - Synchronizes state bidirectionally with automatic revision tracking.
 */

#pragma once

#include <Arduino.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>
#include "relay_ca.h"

// Cloud Relay host domain (Can be set via pairing code from Cloudflare Worker)
static const char DEFAULT_CLOUD_HOST[] = "f1-lamp-relay.f1-lamp-control.workers.dev";

// WebSocket and SSL client objects
WebSocketsClient cloudSocket;
BearSSL::X509List cloudCA(RELAY_CA);

// Runtime credentials and state
String cloudHost = DEFAULT_CLOUD_HOST;
String cloudService;
String cloudKey;
String cloudHeaders;

bool cloudConfigured = false;
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
 * Parse and validate pairing JSON string.
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

  // Sanity check parameters
  if (host.length() < 3 || service.length() < 32 || service.length() > 2048 ||
      key.length() < 40 || key.length() > 96) {
    return false;
  }

  // Guard against CRLF injection into HTTP headers
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
      Serial.println("[Cloud] Connected to Internet Relay via WSS");
      break;

    case WStype_DISCONNECTED:
      cloudConnected = false;
      Serial.println("[Cloud] Disconnected from Internet Relay");
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
 * Initialize Cloud credentials from LittleFS and configure WebServer pairing endpoints
 */
void cloudSetup(ESP8266WebServer& server) {
  // Load saved pairing credentials from LittleFS
  if (LittleFS.begin()) {
    File f = LittleFS.open("/cloud.json", "r");
    if (f && f.size() <= 4096) {
      if (readCloudCode(f.readString())) {
        Serial.println("[Cloud] Loaded pairing configuration from LittleFS");
      }
    }
    f.close();
  } else {
    Serial.println("[Cloud] LittleFS mount failed");
  }

  // Set system clock via NTP for TLS certificate validation
  configTime(0, 0, "time.cloudflare.com", "pool.ntp.org", "time.google.com");

  // REST API: GET /api/cloud/status
  server.on("/api/cloud/status", HTTP_GET, [&server]() {
    server.sendHeader("Cache-Control", "no-store");
    String res = "{\"configured\":";
    res += cloudConfigured ? "true" : "false";
    res += ",\"connected\":";
    res += cloudConnected ? "true" : "false";
    res += "}";
    server.send(200, "application/json", res);
  });

  // REST API: POST /api/cloud/setup (Pairing from local LAN)
  server.on("/api/cloud/setup", HTTP_POST, [&server]() {
    if (server.header("Origin") != "http://" + server.hostHeader()) {
      server.send(403, "text/plain", "Invalid origin");
      return;
    }

    String code = server.arg("code");
    if (!readCloudCode(code)) {
      server.send(400, "text/plain", "Invalid pairing code");
      return;
    }

    File f = LittleFS.open("/cloud.json", "w");
    if (!f) {
      server.send(500, "text/plain", "Cannot save configuration");
      return;
    }

    size_t written = f.print(code);
    f.close();

    if (written != code.length()) {
      server.send(500, "text/plain", "Cannot save configuration");
      return;
    }

    // Reset current socket and reconnect with new credentials
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
  // Do not run during OTA updates or until Wi-Fi is active and NTP time is valid (> Nov 2023)
  if (updating || WiFi.status() != WL_CONNECTED || !cloudConfigured || time(nullptr) < 1700000000) {
    return;
  }

  // Start connection if not yet running
  if (!cloudStarted) {
    // Note: setExtraHeaders automatically appends CRLF.
    // Do NOT add trailing CRLF to cloudHeaders string to avoid corrupting HTTP headers.
    cloudHeaders = "OAI-Sites-Authorization: Bearer " + cloudService + "\r\nX-Device-Key: " + cloudKey;

    cloudSocket.beginSslWithCA(cloudHost.c_str(), 443, "/api/device/ws", &cloudCA, "arduino");
    cloudSocket.setExtraHeaders(cloudHeaders.c_str());
    cloudSocket.onEvent(cloudEvent);
    cloudSocket.setReconnectInterval(30000);
    cloudSocket.enableHeartbeat(15000, 3000, 2);
    cloudStarted = true;
    Serial.println("[Cloud] Starting SSL WebSocket client connection...");
  }

  cloudSocket.loop();

  // Periodic heartbeat / state sync every 700ms when connected
  if (cloudConnected && (cloudLastSync == 0 || millis() - cloudLastSync >= 700)) {
    cloudLastSync = millis();

    JsonDocument msg, state;
    deserializeJson(state, stateJson());
    msg["type"]     = "sync";
    msg["ack"]      = cloudRevision;
    msg["state"]    = state;

    String body;
    serializeJson(msg, body);
    cloudSocket.sendTXT(body);
  }
}

