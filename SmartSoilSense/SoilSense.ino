//====================================================
// SoilSense.ino
//====================================================

#include <ESP8266HTTPClient.h>
#include <DHT.h>

#define DHTPIN D4
#define DHTTYPE DHT22

//------------- CD4051BE -----------------
#define MUX_S0 D5
#define MUX_S1 D6
#define MUX_S2 D7

#define MUX_SIGNAL A0

#define SOIL_CHANNEL 0
#define RAIN_CHANNEL 1
#define PH_CHANNEL   2
//--------------------------------------

// Soil calibration
#define SOIL_DRY 1024
#define SOIL_WET 400

const char* serverUrl = "http://192.168.0.105:5500 /api/latest/";

DHT dht(DHTPIN, DHTTYPE);

void selectMuxChannel(byte channel)
{
    digitalWrite(MUX_S0, channel & 1);
    digitalWrite(MUX_S1, (channel >> 1) & 1);
    digitalWrite(MUX_S2, (channel >> 2) & 1);

    delay(5);
}

int readMux(byte channel)
{
    selectMuxChannel(channel);
    return analogRead(MUX_SIGNAL);
}

void initSensors()
{
    dht.begin();

    pinMode(MUX_S0, OUTPUT);
    pinMode(MUX_S1, OUTPUT);
    pinMode(MUX_S2, OUTPUT);

    Serial.println("Sensors Initialized");
}

void runSoilSense()
{
    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();

    //---------- Soil Moisture ----------
    int soilRaw = readMux(SOIL_CHANNEL);

    Serial.print("Soil Raw: ");
    Serial.println(soilRaw);

    int soilValue = map(soilRaw, SOIL_DRY, SOIL_WET, 0, 100);
    soilValue = constrain(soilValue, 0, 100);

    //---------- Rain Sensor ----------
    int rainValue = readMux(RAIN_CHANNEL);

    //---------- pH Sensor ----------
    int phRaw = readMux(PH_CHANNEL);

    float voltage = phRaw * (3.3 / 1023.0);

    // Placeholder calibration
    float phValue = 7.0 + ((2.50 - voltage) / 0.18);

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
    if (soilRaw < 0 || soilRaw > 1025)
    {
        Serial.println("[SOIL] ❌ Invalid Reading");
    }
    else
    {
        Serial.println("[SOIL] ✅ OK");

        Serial.print("Soil Moisture : ");
        Serial.print(soilValue);
        Serial.println(" %");
    }

    Serial.println();

    // ---------- Rain Sensor ----------
    Serial.println("[RAIN] ✅ OK");

    Serial.print("Rain Value : ");
    Serial.println(rainValue);

    Serial.println();

    // ---------- pH Sensor ----------
    Serial.println("[PH] ✅ OK");

    Serial.print("pH Value : ");
    Serial.println(phValue, 2);

    Serial.println("======================================");

    // Don't send data if DHT failed
//    if (isnan(temperature) || isnan(humidity))
//    {
//        Serial.println("Skipping HTTP request because DHT22 failed.");
//        return;
//    }

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
    json += "\"rain\":" + String(rainValue) + ",";
    json += "\"ph\":" + String(phValue, 2);
    json += "}";

    Serial.println("Sending JSON:");
    Serial.println(json);

    int httpCode = http.POST(json);

    Serial.print("HTTP Response : ");
    Serial.println(httpCode);

    http.end();
}
