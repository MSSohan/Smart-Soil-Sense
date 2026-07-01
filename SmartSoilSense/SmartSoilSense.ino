//====================================================
// SmartSoilSense.ino
// Main File
//====================================================

void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println();
    Serial.println("==================================");
    Serial.println("      SMART SOIL SENSE");
    Serial.println("==================================");

    // Connect to WiFi or start hotspot
    connectWiFi();

    // Initialize all sensors
    initSensors();

    Serial.println("System Ready");
}

void loop()
{
    // Read sensors and send data
    runSoilSense();

    delay(5000);
}