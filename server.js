// ====================================================
// Smart Soil Sense — all-in-one local server
//
// Run this ONE file and it will:
//   1. Serve the dashboard (index.html, style.css, script.js)
//   2. Accept sensor readings from the ESP8266 (POST /api/latest/)
//   3. Serve the latest reading to the dashboard (GET /api/latest/)
//   4. Persist every reading to a local SQLite database
//   5. Serve filterable reading history (GET /api/history/)
//   6. Automatically open your browser to the dashboard
//
// Usage:
//   node server.js
//
// No npm dependencies — only Node's built-in modules, including
// node:sqlite (built into Node since v22.5.0). If you're on an
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

// Index on "updated" since every history query filters/sorts by it.
db.exec(`CREATE INDEX IF NOT EXISTS idx_readings_updated ON readings (updated)`);

const insertReadingStmt = db.prepare(`
  INSERT INTO readings (temperature, humidity, soil_moisture, rain, ph, updated)
  VALUES (?, ?, ?, ?, ?, ?)
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
        latestReading.updated
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

    let sql = "SELECT id, temperature, humidity, soil_moisture, rain, ph, updated FROM readings";
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

    openBrowser(localUrl);
});