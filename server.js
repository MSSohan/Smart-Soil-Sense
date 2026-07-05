// ====================================================
// Smart Soil Sense — all-in-one local server
//
// Run this ONE file and it will:
//   1. Serve the dashboard (index.html, style.css, script.js)
//   2. Accept sensor readings from the ESP8266 (POST /api/latest/)
//   3. Serve the latest reading to the dashboard (GET /api/latest/)
//   4. Automatically open your browser to the dashboard
//
// Usage:
//   node server.js
//
// No dependencies — only Node's built-in modules.
// ====================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const PORT = process.env.PORT || 5500;
const ENDPOINT_PATH = "/api/latest/";
const PUBLIC_DIR = path.join(__dirname, "public");

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
// In-memory store for the most recent sensor reading.
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

// ----------------------------------------------------
// CORS headers — harmless to keep even on same-origin requests,
// and useful if you later open the dashboard from elsewhere
// (e.g. your phone hitting this computer's LAN IP directly).
// ----------------------------------------------------
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

// ----------------------------------------------------
// API: POST /api/latest/  — called by the ESP8266
// ----------------------------------------------------
async function handleApiPost(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
    }

    const { temperature, humidity, soil_moisture, rain } = body;

    if (
        temperature === undefined ||
        humidity === undefined ||
        soil_moisture === undefined ||
        rain === undefined
    ) {
        sendJson(res, 400, { error: "Missing one or more sensor fields." });
        return;
    }

    latestReading = {
        temperature: Number(temperature),
        humidity: Number(humidity),
        soil_moisture: Number(soil_moisture),
        rain: Number(rain),
        updated: getDhakaTimestamp(),
    };

    console.log("Received reading:", latestReading);
    sendJson(res, 200, { status: "ok" });
}

// ----------------------------------------------------
// API: GET /api/latest/  — called by the dashboard
// ----------------------------------------------------
function handleApiGet(req, res) {
    if (!latestReading) {
        sendJson(res, 503, { error: "No reading received yet." });
        return;
    }
    sendJson(res, 200, latestReading);
}

// ----------------------------------------------------
// Static file serving for everything under /public
// ----------------------------------------------------
function handleStatic(req, res) {
    let urlPath = req.url === "/" ? "/index.html" : req.url;
    urlPath = urlPath.split("?")[0];

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

    const path_ = req.url.split("?")[0];

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (path_ === ENDPOINT_PATH && req.method === "POST") {
        await handleApiPost(req, res);
        return;
    }

    if (path_ === ENDPOINT_PATH && req.method === "GET") {
        handleApiGet(req, res);
        return;
    }

    // Anything else falls through to static file serving (dashboard).
    handleStatic(req, res);
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