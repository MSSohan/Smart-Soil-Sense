<div align="center">

# 🌱 Smart Soil Sense

### Read the soil. Know the season. Get the right crop.

An IoT and machine-learning system that measures soil and weather in the field, streams it to a live dashboard every 5 seconds, and **recommends the best crop to grow**, using live sensor data plus NASA climate data for Bangladesh's farming seasons.

[![Dashboard UI](https://img.shields.io/badge/▶_Dashboard_UI-GitHub_Pages-2EA44F?style=for-the-badge)](https://mssohan.github.io/Smart-Soil-Sense/)
[![Hardware](https://img.shields.io/badge/hardware-ESP8266-E7352C?style=for-the-badge&logo=espressif&logoColor=white)](#-hardware)
[![ML](https://img.shields.io/badge/ML-crop_prediction-FF6B00?style=for-the-badge)](#-how-it-works)

![ESP8266](https://img.shields.io/badge/ESP8266-E7352C?style=flat-square&logo=espressif&logoColor=white)
![Arduino](https://img.shields.io/badge/Arduino-00878F?style=flat-square&logo=arduino&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?style=flat-square&logo=flask&logoColor=white)
![NASA POWER](https://img.shields.io/badge/NASA_POWER-climate_data-0B3D91?style=flat-square&logo=nasa&logoColor=white)

</div>

---

## ⚡ The problem → the fix

> Farmers often choose crops by habit, not by what the soil and season actually support. The result is lower yields and wasted inputs.

**Smart Soil Sense** puts sensors in the soil, adds this season's climate averages from NASA, and lets a trained model answer one question: **what should I plant here, now?**

```mermaid
flowchart LR
    A["🌱 Sensors in the field"] --> B["📡 ESP8266 sends every 5s"]
    B --> C["🗄️ Saved to SQLite"]
    C --> D["🛰️ + NASA season climate"]
    D --> E["🤖 ML model"]
    E --> F["🌾 Recommended crop"]
    style A fill:#EAF7EC,stroke:#2EA44F
    style F fill:#2EA44F,color:#fff,stroke:#2EA44F
```

---

## ✨ Features

| | Feature | What it does |
|:-:|---|---|
| 📊 | **Live field dashboard** | Temperature, humidity, soil moisture, soil pH and rain, refreshed every 5 seconds |
| 🌾 | **Crop recommendation** | ML model predicts the best crop from soil, weather and seasonal rainfall |
| 🛰️ | **NASA climate data** | Pulls rainfall, temperature and humidity averages from NASA POWER |
| 🗓️ | **Bangladesh farming seasons** | Data grouped into **Rabi, Kharif-I and Kharif-II**, not calendar months |
| 🕒 | **Reading history** | Every reading stored and filterable by date and time range |
| 🟢 | **Connection status** | Live Connected / Offline indicator with an offline banner |
| 📶 | **Easy Wi-Fi setup** | Device opens its own "Smart Soil Sense" hotspot to connect to any Wi-Fi, no re-flashing |
| 🚀 | **One-command start** | `node server.js` serves the dashboard, starts the ML server, opens the browser |

---

## 🔌 Hardware

| Part | Measures |
|---|---|
| **ESP8266** | Wi-Fi microcontroller that reads the sensors and posts data |
| **DHT22** | 🌡️ Air temperature and 💧 humidity |
| **Soil moisture sensor** | 🌱 Soil moisture (calibrated to %) |
| **pH sensor** | ⚗️ Soil pH |
| **Rain sensor** | 🌧️ Rain detection |
| **CD4051 multiplexer** | Lets three analog sensors share the ESP8266's single analog pin |

---

## 🏗️ How it works

```mermaid
flowchart TB
    subgraph Field["🌾 In the field"]
        S["DHT22 · Soil moisture · pH · Rain"] --> E["ESP8266"]
    end
    E -->|"HTTP POST every 5s"| N["Node.js server"]
    N --> DB[("SQLite")]
    NASA["🛰️ NASA POWER API"] -->|"season averages"| N
    N -->|"sensor + rainfall"| ML["🐍 Flask ML server"]
    ML -->|"predicted crop"| N
    N --> D["📊 Live dashboard"]
```

---

## 👨‍💻 My role

- **Hardware & firmware:** wired the sensors through a multiplexer and wrote the ESP8266 firmware, including hotspot-based Wi-Fi setup
- **Backend:** built a zero-dependency Node.js server with SQLite storage, history API and NASA POWER integration
- **Machine learning:** trained the crop-prediction model and served it through a Flask API
- **Dashboard:** designed the live field dashboard with history filters and offline handling

---

<div align="center">

**More of my work: [MSSohan](https://github.com/MSSohan)**

</div>
