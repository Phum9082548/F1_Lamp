#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ArduinoOTA.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"
#include "web_assets.h"
#include "effects.h"

Adafruit_NeoPixel a(4, 5, NEO_GRB + NEO_KHZ800);  // D1
Adafruit_NeoPixel b(6, 4, NEO_GRB + NEO_KHZ800);  // D2
Adafruit_NeoPixel c(9, 14, NEO_GRB + NEO_KHZ800); // D5
Adafruit_NeoPixel* strips[] = {&a, &b, &c};
ESP8266WebServer server(80);
bool powerOn=true, zones[]={true,true,true}, otaReady=false, updating=false;
uint8_t brightness=40;
uint16_t speedPercent=100;
uint32_t lastFrame=0, lastPhaseTick=0, fadeStart=0;
float phaseSeconds=0, displayed[3][9]={}, fadeFrom[3][9]={};
String effect="rev";

void updatePhase() {
  uint32_t now=millis();phaseSeconds+=(now-lastPhaseTick)/1000.0f*speedPercent/100.0f;lastPhaseTick=now;
}

void beginTransition() {
  for(int s=0;s<3;s++)for(int j=0;j<9;j++)fadeFrom[s][j]=displayed[s][j];
  fadeStart=millis();
}

void clearAll() {
  for(auto p:strips) { p->clear(); p->show(); }
}

String stateJson() {
  updatePhase();
  String json; json.reserve(260);
  json="{\"device\":\"F1-Lamp\",\"apiVersion\":3,\"power\":";
  json+=powerOn?"true":"false";
  json+=",\"color\":\"#ff0000\",\"brightness\":"; json+=brightness;
  json+=",\"speed\":"; json+=speedPercent;
  json+=",\"effect\":\""; json+=effect;
  json+="\",\"zones\":[";
  for(int i=0;i<3;i++) { if(i)json+=',';json+=zones[i]?"true":"false"; }
  json+="],\"phase\":"; json+=String(phaseSeconds,4); json+='}';
  return json;
}

void sendState(){server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",stateJson());}

bool isNumber(const String& s, unsigned minValue, unsigned maxValue) {
  if(!s.length()||s.length()>4)return false;
  for(unsigned i=0;i<s.length();i++)if(!isDigit(s[i]))return false;
  long n=s.toInt();return n>=long(minValue)&&n<=long(maxValue);
}

void setState() {
  // Only accept control requests originating from this device's web page.
  String origin=server.header("Origin");
  if(origin!="http://"+server.hostHeader()) {
    server.send(403,"application/json","{\"error\":\"Open the page from this device IP\"}");return;
  }
  const char* required[]={"power","brightness","speed","effect","zones","replay"};
  for(auto key:required)if(!server.hasArg(key)) {server.send(400,"application/json","{\"error\":\"Missing field\"}");return;}
  String p=server.arg("power"),z=server.arg("zones"),e=server.arg("effect"),r=server.arg("replay");
  bool ok=(p=="0"||p=="1")&&(r=="0"||r=="1")&&z.length()==3;
  for(unsigned i=0;i<z.length();i++)ok=ok&&(z[i]=='0'||z[i]=='1');
  ok=ok&&isNumber(server.arg("brightness"),0,100)&&isNumber(server.arg("speed"),25,250);
  ok=ok&&validEffect(e);
  if(!ok) {server.send(400,"application/json","{\"error\":\"Invalid setting\"}");return;}
  bool restart=r=="1"||e!=effect||(!powerOn&&p=="1");
  updatePhase();beginTransition();
  powerOn=p=="1";
  brightness=server.arg("brightness").toInt();speedPercent=server.arg("speed").toInt();effect=e;
  for(int i=0;i<3;i++)zones[i]=z[i]=='1';
  if(restart)phaseSeconds=0;
  sendState();
}

void renderLights() {
  if(updating||millis()-lastFrame<12)return;
  lastFrame=millis();
  updatePhase();float blend=smooth((millis()-fadeStart)/700.0f);
  for(int s=0;s<3;s++) {
    for(int j=0;j<strips[s]->numPixels();j++) {
      float target=powerOn&&zones[s]?effectLevel(effect,phaseSeconds,s,j,strips[s]->numPixels())*brightness/100.0f:0;
      float v=fadeFrom[s][j]+(target-fadeFrom[s][j])*blend;
      displayed[s][j]=v;
      strips[s]->setPixelColor(j,uint8_t(constrain(v,0.0f,1.0f)*255+.5f),0,0);
    }
    strips[s]->show();
  }
}

#include "cloud.h"

void setup() {
  Serial.begin(115200);
  for(auto p:strips)p->begin();
  clearAll();lastPhaseTick=fadeStart=millis();
  WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.hostname("F1-Lamp");
  WiFi.setAutoReconnect(true);WiFi.begin(WIFI_SSID,WIFI_PASS);
  ArduinoOTA.setHostname("F1-Lamp");ArduinoOTA.setPassword(OTA_PASS);
  ArduinoOTA.onStart([](){updating=true;clearAll();});
  ArduinoOTA.onError([](ota_error_t e){updating=false;memset(displayed,0,sizeof(displayed));beginTransition();Serial.printf("OTA error: %u\n",e);});
  server.collectHeaders("Origin");
  server.on("/api/state",HTTP_GET,sendState);
  server.on("/api/state",HTTP_POST,setState);
  cloudSetup();
  registerWebAssets(server);
  server.onNotFound([](){server.send(404,"text/plain","Not found");});
  server.begin();
}

void loop() {
  if(WiFi.status()==WL_CONNECTED) {
    if(!otaReady){ArduinoOTA.begin();otaReady=true;Serial.print("Open http://");Serial.println(WiFi.localIP());}
    ArduinoOTA.handle();server.handleClient();cloudLoop();
  }
  renderLights();delay(1);
}
