//====================================================
// simulate-esp.js
// Simulates the SoilSense ESP8266 device by generating
// test sensor readings and POSTing them to the server,
// mirroring runSoilSense() in SoilSense.ino
//====================================================

const SERVER_URL = "http://192.168.0.102:5500/api/latest/";
const INTERVAL_MS = 5000; // how often the "device" sends data

// Fetches historical average daily rainfall once at startup (real-world reference,
// separate from the simulated `rain` ADC value sent in each payload).

const LAT = 22.5083;    // Hathazari, Chattogram
const LON = 91.8083;

async function getClimateData() {
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    const format = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

    const url =
        `https://power.larc.nasa.gov/api/temporal/daily/point` +
        `?parameters=PRECTOTCORR,T2M,RH2M` +
        `&community=AG` +
        `&latitude=${LAT}` +
        `&longitude=${LON}` +
        `&start=${format(start)}` +
        `&end=${format(end)}` +
        `&format=JSON`;

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    const rainfall = data.properties.parameter.PRECTOTCORR;
    const temperature = data.properties.parameter.T2M;
    const humidity = data.properties.parameter.RH2M;

    const groups = {};

    for (const date of Object.keys(rainfall)) {
        const rain = rainfall[date];
        const temp = temperature[date];
        const hum = humidity[date];

        if (rain === -999 || temp === -999 || hum === -999) continue;

        const d = new Date(
            Number(date.slice(0, 4)),
            Number(date.slice(4, 6)) - 1,
            Number(date.slice(6, 8))
        );

        const monthNames = [
            "Jan", "Feb", "Mar",
            "Apr", "May", "Jun",
            "Jul", "Aug", "Sep",
            "Oct", "Nov", "Dec"
        ];

        const quarter = Math.floor(d.getMonth() / 3);

        const startMonth = quarter * 3;
        const endMonth = startMonth + 2;

        const key = `${monthNames[startMonth]}-${monthNames[endMonth]} ${d.getFullYear()}`;

        if (!groups[key]) {
            groups[key] = {
                rainfall: [],
                temperature: [],
                humidity: []
            };
        }

        groups[key].rainfall.push(rain);
        groups[key].temperature.push(temp);
        groups[key].humidity.push(hum);
    }

    const result = Object.entries(groups).map(([period, values]) => ({
        period,
        avgRainfall: (
            values.rainfall.reduce((a, b) => a + b, 0) /
            values.rainfall.length
        ).toFixed(2),
        avgTemperature: (
            values.temperature.reduce((a, b) => a + b, 0) /
            values.temperature.length
        ).toFixed(2),
        avgHumidity: (
            values.humidity.reduce((a, b) => a + b, 0) /
            values.humidity.length
        ).toFixed(2),
    }));

    return result;
}

getClimateData()
    .then(result => console.table(result))
    .catch(console.error);

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

async function sendReading() {
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

    // send one immediately, then on interval
    sendReading();
    setInterval(() => sendReading(), INTERVAL_MS);
}

main();