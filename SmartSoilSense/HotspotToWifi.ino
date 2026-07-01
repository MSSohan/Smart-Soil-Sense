#include <ESP8266WiFi.h>
#include <WiFiManager.h>

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFiManager wm;

  // Access Point IP
  IPAddress apIP(10, 10, 10, 10);
  IPAddress gateway(10, 10, 10, 10);
  IPAddress subnet(255, 255, 255, 0);

  wm.setAPStaticIPConfig(apIP, gateway, subnet);

  // Open hotspot (no password)
  bool res = wm.autoConnect("Smart Soil Sense");

  if (!res) {
    Serial.println("Failed to connect.");
    ESP.restart();
  }

  Serial.println("Connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
}