#pragma once
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>
#include "relay_ca.h"

static const char CLOUD_HOST[]="f1-lamp-pit-control.rockybarge16.chatgpt.site";
WebSocketsClient cloudSocket;
BearSSL::X509List cloudCA(RELAY_CA);
String cloudService,cloudKey,cloudHeaders;
bool cloudConfigured=false,cloudStarted=false,cloudConnected=false;
uint32_t cloudLastSync=0;
uint64_t cloudRevision=0;

bool readCloudCode(const String& code) {
  if(code.length()>4096)return false;
  JsonDocument doc;
  if(deserializeJson(doc,code))return false;
  String host=doc["host"]|"",service=doc["service"]|"",key=doc["key"]|"";
  if(host!=CLOUD_HOST||service.length()<32||service.length()>2048||key.length()<40||key.length()>96)return false;
  if(service.indexOf('\r')>=0||service.indexOf('\n')>=0||key.indexOf('\r')>=0||key.indexOf('\n')>=0)return false;
  cloudService=service;cloudKey=key;cloudConfigured=true;return true;
}

void cloudEvent(WStype_t type,uint8_t* payload,size_t length) {
  if(type==WStype_CONNECTED){cloudConnected=true;cloudLastSync=0;Serial.println("Internet relay connected");return;}
  if(type==WStype_DISCONNECTED){cloudConnected=false;return;}
  if(type!=WStype_TEXT||length>2048)return;
  JsonDocument doc;if(deserializeJson(doc,payload,length))return;
  if(doc["type"]!="command"||!doc["revision"].is<uint64_t>())return;
  uint64_t rev=doc["revision"].as<uint64_t>();
  if(rev<=cloudRevision)return;
  if(doc["apply"]==true){
    JsonObject s=doc["state"];
    if(!s["power"].is<bool>()||!s["brightness"].is<int>()||!s["speed"].is<int>()||!s["effect"].is<const char*>()||!s["zones"].is<JsonArray>())return;
    int level=s["brightness"],speed=s["speed"];String mode=s["effect"].as<String>();JsonArray z=s["zones"];
    if(level<0||level>100||speed<25||speed>250||!validEffect(mode)||z.size()!=3)return;
    for(int i=0;i<3;i++)if(!z[i].is<bool>())return;
    bool restart=(s["replay"]==true)||mode!=effect||(!powerOn&&s["power"]==true);
    updatePhase();beginTransition();powerOn=s["power"];brightness=level;speedPercent=speed;effect=mode;
    for(int i=0;i<3;i++)zones[i]=z[i];
    if(restart)phaseSeconds=0;
  }
  cloudRevision=rev;cloudLastSync=0;
}

void cloudSetup() {
  if(LittleFS.begin()){
    File f=LittleFS.open("/cloud.json","r");
    if(f&&f.size()<=4096)readCloudCode(f.readString());
    f.close();
  }
  configTime(0,0,"time.cloudflare.com","pool.ntp.org","time.google.com");
  server.on("/api/cloud/status",HTTP_GET,[](){
    server.sendHeader("Cache-Control","no-store");
    server.send(200,"application/json",String("{\"configured\":")+(cloudConfigured?"true":"false")+",\"connected\":"+(cloudConnected?"true":"false")+"}");
  });
  server.on("/api/cloud/setup",HTTP_POST,[](){
    if(server.header("Origin")!="http://"+server.hostHeader()){server.send(403,"text/plain","Invalid origin");return;}
    String code=server.arg("code");
    if(!readCloudCode(code)){server.send(400,"text/plain","Invalid pairing code");return;}
    File f=LittleFS.open("/cloud.json","w");
    if(!f){server.send(500,"text/plain","Cannot save configuration");return;}
    size_t written=f.print(code);f.close();
    if(written!=code.length()){server.send(500,"text/plain","Cannot save configuration");return;}
    cloudSocket.disconnect();cloudStarted=false;cloudConnected=false;
    server.send(200,"application/json","{\"ok\":true}");
  });
}

void cloudLoop() {
  if(updating||WiFi.status()!=WL_CONNECTED||!cloudConfigured||time(nullptr)<1700000000)return;
  if(!cloudStarted){
    // setExtraHeaders adds its own CRLF. A trailing CRLF here prematurely
    // terminates HTTP headers, making User-Agent look like a WebSocket frame.
    cloudHeaders="OAI-Sites-Authorization: Bearer "+cloudService+"\r\nX-Device-Key: "+cloudKey;
    cloudSocket.beginSslWithCA(CLOUD_HOST,443,"/api/device/ws",&cloudCA,"arduino");
    cloudSocket.setExtraHeaders(cloudHeaders.c_str());cloudSocket.onEvent(cloudEvent);
    cloudSocket.setReconnectInterval(30000);cloudSocket.enableHeartbeat(15000,3000,2);cloudStarted=true;
  }
  cloudSocket.loop();
  if(cloudConnected&&(cloudLastSync==0||millis()-cloudLastSync>=700)){
    cloudLastSync=millis();
    JsonDocument msg,state;deserializeJson(state,stateJson());msg["type"]="sync";msg["ack"]=cloudRevision;msg["state"]=state;
    String body;serializeJson(msg,body);cloudSocket.sendTXT(body);
  }
}
