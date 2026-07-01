//====================================================
// HotspotToWifi.ino
//====================================================

#include <ESP8266WiFi.h>
#include <WiFiManager.h>

void connectWiFi()
{
    WiFiManager wm;

    // Hotspot IP
    IPAddress apIP(10, 10, 10, 10);
    IPAddress gateway(10, 10, 10, 10);
    IPAddress subnet(255, 255, 255, 0);

    wm.setAPStaticIPConfig(apIP, gateway, subnet);

    Serial.println();
    Serial.println("Checking saved WiFi...");

    // Try saved WiFi first.
    // If it fails, automatically starts hotspot.
    bool connected = wm.autoConnect("Smart Soil Sense");

    if (!connected)
    {
        Serial.println("Failed to connect.");
        delay(3000);
        ESP.restart();
    }

    Serial.println("--------------------------------");
    Serial.println("WiFi Connected");
    Serial.print("SSID : ");
    Serial.println(WiFi.SSID());

    Serial.print("IP : ");
    Serial.println(WiFi.localIP());

    Serial.println("--------------------------------");
}