// ====================================================
// Smart Soil Sense — all-in-one local server
//
// Run this ONE file and it will:
//   1. Serve the dashboard (index.html, style.css, script.js)
//   2. Accept sensor readings from the ESP8266 (POST /api/latest/)
//   3. Serve the latest reading to the dashboard (GET /api/latest/)
//   4. Persist every reading to a local SQLite database
//   5. Serve filterable reading history (GET /api/history/)
//   6. Serve the current agricultural season's rainfall/temp/humidity
//      averages from NASA POWER (GET /api/climate/)
//   7. Automatically open your browser to the dashboard
//
// Usage:
//   node server.js
//
// No npm dependencies — only Node's built-in modules, including
// node:sqlite (built into Node since v22.5.0) and the global
// fetch() API (built into Node since v18). If you're on an
// older Node version, upgrade first: https://nodejs.org
// ====================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 5500;
const LATEST_PATH = "/api/latest/";
const HISTORY_PATH = "/api/history/";
const CLIMATE_PATH = "/api/climate/";
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "soil-sense.db");

// ----------------------------------------------------
// Database setup — auto-creates the data folder and the
// readings table on first run if they don't already exist.
// ----------------------------------------------------
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temperature REAL,
      humidity REAL,
      soil_moisture REAL,
      rain INTEGER,
      ph REAL,
      updated TEXT
    )
  `);

// avg_rainfall: the current agricultural season's NASA POWER average
// rainfall (mm/day) at the moment this reading was saved — NOT the
// device's own raw rain sensor value, which stays in the "rain"
// column untouched. Added via ALTER TABLE so existing databases from
// before this change still work; the try/catch just ignores the
// "duplicate column" error on servers where it's already been added.
try {
    db.exec(`ALTER TABLE readings ADD COLUMN avg_rainfall REAL`);
} catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
}

// Index on "updated" since every history query filters/sorts by it.
db.exec(`CREATE INDEX IF NOT EXISTS idx_readings_updated ON readings (updated)`);

const insertReadingStmt = db.prepare(`
    INSERT INTO readings (temperature, humidity, soil_moisture, rain, ph, updated, avg_rainfall)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

console.log(`Database ready at ${DB_PATH}`);

// ----------------------------------------------------
// Timestamp helper: formats "now" as Asia/Dhaka local time,
// e.g. "2026-07-02 02:16:38" — regardless of what timezone
// this server itself happens to be running in.
// ----------------------------------------------------
function getDhakaTimestamp() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).formatToParts(new Date());

    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// ----------------------------------------------------
// In-memory cache of the most recent reading, so GET /api/latest/
// doesn't need to hit the database on every dashboard poll.
// ----------------------------------------------------
let latestReading = null;

// ----------------------------------------------------
// Content-type map for the static files this project uses.
// ----------------------------------------------------
const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".svg": "image/svg+xml",
};

function applyCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 1e6) {
                req.destroy();
                reject(new Error("Request body too large"));
            }
        });
        req.on("end", () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

/**
 * Normalizes a date/time query param into the "YYYY-MM-DD HH:MM:SS"
 * format used in the "updated" column, so string comparison in SQL
 * works correctly. Accepts both the "T"-separated format that HTML
 * <input type="datetime-local"> produces and the space-separated
 * format already used internally.
 */
function normalizeDateParam(raw) {
    if (!raw) return null;
    let value = raw.trim().replace("T", " ");
    if (value.length === 16) value += ":00"; // "YYYY-MM-DD HH:MM" -> add seconds
    return value;
}

// ----------------------------------------------------
// API: POST /api/latest/  — called by the ESP8266
// ----------------------------------------------------
async function handleLatestPost(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
    }

    const { temperature, humidity, soil_moisture, rain, ph } = body;

    if (
        temperature === undefined ||
        humidity === undefined ||
        soil_moisture === undefined ||
        rain === undefined ||
        ph === undefined
    ) {
        sendJson(res, 400, {
            error: "Missing one or more sensor fields (temperature, humidity, soil_moisture, rain, ph).",
        });
        return;
    }

    latestReading = {
        temperature: Number(temperature),
        humidity: Number(humidity),
        soil_moisture: Number(soil_moisture), // already a % from the ESP8266
        rain: Number(rain), // raw analog reading from the CD4051 mux
        ph: Number(ph),
        updated: getDhakaTimestamp(),
    };

    insertReadingStmt.run(
        latestReading.temperature,
        latestReading.humidity,
        latestReading.soil_moisture,
        latestReading.rain,
        latestReading.ph,
        latestReading.updated,
        climateCache && climateCache.currentSeason
            ? Number(climateCache.currentSeason.avgRainfall)
            : null
    );

    console.log("Received reading:", latestReading);
    sendJson(res, 200, { status: "ok" });
}

// ----------------------------------------------------
// API: GET /api/latest/  — called by the dashboard
// ----------------------------------------------------
function handleLatestGet(req, res) {
    if (!latestReading) {
        sendJson(res, 503, { error: "No reading received yet." });
        return;
    }
    sendJson(res, 200, latestReading);
}

// ----------------------------------------------------
// API: GET /api/history/?start=...&end=...&limit=...
// Returns stored readings, optionally filtered by a date/time
// range, newest first. "start"/"end" accept either
// "YYYY-MM-DDTHH:MM" (from a datetime-local input) or
// "YYYY-MM-DD HH:MM:SS".
// ----------------------------------------------------
function handleHistoryGet(req, res, query) {
    const start = normalizeDateParam(query.get("start"));
    const end = normalizeDateParam(query.get("end"));
    const limitParam = parseInt(query.get("limit"), 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 5000) : 500;

    let sql = "SELECT id, temperature, humidity, soil_moisture, rain, avg_rainfall, ph, updated FROM readings";
    const clauses = [];
    const params = [];

    if (start) {
        clauses.push("updated >= ?");
        params.push(start);
    }
    if (end) {
        clauses.push("updated <= ?");
        params.push(end);
    }
    if (clauses.length) {
        sql += " WHERE " + clauses.join(" AND ");
    }
    sql += " ORDER BY updated DESC LIMIT ?";
    params.push(limit);

    try {
        const rows = db.prepare(sql).all(...params);
        sendJson(res, 200, { count: rows.length, readings: rows });
    } catch (err) {
        console.error("History query failed:", err);
        sendJson(res, 500, { error: "Failed to query history." });
    }
}

// ======================================================================
// CLIMATE / SEASON DATA (NEW) — NASA POWER rainfall/temperature/humidity
// for the field's location, aggregated into Bangladesh's 3 agricultural
// seasons (not calendar quarters), and resolved down to "whichever
// season it is right now" for the dashboard. Independent of the
// device's own "rain" sensor field: the ESP8266 keeps sending its raw
// CD4051 rain reading exactly as before, and it's still stored in the
// "readings" table untouched.
// ======================================================================

const CLIMATE_LAT = 22.5083; // Hathazari, Chattogram
const CLIMATE_LON = 91.8083;
const CLIMATE_LOCATION_NAME = "Hathazari, Chattogram";

// NASA POWER is a daily-granularity climate dataset, not a live feed —
// it doesn't need to be re-fetched on every dashboard poll. It's cached
// in memory and refreshed once a day.
const CLIMATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let climateCache = null; // { periods, currentSeason } once populated
let climateCacheFetchedAt = null; // Dhaka-local timestamp string of that fetch
let climateFetchInFlight = null; // dedupes overlapping fetches

/**
 * Maps a Date to one of Bangladesh's 3 agricultural seasons (BBS/DAE split):
 *   Rabi (winter):       Nov - Feb
 *   Kharif-I (summer):   Mar - Jun
 *   Kharif-II (monsoon): Jul - Oct
 * Rabi crosses a year boundary, so seasonYear = the year it STARTED in
 * (e.g. Jan 2026 is part of "Rabi 2025").
 */
function getSeasonInfo(date) {
    const month = date.getMonth(); // 0-11
    const year = date.getFullYear();

    if (month === 10 || month === 11) return { name: "Rabi", seasonYear: year };
    if (month === 0 || month === 1) return { name: "Rabi", seasonYear: year - 1 };
    if (month >= 2 && month <= 5) return { name: "Kharif-I", seasonYear: year };
    return { name: "Kharif-II", seasonYear: year }; // Jul-Oct
}

/**
 * Fetches one year of daily rainfall/temperature/humidity from NASA
 * POWER for CLIMATE_LAT/CLIMATE_LON, then aggregates it by Bangladesh
 * agricultural season (Rabi / Kharif-I / Kharif-II) instead of
 * calendar quarter.
 */
async function getClimateData() {
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const start = new Date(end);
    start.setMonth(start.getMonth() - 16);

    const format = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

    const url =
        `https://power.larc.nasa.gov/api/temporal/daily/point` +
        `?parameters=PRECTOTCORR,T2M,RH2M` +
        `&community=AG` +
        `&latitude=${CLIMATE_LAT}` +
        `&longitude=${CLIMATE_LON}` +
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

        const { name: seasonName, seasonYear } = getSeasonInfo(d);
        const key = `${seasonName} ${seasonYear}`;

        if (!groups[key]) {
            groups[key] = {
                rainfall: [],
                rainfallByDate: [],
                temperature: [],
                humidity: []
            };
        }

        groups[key].rainfall.push(rain);
        groups[key].rainfallByDate.push({ date, value: rain });
        groups[key].temperature.push(temp);
        groups[key].humidity.push(hum);
    }

    const result = Object.entries(groups).map(([period, values]) => {
        // Group each season's daily rainfall by calendar month, sum each
        // month's total, then average those monthly totals. This gives
        // "average monthly rainfall during the season" (e.g. ~500-600mm
        // for Chattogram's monsoon months) rather than a daily mean.
        const monthlyTotals = {};
        for (const { date, value } of values.rainfallByDate) {
            const monthKey = date.slice(0, 6); // "YYYYMM"
            monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + value;
        }
        const monthlySums = Object.values(monthlyTotals);
        const avgMonthlyRainfall =
            monthlySums.reduce((a, b) => a + b, 0) / monthlySums.length;

        return {
            period,
            avgRainfall: avgMonthlyRainfall.toFixed(2),
            avgTemperature: (
                values.temperature.reduce((a, b) => a + b, 0) /
                values.temperature.length
            ).toFixed(2),
            avgHumidity: (
                values.humidity.reduce((a, b) => a + b, 0) /
                values.humidity.length
            ).toFixed(2),
        };
    });

    return result;
}

/**
 * Uses the server's current date to figure out which season we're
 * in right now, then returns that season's averages from the
 * already-aggregated NASA data. This is what the dashboard shows.
 */
function resolveCurrentSeason(periods) {
    const { name, seasonYear } = getSeasonInfo(new Date());
    const key = `${name} ${seasonYear - 1}`;
    // console.log(key);
    return periods.find((p) => p.period === key) || null;
}

/**
 * Refreshes the in-memory climate cache. Safe to call repeatedly —
 * overlapping calls share the same in-flight promise instead of
 * firing duplicate requests at NASA POWER. Errors are logged but
 * never thrown up to callers that didn't ask for them (e.g. the
 * periodic timer); the old cached data (if any) is left in place
 * on failure rather than being wiped.
 */
async function refreshClimateCache() {
    if (climateFetchInFlight) return climateFetchInFlight;

    climateFetchInFlight = (async () => {
        try {
            const periods = await getClimateData();
            climateCache = {
                periods,
                currentSeason: resolveCurrentSeason(periods),
            };
            climateCacheFetchedAt = getDhakaTimestamp();
            // console.log(`Climate data refreshed (${periods.length} season period(s)) at ${climateCacheFetchedAt}`);
        } catch (err) {
            console.error("[SmartSoilSense] Climate data refresh failed:", err.message);
            // Keep serving the previous climateCache, if any — never clear it on a failed refresh.
        } finally {
            climateFetchInFlight = null;
        }
    })();

    return climateFetchInFlight;
}

// ----------------------------------------------------
// API: GET /api/climate/  — current season's NASA POWER averages
// ----------------------------------------------------
async function handleClimateGet(req, res) {
    if (!climateCache) {
        // First-ever request before the startup fetch has resolved:
        // wait for it once rather than returning empty.
        await refreshClimateCache();
    }

    if (!climateCache) {
        sendJson(res, 503, { error: "Climate data not yet available. Try again shortly." });
        return;
    }

    sendJson(res, 200, {
        source: "NASA POWER (power.larc.nasa.gov)",
        location: { lat: CLIMATE_LAT, lon: CLIMATE_LON, name: CLIMATE_LOCATION_NAME },
        fetchedAt: climateCacheFetchedAt,
        currentSeason: climateCache.currentSeason,
        periods: climateCache.periods,
    });
}

// ----------------------------------------------------
// Static file serving for everything under /public
// ----------------------------------------------------
function handleStatic(req, res, pathname) {
    const urlPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.join(PUBLIC_DIR, urlPath);

    // Prevent path traversal outside the public folder.
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("403 Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found: " + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
        res.end(data);
    });
}

// ----------------------------------------------------
// Main request router
// ----------------------------------------------------
const server = http.createServer(async (req, res) => {
    applyCorsHeaders(res);

    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (pathname === LATEST_PATH && req.method === "POST") {
        await handleLatestPost(req, res);
        return;
    }

    if (pathname === LATEST_PATH && req.method === "GET") {
        handleLatestGet(req, res);
        return;
    }

    if (pathname === HISTORY_PATH && req.method === "GET") {
        handleHistoryGet(req, res, requestUrl.searchParams);
        return;
    }

    if (pathname === CLIMATE_PATH && req.method === "GET") {
        await handleClimateGet(req, res);
        return;
    }

    // Anything else falls through to static file serving (dashboard).
    handleStatic(req, res, pathname);
});

// ----------------------------------------------------
// Auto-open the default browser once the server is ready.
// Fails silently on unsupported/headless environments —
// worst case, you just open the URL manually.
// ----------------------------------------------------
function openBrowser(url) {
    const platform = process.platform;
    const command =
        platform === "darwin" ? `open "${url}"` :
            platform === "win32" ? `start "" "${url}"` :
                `xdg-open "${url}"`;

    exec(command, (err) => {
        if (err) {
            console.log(`(Could not auto-open a browser — open ${url} manually.)`);
        }
    });
}

server.listen(PORT, "0.0.0.0", () => {
    const localUrl = `http://localhost:${PORT}`;
    console.log(`Smart Soil Sense running at ${localUrl}`);
    console.log("");

    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                console.log(`On your network:  http://${iface.address}:${PORT}  <-- use this on the ESP8266`);
            }
        }
    }
    console.log("");

    // Kick off the first climate-data fetch in the background — the
    // dashboard doesn't need to wait on it, and the periodic refresh
    // keeps it from ever going stale for more than a day.
    refreshClimateCache();
    setInterval(refreshClimateCache, CLIMATE_CACHE_TTL_MS);

    openBrowser(localUrl);
});