//====================================================
// SoilSense.ino
//====================================================

#include <ESP8266HTTPClient.h>
#include <DHT.h>

#define DHTPIN D4
#define DHTTYPE DHT22

#define SOIL_PIN A0
#define RAIN_PIN D5

const char* serverUrl = "http://YOUR_SERVER_IP/api/soil";

DHT dht(DHTPIN, DHTTYPE);

void initSensors()
{
    dht.begin();

    pinMode(RAIN_PIN, INPUT);

    Serial.println("Sensors Initialized");
}

void runSoilSense()
{
    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();

    int soilValue = analogRead(SOIL_PIN);
    int rainValue = digitalRead(RAIN_PIN);

    Serial.println();
    Serial.println("======================================");
    Serial.println("      SMART SOIL SENSE STATUS");
    Serial.println("======================================");

    // ---------- DHT22 ----------
    if (isnan(temperature) || isnan(humidity))
    {
        Serial.println("[DHT22] ❌ ERROR - Sensor not detected or failed to read.");
    }
    else
    {
        Serial.println("[DHT22] ✅ OK");
        Serial.print("Temperature : ");
        Serial.print(temperature);
        Serial.println(" °C");

        Serial.print("Humidity    : ");
        Serial.print(humidity);
        Serial.println(" %");
    }

    Serial.println();

    // ---------- Soil Moisture ----------
    if (soilValue < 0 || soilValue > 1025)
    {
        Serial.println("[SOIL] ❌ Invalid Reading");
    }
    else
    {
        Serial.println("[SOIL] ✅ OK");
        Serial.print("Soil Moisture : ");
        Serial.println(soilValue);
    }

    Serial.println();

    // ---------- Rain Sensor ----------
    if (rainValue == LOW)
    {
        Serial.println("[RAIN] ✅ Rain Detected");
    }
    else
    {
        Serial.println("[RAIN] ✅ No Rain");
    }

    Serial.print("Rain Value : ");
    Serial.println(rainValue);

    Serial.println("======================================");

    // Don't send data if DHT failed
    if (isnan(temperature) || isnan(humidity))
    {
        Serial.println("Skipping HTTP request because DHT22 failed.");
        return;
    }

    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println("WiFi Lost...");
        connectWiFi();
        return;
    }

    WiFiClient client;
    HTTPClient http;

    http.begin(client, serverUrl);
    http.addHeader("Content-Type", "application/json");

    String json = "{";
    json += "\"temperature\":" + String(temperature, 2) + ",";
    json += "\"humidity\":" + String(humidity, 2) + ",";
    json += "\"soil_moisture\":" + String(soilValue) + ",";
    json += "\"rain\":" + String(rainValue);
    json += "}";

    Serial.println("Sending JSON:");
    Serial.println(json);

    int httpCode = http.POST(json);

    Serial.print("HTTP Response : ");
    Serial.println(httpCode);

    http.end();
}