//====================================================
// simulate-esp.js
// Simulates the SoilSense ESP8266 device by generating
// test sensor readings and POSTing them to the server,
// mirroring runSoilSense() in SoilSense.ino
//====================================================

const SERVER_URL = "http://192.168.1.103:5500/api/latest/";
const INTERVAL_MS = 5000; // how often the "device" sends data

const RAINFALL_LAT = 22.5083; // Hathazari, Chattogram
const RAINFALL_LON = 91.8083;
const RAINFALL_START = "2025-01-01";
const RAINFALL_END = "2025-12-31";

// Fetches historical average daily rainfall once at startup (real-world reference,
// separate from the simulated `rain` ADC value sent in each payload).
async function getAverageRainfall() {
    try {
        const url =
            `https://archive-api.open-meteo.com/v1/archive?latitude=${RAINFALL_LAT}` +
            `&longitude=${RAINFALL_LON}&start_date=${RAINFALL_START}&end_date=${RAINFALL_END}` +
            `&daily=precipitation_sum&timezone=auto`;

        const res = await fetch(url);
        const data = await res.json();
        const values = data.daily.precipitation_sum.filter((v) => v !== null);
        const avgRainfall = values.reduce((a, b) => a + b, 0) / values.length;

        console.log("Average daily rainfall (mm):", avgRainfall.toFixed(2));
        return avgRainfall;
    } catch (err) {
        console.log("⚠️  Could not fetch average rainfall:", err.message);
        return null;
    }
}


// ---- Soil calibration (matches firmware) ----
const SOIL_DRY = 1024;
const SOIL_WET = 400;

function randFloat(min, max, decimals = 2) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function mapRange(x, inMin, inMax, outMin, outMax) {
    return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

function constrain(x, min, max) {
    return Math.min(Math.max(x, min), max);
}

function readTestSensors() {
    // ---- DHT22 ----
    const temperature = randFloat(18, 34);       // °C
    const humidity = randFloat(30, 90);          // %

    // ---- Soil moisture (simulate raw ADC 400-1024) ----
    const soilRaw = randInt(SOIL_WET, SOIL_DRY);
    let soilValue = mapRange(soilRaw, SOIL_DRY, SOIL_WET, 0, 100);
    soilValue = Math.round(constrain(soilValue, 0, 100));

    // ---- Rain sensor (raw ADC 0-1023, lower = wetter, like most rain modules) ----
    const rainValue = randInt(0, 1023);

    // ---- pH sensor (simulate raw ADC, then apply same formula as firmware) ----
    const phRaw = randInt(400, 900);
    const voltage = phRaw * (3.3 / 1023.0);
    const phValue = parseFloat((7.0 + (1.68 - voltage) / 0.18).toFixed(2));

    return { temperature, humidity, soilValue, rainValue, phValue };
}

async function sendReading(avgRainfall) {
    const { temperature, humidity, soilValue, rainValue, phValue } = readTestSensors();

    const payload = {
        temperature,
        humidity,
        soil_moisture: soilValue,
        rain: rainValue,
        ph: phValue,
    };

    console.log("======================================");
    console.log("   SIMULATED SOIL SENSE (Test Mode)");
    console.log("======================================");
    console.log("Sending JSON:", JSON.stringify(payload));
    if (avgRainfall !== null) {
        console.log("Reference avg daily rainfall (mm):", avgRainfall.toFixed(2));
    }

    try {
        const res = await fetch(SERVER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        console.log("HTTP Response:", res.status);
        const text = await res.text().catch(() => "");
        if (text) console.log("Response body:", text);
    } catch (err) {
        console.log("❌ Request failed:", err.message);
    }

    console.log("======================================\n");
}

async function main() {
    console.log(`Starting Test ESP simulator -> POST ${SERVER_URL} every ${INTERVAL_MS / 1000}s`);
    console.log("Press Ctrl+C to stop.\n");

    const avgRainfall = await getAverageRainfall();

    // send one immediately, then on interval
    sendReading(avgRainfall);
    setInterval(() => sendReading(avgRainfall), INTERVAL_MS);
}

main();