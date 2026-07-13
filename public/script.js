/* ============================================================
   SMART SOIL SENSE — DASHBOARD LOGIC
   Vanilla JS. No frameworks, no dependencies.
   ============================================================ */

"use strict";

/* ------------------------------------------------------------
   CONFIG — change the endpoint here when the backend moves.
   ------------------------------------------------------------ */
// The dashboard is now served by the same Node server that hosts
// the API, so a relative path works — no host/port to keep in sync,
// no CORS, no mixed-content issues. If you ever split them again,
// swap this back to a full URL like "http://192.168.1.42:5500/api/latest/"
const API_ENDPOINT = "/api/latest/";
const HISTORY_ENDPOINT = "/api/history/";
const POLL_INTERVAL_MS = 5000;

/* Typical sensor ranges, used to size the visual range bars.
   Soil moisture arrives as a % (already converted on the ESP8266
   from its raw calibration). Rain is the raw analog reading from
   the CD4051 mux, shown as-is with no derived interpretation. */
const SENSOR_RANGES = {
  temperature: { min: 0, max: 50 },
  humidity: { min: 0, max: 100 },
  soil_moisture: { min: 0, max: 100 },
  ph: { min: 0, max: 14 },
  rain: { min: 0, max: 1023 },
};

/* ------------------------------------------------------------
   DOM REFERENCES
   ------------------------------------------------------------ */
const loadingOverlay = document.getElementById("loading-overlay");
const dashboard = document.getElementById("dashboard");
const offlineBanner = document.getElementById("offline-banner");

const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const lastUpdatedValue = document.getElementById("last-updated-value");
const endpointLabel = document.getElementById("endpoint-label");

const valueEls = {
  temperature: document.getElementById("value-temperature"),
  humidity: document.getElementById("value-humidity"),
  soil_moisture: document.getElementById("value-soil_moisture"),
  ph: document.getElementById("value-ph"),
  rain: document.getElementById("value-rain"),
};

const rangeEls = {
  temperature: document.getElementById("range-temperature"),
  humidity: document.getElementById("range-humidity"),
  soil_moisture: document.getElementById("range-soil_moisture"),
  ph: document.getElementById("range-ph"),
  rain: document.getElementById("range-rain"),
};

/* ------------------------------------------------------------
   HISTORY MODAL — DOM REFERENCES
   ------------------------------------------------------------ */
const historyBtn = document.getElementById("history-btn");
const historyModal = document.getElementById("history-modal");
const historyBackdrop = document.getElementById("history-backdrop");
const historyClose = document.getElementById("history-close");
const historyFiltersForm = document.getElementById("history-filters");
const filterStartInput = document.getElementById("filter-start");
const filterEndInput = document.getElementById("filter-end");
const filterResetBtn = document.getElementById("filter-reset");
const historyTableBody = document.getElementById("history-table-body");
const historyEmptyState = document.getElementById("history-empty");
const historyCountEl = document.getElementById("history-count");

/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */
let hasReceivedFirstResponse = false;
let lastKnownData = null;

/* ------------------------------------------------------------
   UI STATE FUNCTIONS
   ------------------------------------------------------------ */

/**
 * Shows the full-screen loading state. Used only before the very
 * first successful response has ever been received.
 */
function showLoading() {
  loadingOverlay.hidden = false;
  dashboard.hidden = true;
}

/**
 * Reveals the dashboard and hides the loading overlay. Also marks
 * the connection as healthy (green dot, banner hidden).
 */
function showDashboard() {
  loadingOverlay.hidden = true;
  dashboard.hidden = false;
  offlineBanner.hidden = true;

  statusDot.classList.remove("is-offline");
  statusLabel.textContent = "Connected";
}

/**
 * Reflects a failed fetch in the UI. Never clears sensor values —
 * the last successful readings stay on screen if we have any.
 * If we have never received data at all, keep showing the loader.
 */
function showOffline() {
  statusDot.classList.add("is-offline");
  statusLabel.textContent = "Offline";

  if (!hasReceivedFirstResponse) {
    // Never had a successful reading yet — stay on the loading screen.
    showLoading();
    return;
  }

  // We have prior data: keep the dashboard visible, just flag it.
  dashboard.hidden = false;
  loadingOverlay.hidden = true;
  offlineBanner.hidden = false;
}

/* ------------------------------------------------------------
   RENDERING HELPERS
   ------------------------------------------------------------ */

/**
 * Clamps a value into a 0-100 percentage for a given sensor's
 * typical range, used to size the range bar fill.
 */
function percentWithinRange(sensorKey, rawValue) {
  const range = SENSOR_RANGES[sensorKey];
  if (!range) return 0;

  const clamped = Math.min(Math.max(rawValue, range.min), range.max);
  const pct = ((clamped - range.min) / (range.max - range.min)) * 100;
  return pct;
}

/**
 * Formats the API's timestamp string for display. The server sends
 * this already in Asia/Dhaka local time (e.g. "2026-07-02 02:16:38"),
 * so we attach the Dhaka UTC+6 offset before parsing — this makes the
 * Date object represent the correct instant no matter what timezone
 * the *viewer's* browser happens to be in — then explicitly render it
 * back in Asia/Dhaka so it always reads correctly on screen too.
 * Falls back to the raw string if it can't be parsed, since we never
 * fabricate a value.
 */
function formatTimestamp(rawTimestamp, { withSuffix = true } = {}) {
  if (!rawTimestamp) return "\u2014";

  const parsed = new Date(rawTimestamp.replace(" ", "T") + "+06:00");
  if (isNaN(parsed.getTime())) {
    return rawTimestamp; // show as-is rather than guessing
  }

  const formatted = parsed.toLocaleString("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return withSuffix ? `${formatted}` : formatted;
}

/**
 * Applies a fresh sensor payload to every element on the page.
 * This is the single place that writes sensor data into the DOM,
 * so there is no duplicated rendering logic elsewhere.
 */
function updateDashboard(data) {
  // Temperature
  valueEls.temperature.textContent = data.temperature.toFixed(1);
  rangeEls.temperature.style.width =
    percentWithinRange("temperature", data.temperature) + "%";

  // Humidity
  valueEls.humidity.textContent = data.humidity.toFixed(1);
  rangeEls.humidity.style.width =
    percentWithinRange("humidity", data.humidity) + "%";

  // Soil moisture (already a % from the ESP8266)
  valueEls.soil_moisture.textContent = data.soil_moisture.toFixed(1);
  rangeEls.soil_moisture.style.width =
    percentWithinRange("soil_moisture", data.soil_moisture) + "%";

  // Soil pH
  valueEls.ph.textContent = data.ph.toFixed(1);
  rangeEls.ph.style.width = percentWithinRange("ph", data.ph) + "%";

  // Rain: raw analog reading from the CD4051 mux, shown exactly as
  // the device reports it — no derived wet/dry interpretation.
  valueEls.rain.textContent = data.rain;
  rangeEls.rain.style.width = percentWithinRange("rain", data.rain) + "%";

  // Timestamp
  lastUpdatedValue.textContent = formatTimestamp(data.updated);
}

/* ------------------------------------------------------------
   FETCH LOGIC
   ------------------------------------------------------------ */

/**
 * Fetches the latest reading from the backend. Handles both
 * network-level failures (offline, DNS, CORS) and non-2xx
 * responses. Never caches — every call hits the network fresh.
 */
async function fetchSensorData() {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();

    lastKnownData = data;
    hasReceivedFirstResponse = true;

    updateDashboard(data);
    showDashboard();
  } catch (error) {
    console.error("[SmartSoilSense] fetchSensorData failed:", error);
    showOffline();
  }
}

/* ------------------------------------------------------------
   HISTORY MODAL
   ------------------------------------------------------------ */

/**
 * Renders a single row of the history table as an HTML string.
 * Every value comes straight from the server response, so no
 * fabricated data ever appears here.
 */
function renderHistoryRow(reading) {
  return `
       <tr>
         <td>${formatTimestamp(reading.updated, { withSuffix: false })}</td>
         <td>${reading.temperature.toFixed(1)}</td>
         <td>${reading.humidity.toFixed(1)}</td>
         <td>${reading.soil_moisture.toFixed(1)}</td>
         <td>${reading.rain}</td>
         <td>${reading.ph.toFixed(1)}</td>
       </tr>
     `;
}

/**
 * Fetches history from the backend, optionally filtered by a
 * start/end date-time range, and renders it into the table.
 */
async function fetchAndRenderHistory() {
  historyEmptyState.hidden = false;
  historyEmptyState.textContent = "Loading history\u2026";
  historyTableBody.innerHTML = "";
  historyCountEl.textContent = "";

  const params = new URLSearchParams();
  if (filterStartInput.value) params.set("start", filterStartInput.value);
  if (filterEndInput.value) params.set("end", filterEndInput.value);

  try {
    const response = await fetch(`${HISTORY_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const readings = data.readings || [];

    if (readings.length === 0) {
      historyEmptyState.hidden = false;
      historyEmptyState.textContent = "No readings found for this range.";
      historyCountEl.textContent = "";
      return;
    }

    historyEmptyState.hidden = true;
    historyTableBody.innerHTML = readings.map(renderHistoryRow).join("");
    historyCountEl.textContent = `Showing ${readings.length} reading${readings.length === 1 ? "" : "s"}.`;
  } catch (error) {
    console.error("[SmartSoilSense] fetchAndRenderHistory failed:", error);
    historyEmptyState.hidden = false;
    historyEmptyState.textContent = "Could not load history — is the server running?";
    historyCountEl.textContent = "";
  }
}

function openHistoryModal() {
  historyModal.hidden = false;
  fetchAndRenderHistory();
}

function closeHistoryModal() {
  historyModal.hidden = true;
}

/* ------------------------------------------------------------
   BOOTSTRAP
   ------------------------------------------------------------ */

function init() {
  // endpointLabel.textContent = `Source: ${API_ENDPOINT}`;

  showLoading();

  // Fetch immediately on load, then poll on a fixed interval.
  fetchSensorData();
  setInterval(fetchSensorData, POLL_INTERVAL_MS);

  // --- History modal wiring ---
  historyBtn.addEventListener("click", openHistoryModal);
  historyClose.addEventListener("click", closeHistoryModal);
  historyBackdrop.addEventListener("click", closeHistoryModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !historyModal.hidden) {
      closeHistoryModal();
    }
  });

  historyFiltersForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetchAndRenderHistory();
  });

  filterResetBtn.addEventListener("click", () => {
    filterStartInput.value = "";
    filterEndInput.value = "";
    fetchAndRenderHistory();
  });
}

document.addEventListener("DOMContentLoaded", init);