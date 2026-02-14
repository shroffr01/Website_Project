// ========================================
// SkyLens Weather App
// Uses Open-Meteo API (free, no key required)
// ========================================

const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const NWS_ALERTS_API = "https://api.weather.gov/alerts/active";
const GNEWS_API = "https://gnews.io/api/v4/search";

// WMO Weather Code → description and icon mapping
const WEATHER_CODES = {
  0:  { description: "Clear Sky",           icon: "☀️" },
  1:  { description: "Mainly Clear",        icon: "🌤️" },
  2:  { description: "Partly Cloudy",       icon: "⛅" },
  3:  { description: "Overcast",            icon: "☁️" },
  45: { description: "Foggy",               icon: "🌫️" },
  48: { description: "Depositing Rime Fog", icon: "🌫️" },
  51: { description: "Light Drizzle",       icon: "🌦️" },
  53: { description: "Moderate Drizzle",    icon: "🌦️" },
  55: { description: "Dense Drizzle",       icon: "🌧️" },
  56: { description: "Light Freezing Drizzle", icon: "🌧️" },
  57: { description: "Dense Freezing Drizzle",  icon: "🌧️" },
  61: { description: "Slight Rain",         icon: "🌧️" },
  63: { description: "Moderate Rain",       icon: "🌧️" },
  65: { description: "Heavy Rain",          icon: "🌧️" },
  66: { description: "Light Freezing Rain", icon: "🌧️" },
  67: { description: "Heavy Freezing Rain", icon: "🌧️" },
  71: { description: "Slight Snowfall",     icon: "🌨️" },
  73: { description: "Moderate Snowfall",   icon: "🌨️" },
  75: { description: "Heavy Snowfall",      icon: "❄️" },
  77: { description: "Snow Grains",         icon: "❄️" },
  80: { description: "Slight Rain Showers", icon: "🌦️" },
  81: { description: "Moderate Rain Showers", icon: "🌧️" },
  82: { description: "Violent Rain Showers",  icon: "⛈️" },
  85: { description: "Slight Snow Showers", icon: "🌨️" },
  86: { description: "Heavy Snow Showers",  icon: "🌨️" },
  95: { description: "Thunderstorm",        icon: "⛈️" },
  96: { description: "Thunderstorm with Slight Hail", icon: "⛈️" },
  99: { description: "Thunderstorm with Heavy Hail",  icon: "⛈️" },
};

// DOM Elements
const searchForm = document.getElementById("search-form");
const locationInput = document.getElementById("location-input");
const suggestionsEl = document.getElementById("suggestions");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const loadingSection = document.getElementById("loading-section");
const weatherSection = document.getElementById("weather-section");

let debounceTimer = null;
let activeSuggestionIndex = -1;
let currentSuggestions = [];
let currentWeatherData = null;
let currentTimezone = null;

// Radar state
let radarMap = null;
let radarLayers = [];
let radarFrames = [];
let currentRadarFrame = 0;
let radarPlaying = false;
let radarInterval = null;
let currentLat = null;
let currentLon = null;
let radarInitialized = false;

// Alerts state
let currentAlerts = [];

// ---- Tab Navigation ----

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Update button states
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  // Update content visibility
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.id === `tab-${tabName}`);
  });

  // Initialize radar map when radar tab is first opened
  if (tabName === "radar" && !radarInitialized && currentLat && currentLon) {
    setTimeout(() => {
      initRadarMap();
      radarInitialized = true;
    }, 100);
  }

  // Fix Leaflet map size issue when tab becomes visible
  if (tabName === "radar" && radarMap) {
    setTimeout(() => {
      radarMap.invalidateSize();
    }, 100);
  }
}

// Initialize tabs on load
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initAlerts();
  fetchWeatherNews();
});

// ---- Event Listeners ----

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = locationInput.value.trim();
  if (!query) return;
  hideSuggestions();
  searchAndFetchWeather(query);
});

locationInput.addEventListener("input", () => {
  const query = locationInput.value.trim();
  if (query.length < 2) {
    hideSuggestions();
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchSuggestions(query), 300);
});

locationInput.addEventListener("keydown", (e) => {
  if (currentSuggestions.length === 0) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, currentSuggestions.length - 1);
    renderSuggestionHighlight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
    renderSuggestionHighlight();
  } else if (e.key === "Enter" && activeSuggestionIndex >= 0) {
    e.preventDefault();
    selectSuggestion(currentSuggestions[activeSuggestionIndex]);
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if (!suggestionsEl.contains(e.target) && e.target !== locationInput) {
    hideSuggestions();
  }
});

// ---- Geocoding / Suggestions ----

async function fetchSuggestions(query) {
  try {
    const url = `${GEOCODING_API}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      hideSuggestions();
      return;
    }

    currentSuggestions = data.results;
    activeSuggestionIndex = -1;
    renderSuggestions();
  } catch {
    hideSuggestions();
  }
}

function renderSuggestions() {
  suggestionsEl.innerHTML = currentSuggestions
    .map((loc, i) => {
      const region = [loc.admin1, loc.country].filter(Boolean).join(", ");
      return `
        <div class="suggestion-item${i === activeSuggestionIndex ? " active" : ""}" data-index="${i}">
          <svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span class="suggestion-text">${loc.name}</span>
          <span class="suggestion-country">${region}</span>
        </div>
      `;
    })
    .join("");

  suggestionsEl.classList.remove("hidden");

  suggestionsEl.querySelectorAll(".suggestion-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.index, 10);
      selectSuggestion(currentSuggestions[idx]);
    });
  });
}

function renderSuggestionHighlight() {
  suggestionsEl.querySelectorAll(".suggestion-item").forEach((el, i) => {
    el.classList.toggle("active", i === activeSuggestionIndex);
  });
}

function hideSuggestions() {
  suggestionsEl.classList.add("hidden");
  suggestionsEl.innerHTML = "";
  currentSuggestions = [];
  activeSuggestionIndex = -1;
}

function selectSuggestion(loc) {
  hideSuggestions();
  const displayName = [loc.name, loc.admin1, loc.country].filter(Boolean).join(", ");
  locationInput.value = displayName;
  fetchWeather(loc.latitude, loc.longitude, displayName);
}

// ---- Weather Fetching ----

async function searchAndFetchWeather(query) {
  showLoading();
  try {
    const geoUrl = `${GEOCODING_API}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      showError("Location not found. Please try a different search term.");
      return;
    }

    const loc = geoData.results[0];
    const displayName = [loc.name, loc.admin1, loc.country].filter(Boolean).join(", ");
    locationInput.value = displayName;
    await fetchWeather(loc.latitude, loc.longitude, displayName);
  } catch {
    showError("Failed to search for location. Please check your connection and try again.");
  }
}

async function fetchWeather(lat, lon, locationName) {
  showLoading();
  currentLat = lat;
  currentLon = lon;
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "precipitation",
        "weather_code",
        "cloud_cover",
        "wind_speed_10m",
        "wind_direction_10m",
        "dewpoint_2m",
      ].join(","),
      hourly: [
        "temperature_2m",
        "precipitation_probability",
        "weather_code",
      ].join(","),
      daily: [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max",
        "uv_index_max",
      ].join(","),
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      timezone: "auto",
      forecast_days: "7",
    });

    const res = await fetch(`${WEATHER_API}?${params}`);
    if (!res.ok) throw new Error("Weather API request failed");
    const data = await res.json();
    renderWeather(data, locationName);
  } catch {
    showError("Failed to fetch weather data. Please try again.");
  }
}

// ---- Rendering ----

function renderWeather(data, locationName) {
  // Store data globally for hourly expansion
  currentWeatherData = data;
  currentTimezone = data.timezone;

  const current = data.current;
  const daily = data.daily;
  const hourly = data.hourly;

  // Current conditions
  const weatherInfo = WEATHER_CODES[current.weather_code] || {
    description: "Unknown",
    icon: "🌡️",
  };

  document.getElementById("location-name").textContent = locationName;
  document.getElementById("location-time").textContent = formatCurrentTime(
    data.timezone
  );
  document.getElementById("weather-icon").textContent = weatherInfo.icon;
  document.getElementById("current-temp").textContent = Math.round(
    current.temperature_2m
  );
  document.getElementById("current-condition").textContent =
    weatherInfo.description;
  document.getElementById("feels-like").textContent = `Feels like ${Math.round(
    current.apparent_temperature
  )}°F`;

  // Detail cards
  document.getElementById("dewpoint").textContent = `${Math.round(
    current.dewpoint_2m
  )}°F`;
  document.getElementById("sky-cover").textContent = `${current.cloud_cover}%`;

  // Get precipitation probability for current hour
  const currentHourIndex = getCurrentHourIndex(hourly.time, data.timezone);
  const precipProb =
    currentHourIndex >= 0
      ? hourly.precipitation_probability[currentHourIndex]
      : null;
  document.getElementById("precip-chance").textContent =
    precipProb !== null ? `${precipProb}%` : "--";

  document.getElementById(
    "humidity"
  ).textContent = `${current.relative_humidity_2m}%`;
  document.getElementById("wind").textContent = `${Math.round(
    current.wind_speed_10m
  )} mph ${getWindDirection(current.wind_direction_10m)}`;

  // UV Index (from today's daily max)
  const uvIndex = daily.uv_index_max?.[0];
  document.getElementById("uv-index").textContent =
    uvIndex != null ? `${uvIndex.toFixed(1)}` : "--";

  // 7-day forecast
  renderDailyForecast(daily);

  // Reset radar state for new location
  radarInitialized = false;

  // Fetch weather alerts for this location (US only via NWS)
  fetchWeatherAlerts(currentLat, currentLon);

  // Reset to current weather tab
  switchTab("current");

  hideLoading();
  weatherSection.classList.remove("hidden");
  errorSection.classList.add("hidden");
}

function renderDailyForecast(daily) {
  const container = document.getElementById("daily-forecast");

  // Find temp range across all days for bar scaling
  const allLows = daily.temperature_2m_min;
  const allHighs = daily.temperature_2m_max;
  const globalMin = Math.min(...allLows);
  const globalMax = Math.max(...allHighs);
  const range = globalMax - globalMin || 1;

  const days = daily.time.map((dateStr, i) => {
    const date = new Date(dateStr + "T12:00:00");
    const dayName =
      i === 0
        ? "Today"
        : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const weatherInfo = WEATHER_CODES[daily.weather_code[i]] || {
      description: "Unknown",
      icon: "🌡️",
    };
    const low = Math.round(allLows[i]);
    const high = Math.round(allHighs[i]);
    const precip = daily.precipitation_probability_max[i];

    // Calculate bar position
    const leftPct = ((allLows[i] - globalMin) / range) * 100;
    const widthPct = ((allHighs[i] - allLows[i]) / range) * 100;

    return `
      <div class="forecast-day-wrapper">
        <div class="forecast-day" data-day-index="${i}" data-date="${dateStr}">
          <span class="forecast-day-name">${dayName}</span>
          <span class="forecast-day-icon">${weatherInfo.icon}</span>
          <div class="forecast-temp-bar">
            <span class="forecast-temp-low">${low}°</span>
            <div class="temp-bar-track">
              <div class="temp-bar-fill" style="left: ${leftPct}%; width: ${Math.max(widthPct, 4)}%;"></div>
            </div>
            <span class="forecast-temp-high">${high}°</span>
          </div>
          <span class="forecast-precip">${precip > 0 ? precip + "%" : ""}</span>
          <svg class="forecast-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
        <div class="hourly-forecast" id="hourly-${i}"></div>
      </div>
    `;
  });

  container.innerHTML = days.join("");

  // Add click handlers for expandable days
  container.querySelectorAll(".forecast-day").forEach((dayEl) => {
    dayEl.addEventListener("click", () => toggleHourlyForecast(dayEl));
  });
}

function toggleHourlyForecast(dayEl) {
  const dayIndex = parseInt(dayEl.dataset.dayIndex, 10);
  const dateStr = dayEl.dataset.date;
  const hourlyPanel = document.getElementById(`hourly-${dayIndex}`);
  const isExpanded = dayEl.classList.contains("expanded");

  // Close all other panels first
  document.querySelectorAll(".forecast-day.expanded").forEach((el) => {
    if (el !== dayEl) {
      el.classList.remove("expanded");
      const idx = el.dataset.dayIndex;
      document.getElementById(`hourly-${idx}`).classList.remove("visible");
    }
  });

  if (isExpanded) {
    dayEl.classList.remove("expanded");
    hourlyPanel.classList.remove("visible");
  } else {
    dayEl.classList.add("expanded");
    renderHourlyForecast(hourlyPanel, dateStr);
    hourlyPanel.classList.add("visible");
  }
}

function renderHourlyForecast(container, dateStr) {
  if (!currentWeatherData) return;

  const hourly = currentWeatherData.hourly;
  const times = hourly.time;
  const temps = hourly.temperature_2m;
  const precips = hourly.precipitation_probability;
  const codes = hourly.weather_code;

  // Filter hours for this specific day
  const dayHours = [];
  times.forEach((timeStr, i) => {
    if (timeStr.startsWith(dateStr)) {
      dayHours.push({
        time: timeStr,
        temp: temps[i],
        precip: precips[i],
        code: codes[i],
      });
    }
  });

  if (dayHours.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Hourly data not available</p>';
    return;
  }

  const hourlyItems = dayHours.map((hour) => {
    const date = new Date(hour.time);
    const timeLabel = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      hour12: true,
      timeZone: currentTimezone,
    });
    const weatherInfo = WEATHER_CODES[hour.code] || { icon: "🌡️" };

    return `
      <div class="hourly-item">
        <span class="hourly-time">${timeLabel}</span>
        <span class="hourly-icon">${weatherInfo.icon}</span>
        <span class="hourly-temp">${Math.round(hour.temp)}°</span>
        <span class="hourly-precip">${hour.precip > 0 ? hour.precip + "%" : ""}</span>
      </div>
    `;
  });

  container.innerHTML = `<div class="hourly-grid">${hourlyItems.join("")}</div>`;
}

// ---- Helpers ----

function getCurrentHourIndex(hourlyTimes, timezone) {
  const now = new Date();
  // Format current time in the location's timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  const hour = parts.find((p) => p.type === "hour").value.padStart(2, "0");
  const target = `${year}-${month}-${day}T${hour}:00`;

  return hourlyTimes.indexOf(target);
}

function formatCurrentTime(timezone) {
  try {
    return new Date().toLocaleString("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return new Date().toLocaleString("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
}

function getWindDirection(degrees) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(degrees / 22.5) % 16;
  return dirs[index];
}

// ---- UI State ----

function showLoading() {
  loadingSection.classList.remove("hidden");
  weatherSection.classList.add("hidden");
  errorSection.classList.add("hidden");
}

function hideLoading() {
  loadingSection.classList.add("hidden");
}

function showError(msg) {
  loadingSection.classList.add("hidden");
  weatherSection.classList.add("hidden");
  errorSection.classList.remove("hidden");
  errorMessage.textContent = msg;
}

// ---- Radar Map ----

async function initRadarMap() {
  if (!currentLat || !currentLon) return;

  // Initialize or update Leaflet map
  if (!radarMap) {
    radarMap = L.map("radar-map", {
      zoomControl: true,
      attributionControl: true,
    }).setView([currentLat, currentLon], 6);

    // Dark-themed base map (CartoDB Dark Matter)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(radarMap);

    // Set up controls
    setupRadarControls();
  } else {
    radarMap.setView([currentLat, currentLon], 6);
  }

  // Fetch and load radar data
  await loadRadarData();
}

async function loadRadarData() {
  try {
    const res = await fetch(RAINVIEWER_API);
    const data = await res.json();

    // Clear existing radar layers
    radarLayers.forEach((layer) => radarMap.removeLayer(layer));
    radarLayers = [];
    radarFrames = [];

    // Get past radar frames (last 2 hours typically)
    const past = data.radar?.past || [];
    // Get forecast frames (next ~30 min)
    const nowcast = data.radar?.nowcast || [];

    // Combine past and forecast frames
    const allFrames = [...past, ...nowcast];

    if (allFrames.length === 0) {
      document.getElementById("radar-time").textContent = "No data";
      return;
    }

    radarFrames = allFrames;

    // Pre-load all radar tile layers
    allFrames.forEach((frame, index) => {
      const layer = L.tileLayer(
        `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
        {
          tileSize: 256,
          opacity: index === allFrames.length - 1 ? 0.7 : 0,
          zIndex: 10,
          maxNativeZoom: 7,
          maxZoom: 18,
        }
      );
      layer.addTo(radarMap);
      radarLayers.push(layer);
    });

    // Update slider
    const slider = document.getElementById("radar-slider");
    slider.max = radarFrames.length - 1;
    slider.value = radarFrames.length - 1;
    currentRadarFrame = radarFrames.length - 1;

    // Show current frame time
    updateRadarTimeDisplay();
  } catch (err) {
    console.error("Failed to load radar data:", err);
    document.getElementById("radar-time").textContent = "Error loading";
  }
}

function setupRadarControls() {
  const playBtn = document.getElementById("radar-play-btn");
  const slider = document.getElementById("radar-slider");

  playBtn.addEventListener("click", toggleRadarPlayback);

  slider.addEventListener("input", (e) => {
    stopRadarPlayback();
    const frameIndex = parseInt(e.target.value, 10);
    showRadarFrame(frameIndex);
  });
}

function toggleRadarPlayback() {
  if (radarPlaying) {
    stopRadarPlayback();
  } else {
    startRadarPlayback();
  }
}

function startRadarPlayback() {
  if (radarFrames.length === 0) return;

  radarPlaying = true;
  updatePlayButtonIcon();

  // Start from beginning if at end
  if (currentRadarFrame >= radarFrames.length - 1) {
    currentRadarFrame = 0;
    showRadarFrame(0);
  }

  radarInterval = setInterval(() => {
    currentRadarFrame++;
    if (currentRadarFrame >= radarFrames.length) {
      currentRadarFrame = 0;
    }
    showRadarFrame(currentRadarFrame);
  }, 500);
}

function stopRadarPlayback() {
  radarPlaying = false;
  updatePlayButtonIcon();
  if (radarInterval) {
    clearInterval(radarInterval);
    radarInterval = null;
  }
}

function updatePlayButtonIcon() {
  const playIcon = document.getElementById("play-icon");
  const pauseIcon = document.getElementById("pause-icon");

  if (radarPlaying) {
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
  } else {
    playIcon.classList.remove("hidden");
    pauseIcon.classList.add("hidden");
  }
}

function showRadarFrame(frameIndex) {
  if (frameIndex < 0 || frameIndex >= radarLayers.length) return;

  currentRadarFrame = frameIndex;

  // Hide all layers, show selected one
  radarLayers.forEach((layer, i) => {
    layer.setOpacity(i === frameIndex ? 0.7 : 0);
  });

  // Update slider position
  document.getElementById("radar-slider").value = frameIndex;

  // Update time display
  updateRadarTimeDisplay();
}

function updateRadarTimeDisplay() {
  if (radarFrames.length === 0 || currentRadarFrame >= radarFrames.length) return;

  const frame = radarFrames[currentRadarFrame];
  const date = new Date(frame.time * 1000);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Indicate if this is a forecast frame
  const now = Date.now() / 1000;
  const isForecast = frame.time > now;
  const label = isForecast ? `${timeStr} (fcst)` : timeStr;

  document.getElementById("radar-time").textContent = label;
}

// ---- Weather Alerts (NWS) ----

function initAlerts() {
  const expandBtn = document.getElementById("alerts-expand-btn");
  if (expandBtn) {
    expandBtn.addEventListener("click", toggleAlertsDetail);
  }
}

function toggleAlertsDetail() {
  const detail = document.getElementById("alerts-detail");
  const btn = document.getElementById("alerts-expand-btn");

  detail.classList.toggle("hidden");
  btn.classList.toggle("expanded");
}

async function fetchWeatherAlerts(lat, lon) {
  const alertsBanner = document.getElementById("alerts-banner");
  const alertsMarquee = document.getElementById("alerts-marquee");
  const alertsDetail = document.getElementById("alerts-detail");

  // Hide banner initially
  alertsBanner.classList.add("hidden");

  try {
    // NWS API requires point lookup first, then alerts for that zone
    // Use point-based alert query
    const url = `${NWS_ALERTS_API}?point=${lat},${lon}&status=actual&message_type=alert`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "SkyLens Weather App (contact@example.com)",
        Accept: "application/geo+json",
      },
    });

    if (!res.ok) {
      console.log("NWS alerts not available for this location");
      return;
    }

    const data = await res.json();
    const alerts = data.features || [];

    if (alerts.length === 0) {
      // Show "No weather alerts" banner
      currentAlerts = [];
      showNoAlertsState(alertsBanner, alertsMarquee, alertsDetail);
      return;
    }

    currentAlerts = alerts;

    // Show warning icon and expand button for actual alerts
    showAlertIcons(true);
    document.getElementById("alerts-expand-btn").style.display = "";
    document.getElementById("alerts-label").textContent = "Weather Alert";

    // Get the most severe alert's color (NWS provides colors)
    // Sort by severity and use the first alert's color
    const sortedAlerts = [...alerts].sort((a, b) => {
      const severityOrder = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
      return (severityOrder[a.properties.severity] || 4) - (severityOrder[b.properties.severity] || 4);
    });

    // Get NWS color from the most severe alert
    const primaryColor = getNWSAlertColor(sortedAlerts[0].properties.event);
    alertsBanner.className = "alerts-banner";
    alertsBanner.setAttribute("data-color", "true");
    alertsBanner.style.setProperty("--alert-color", primaryColor);

    // Build marquee text
    const marqueeText = alerts
      .map((a) => a.properties.headline || a.properties.event)
      .join("  •  ");

    alertsMarquee.innerHTML = `<span class="alerts-marquee-inner">${marqueeText}  •  ${marqueeText}</span>`;

    // Build detailed alerts with individual colors
    alertsDetail.innerHTML = alerts
      .map((a) => {
        const props = a.properties;
        const alertColor = getNWSAlertColor(props.event);
        const expires = props.expires
          ? new Date(props.expires).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "";
        const description = props.description
          ? props.description.substring(0, 500) + (props.description.length > 500 ? "..." : "")
          : "";

        return `
          <div class="alert-item" style="border-left: 4px solid ${alertColor};">
            <div class="alert-item-header">
              <span class="alert-item-title">${props.event}</span>
              ${expires ? `<span class="alert-item-expires">Expires: ${expires}</span>` : ""}
            </div>
            <p class="alert-item-description">${description}</p>
          </div>
        `;
      })
      .join("");

    alertsBanner.classList.remove("hidden");
  } catch (err) {
    console.error("Failed to fetch weather alerts:", err);
    // Show "No weather alerts" on error (likely non-US location)
    showNoAlertsState(alertsBanner, alertsMarquee, alertsDetail);
  }
}

function showNoAlertsState(banner, marquee, detail) {
  banner.className = "alerts-banner no-alerts";
  marquee.innerHTML = `<span>No active weather alerts for this area</span>`;
  detail.innerHTML = "";
  detail.classList.add("hidden");
  document.getElementById("alerts-expand-btn").style.display = "none";
  document.getElementById("alerts-label").textContent = "All Clear";
  showAlertIcons(false);
  banner.classList.remove("hidden");
}

function showAlertIcons(isAlert) {
  const warningIcon = document.getElementById("alert-icon-warning");
  const checkIcon = document.getElementById("alert-icon-check");

  if (isAlert) {
    warningIcon.classList.remove("hidden");
    checkIcon.classList.add("hidden");
  } else {
    warningIcon.classList.add("hidden");
    checkIcon.classList.remove("hidden");
  }
}

// NWS Official Alert Colors (hex values from weather.gov)
function getNWSAlertColor(eventType) {
  const nwsColors = {
    // Warnings (most severe)
    "Tornado Warning": "#FF0000",
    "Severe Thunderstorm Warning": "#FFA500",
    "Flash Flood Warning": "#8B0000",
    "Severe Weather Statement": "#00FFFF",
    "Shelter In Place Warning": "#FA8072",
    "Earthquake Warning": "#8B4513",
    "Extreme Wind Warning": "#FF8C00",
    "Hurricane Warning": "#DC143C",
    "Hurricane Force Wind Warning": "#CD5C5C",
    "Tropical Storm Warning": "#B22222",
    "Storm Warning": "#9400D3",
    "Tsunami Warning": "#FD6347",
    "Special Marine Warning": "#FFA500",
    "Blizzard Warning": "#FF4500",
    "Snow Squall Warning": "#C71585",
    "Ice Storm Warning": "#8B008B",
    "Winter Storm Warning": "#FF69B4",
    "High Wind Warning": "#DAA520",
    "Dust Storm Warning": "#FFE4C4",
    "Lake Effect Snow Warning": "#008B8B",
    "Excessive Heat Warning": "#C71585",
    "Tornado Watch": "#FFFF00",
    "Severe Thunderstorm Watch": "#DB7093",
    "Flash Flood Watch": "#2E8B57",
    "Flood Warning": "#00FF00",
    "Coastal Flood Warning": "#228B22",
    "Lakeshore Flood Warning": "#228B22",
    "Flood Watch": "#2E8B57",
    "Coastal Flood Watch": "#66CDAA",
    "Lakeshore Flood Watch": "#66CDAA",
    "Flood Advisory": "#00FF7F",
    "Hurricane Watch": "#FF00FF",
    "Hurricane Local Statement": "#FFE4B5",
    "Tropical Storm Watch": "#F08080",
    "Storm Surge Warning": "#B524F7",
    "Storm Surge Watch": "#DB7FF7",
    "Winter Weather Advisory": "#7B68EE",
    "Frost Advisory": "#6495ED",
    "Freeze Warning": "#483D8B",
    "Freeze Watch": "#00FFFF",
    "Wind Advisory": "#D2B48C",
    "Heat Advisory": "#FF7F50",
    "Dense Fog Advisory": "#708090",
    "Fire Weather Watch": "#FFDEAD",
    "Red Flag Warning": "#FF1493",
    "Wind Chill Warning": "#B0C4DE",
    "Wind Chill Watch": "#5F9EA0",
    "Wind Chill Advisory": "#AFEEEE",
    "Lake Effect Snow Watch": "#87CEFA",
    "Lake Effect Snow Advisory": "#48D1CC",
    "Avalanche Warning": "#1E90FF",
    "Avalanche Watch": "#F4A460",
    "Avalanche Advisory": "#CD853F",
    "Winter Storm Watch": "#4682B4",
    "Hazardous Weather Outlook": "#EEE8AA",
    "Special Weather Statement": "#FFE4B5",
    "Air Quality Alert": "#808080",
    "Rip Current Statement": "#40E0D0",
    "Beach Hazards Statement": "#40E0D0",
    "Gale Warning": "#DDA0DD",
    "Small Craft Advisory": "#D8BFD8",
    "Hazardous Seas Warning": "#D8BFD8",
    "Marine Weather Statement": "#FFEFD5",
    "Dense Smoke Advisory": "#F0E68C",
    "Dust Advisory": "#BDB76B",
    "High Surf Warning": "#228B22",
    "High Surf Advisory": "#BA55D3",
  };

  // Try exact match first
  if (nwsColors[eventType]) {
    return nwsColors[eventType];
  }

  // Try partial match
  const eventLower = eventType.toLowerCase();
  for (const [key, color] of Object.entries(nwsColors)) {
    if (eventLower.includes(key.toLowerCase().split(" ")[0])) {
      return color;
    }
  }

  // Default colors based on keywords
  if (eventLower.includes("warning")) return "#FF0000";
  if (eventLower.includes("watch")) return "#FFA500";
  if (eventLower.includes("advisory")) return "#FFFF00";
  if (eventLower.includes("statement")) return "#FFE4B5";

  // Fallback
  return "#FF6347";
}

// ---- Science & Weather News ----

async function fetchWeatherNews() {
  const newsList = document.getElementById("news-list");

  // Array of RSS feeds to try - science and weather focused
  const feedSources = [
    {
      url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
      name: "BBC Science"
    },
    {
      url: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",
      name: "NYT Science"
    },
    {
      url: "https://www.sciencedaily.com/rss/top/environment.xml",
      name: "Science Daily"
    }
  ];

  let allItems = [];

  // Fetch from multiple sources
  for (const source of feedSources) {
    try {
      const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}&count=10`;
      const res = await fetch(proxyUrl);
      const data = await res.json();

      if (data.status === "ok" && data.items && data.items.length > 0) {
        // Add source info to each item
        const itemsWithSource = data.items.map(item => ({
          ...item,
          sourceName: source.name
        }));
        allItems = allItems.concat(itemsWithSource);
      }
    } catch (err) {
      console.log(`Failed to fetch from ${source.name}:`, err);
    }
  }

  if (allItems.length === 0) {
    newsList.innerHTML = `<div class="news-error">Unable to load science news</div>`;
    return;
  }

  // Prioritize weather-related stories, then show general science
  const weatherKeywords = [
    "weather", "storm", "climate", "flood", "hurricane", "tornado",
    "drought", "rain", "snow", "temperature", "heat", "cold", "wind",
    "wildfire", "earthquake", "volcano", "ocean", "ice", "glacier",
    "atmosphere", "forecast", "meteorolog", "el nino", "la nina"
  ];

  const scienceKeywords = [
    "science", "research", "study", "discovery", "space", "nasa",
    "environment", "nature", "planet", "earth", "species", "biology",
    "physics", "chemistry", "technology", "energy", "solar", "carbon"
  ];

  // Score and sort items by relevance
  const scoredItems = allItems.map(item => {
    const text = (item.title + " " + (item.description || "")).toLowerCase();
    let score = 0;

    // Weather keywords get higher priority
    weatherKeywords.forEach(kw => {
      if (text.includes(kw)) score += 3;
    });

    // Science keywords get medium priority
    scienceKeywords.forEach(kw => {
      if (text.includes(kw)) score += 1;
    });

    // Recency boost
    if (item.pubDate) {
      const age = Date.now() - new Date(item.pubDate).getTime();
      const hoursOld = age / (1000 * 60 * 60);
      if (hoursOld < 6) score += 2;
      else if (hoursOld < 24) score += 1;
    }

    return { ...item, score };
  });

  // Sort by score (descending), then by date
  scoredItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });

  // Remove duplicates by title similarity
  const uniqueItems = [];
  const seenTitles = new Set();

  for (const item of scoredItems) {
    const titleKey = item.title.toLowerCase().substring(0, 50);
    if (!seenTitles.has(titleKey)) {
      seenTitles.add(titleKey);
      uniqueItems.push(item);
    }
    if (uniqueItems.length >= 6) break;
  }

  renderNews(uniqueItems);
}

function renderNews(items) {
  const newsList = document.getElementById("news-list");

  if (!items || items.length === 0) {
    newsList.innerHTML = `<div class="news-error">No science news available</div>`;
    return;
  }

  newsList.innerHTML = items
    .map((item) => {
      const pubDate = item.pubDate ? formatNewsDate(item.pubDate) : "";
      // Use sourceName if available, otherwise extract from URL
      const source = item.sourceName || extractSource(item.link) || "Science";

      return `
        <a href="${item.link}" target="_blank" rel="noopener" class="news-item">
          <div class="news-item-source">${source}</div>
          <div class="news-item-title">${item.title}</div>
          ${pubDate ? `<div class="news-item-time">${pubDate}</div>` : ""}
        </a>
      `;
    })
    .join("");
}

function formatNewsDate(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    }
  } catch {
    return "";
  }
}

function extractSource(url) {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.replace("www.", "").split(".");
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch {
    return "News";
  }
}
