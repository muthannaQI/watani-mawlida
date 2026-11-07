/*
  وطني ومولدة — ESP32 firmware
  Reads two 220V AC presence modules (optocoupler, 0/1 only — no consumption metering):
    GPIO32  ← national grid  (الوطنية)
    GPIO33  ← generator line (المولدة)
  and reports to the wm-api backend on every change plus a heartbeat every 30 s.

  First boot: the device opens a WiFi network "Watani-Setup". Connect to it with a phone,
  pick the home WiFi, type its password and paste the device key from the admin page.
  Hold the BOOT button for 5 s to erase WiFi + key and start setup again.

  Libraries: WiFiManager by tzapu (Library Manager), ESP32 board package 2.x or 3.x.
  Board: "ESP32 Dev Module".
*/
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>

#define FW_VERSION "wm-1.0"
static const char* API_URL = "https://bxumslcuwunqkidutevk.supabase.co/functions/v1/wm-api?r=report";
static const char* AP_NAME = "Watani-Setup";

// ---- pins / hardware ----
const int  GRID_PIN   = 32;
const int  GEN_PIN    = 33;
const int  BOOT_PIN   = 0;      // on-board BOOT button
const int  LED_PIN    = 2;      // on-board blue LED (most DevKit boards)
const bool ACTIVE_LOW = true;   // typical modules pull OUT to GND while 220V is present

// ---- timing ----
const uint32_t WINDOW_MS    = 100;     // 5 mains cycles: AC optocouplers pulse at 50 Hz
const uint32_t STABLE_MS    = 2000;    // a new state must hold this long (ignores flicker)
const uint32_t HEARTBEAT_MS = 30000;
const uint32_t RETRY_MS     = 5000;
const uint32_t RECONNECT_MS = 30000;
const uint32_t RESET_HOLD_MS = 5000;

struct Line {
  int pin;
  bool state = false, known = false;   // accepted state
  bool cand = false;                   // candidate state while debouncing
  uint32_t candSince = 0, since = 0;   // when the candidate / accepted state began
  bool seenActive = false;             // any "present" sample in the current window
};

Line grid, gen;
Preferences prefs;
WiFiManager wm;
WiFiManagerParameter keyParam("devkey", "Device key / مفتاح الجهاز", "", 33);
String deviceKey;
bool dirty = false, lastOk = false, keyRejected = false;
uint32_t windowStart = 0, lastSend = 0, lastTry = 0, lastReconnect = 0, bootDown = 0;

static bool validKey(const String& k) {
  if (k.length() != 32) return false;
  for (char c : k) if (!isxdigit((unsigned char)c)) return false;
  return true;
}

void saveParams() {
  String k = String(keyParam.getValue());
  k.trim(); k.toLowerCase();
  if (validKey(k)) {
    deviceKey = k; keyRejected = false;
    prefs.putString("key", k);
    Serial.println("device key saved");
  } else {
    Serial.println("invalid device key (need 32 hex chars)");
  }
}

void sampleLine(Line& l, bool windowEnd, uint32_t now) {
  if (digitalRead(l.pin) == (ACTIVE_LOW ? LOW : HIGH)) l.seenActive = true;
  if (!windowEnd) return;
  bool raw = l.seenActive;
  l.seenActive = false;
  if (raw != l.cand) { l.cand = raw; l.candSince = now; }
  if ((!l.known || l.cand != l.state) && now - l.candSince >= STABLE_MS) {
    l.state = l.cand; l.since = l.candSince; l.known = true; dirty = true;
    Serial.printf("pin %d -> %s\n", l.pin, l.state ? "ON" : "OFF");
  }
}

bool sendReport() {
  if (WiFi.status() != WL_CONNECTED || !validKey(deviceKey) || !grid.known) return false;
  WiFiClientSecure client;
  client.setInsecure();                 // TLS without certificate pinning
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, API_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", deviceKey);
  uint32_t now = millis();
  String body = "{\"grid\":" + String(grid.state ? 1 : 0) +
                ",\"grid_for\":" + String((now - grid.since) / 1000);
  if (gen.known) body += ",\"gen\":" + String(gen.state ? 1 : 0) + ",\"gen_for\":" + String((now - gen.since) / 1000);
  body += ",\"fw\":\"" FW_VERSION "\",\"rssi\":" + String(WiFi.RSSI()) + "}";
  int code = http.POST(body);
  http.end();
  Serial.printf("report %s -> %d\n", body.c_str(), code);
  keyRejected = (code == 403);
  return code == 200;
}

void factoryReset() {
  Serial.println("reset WiFi + key");
  for (int i = 0; i < 10; i++) { digitalWrite(LED_PIN, i % 2); delay(80); }
  prefs.clear();
  wm.resetSettings();
  ESP.restart();
}

void updateLed(uint32_t now) {
  bool on;
  if (wm.getConfigPortalActive()) on = (now / 150) % 2;                   // fast blink: setup mode
  else if (WiFi.status() != WL_CONNECTED) on = (now / 1000) % 2;         // slow blink: no WiFi
  else if (!lastOk) on = (now % 2000) < 100;                             // short flash: server problem / bad key
  else on = true;                                                        // steady: all good
  digitalWrite(LED_PIN, on);
}

void setup() {
  Serial.begin(115200);
  pinMode(GRID_PIN, INPUT_PULLUP);
  pinMode(GEN_PIN, INPUT_PULLUP);
  pinMode(BOOT_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  grid.pin = GRID_PIN; gen.pin = GEN_PIN;

  prefs.begin("wm", false);
  deviceKey = prefs.getString("key", "");
  keyParam.setValue(deviceKey.c_str(), 33);

  WiFi.mode(WIFI_STA);
  wm.setTitle("Watani Mawlida");
  wm.addParameter(&keyParam);
  wm.setSaveParamsCallback(saveParams);
  wm.setConfigPortalBlocking(false);    // keep sensing while the setup page is open
  wm.setConnectTimeout(20);
  wm.setWiFiAutoReconnect(true);
  // With saved WiFi, give up the setup page after 3 min (e.g. router still booting after
  // an outage) and keep retrying the saved network instead.
  bool needSetup = !validKey(deviceKey) || !wm.getWiFiIsSaved();
  wm.setConfigPortalTimeout(needSetup ? 0 : 180);
  if (wm.autoConnect(AP_NAME)) {
    Serial.println("WiFi connected: " + WiFi.localIP().toString());
    if (!validKey(deviceKey)) wm.startConfigPortal(AP_NAME);
  }
  windowStart = millis();
}

void loop() {
  wm.process();
  uint32_t now = millis();

  bool windowEnd = now - windowStart >= WINDOW_MS;
  sampleLine(grid, windowEnd, now);
  sampleLine(gen, windowEnd, now);
  if (windowEnd) windowStart = now;

  // BOOT held 5 s → factory reset
  if (digitalRead(BOOT_PIN) == LOW) { if (!bootDown) bootDown = now; else if (now - bootDown >= RESET_HOLD_MS) factoryReset(); }
  else bootDown = 0;

  // saved WiFi but disconnected and no setup page → keep retrying
  if (!wm.getConfigPortalActive() && WiFi.status() != WL_CONNECTED && wm.getWiFiIsSaved() && now - lastReconnect >= RECONNECT_MS) {
    lastReconnect = now;
    WiFi.mode(WIFI_STA);
    WiFi.begin();
  }

  // report on change at once, otherwise heartbeat; retry failures every few seconds
  bool due = dirty || now - lastSend >= HEARTBEAT_MS;
  uint32_t wait = lastOk ? 0 : (keyRejected ? HEARTBEAT_MS : RETRY_MS);   // wrong key: back off
  if (due && grid.known && now - lastTry >= wait) {
    lastTry = now;
    lastOk = sendReport();
    if (lastOk) { lastSend = now; dirty = false; }
  }

  updateLed(now);
  delay(2);
}
