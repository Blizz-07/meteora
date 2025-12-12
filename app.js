// ===== Configuration =====
const CONFIG = {
    GEOCODING_API: 'https://geocoding-api.open-meteo.com/v1/search',
    WEATHER_API: 'https://api.open-meteo.com/v1/forecast',
    STORAGE_KEY_FAVORITES: 'meteo-pwa-favorites',
    STORAGE_KEY_THEME: 'meteo-pwa-theme',
    RAIN_CODES: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99],
    TEMP_THRESHOLD: 10
};

// ===== Éléments DOM =====
const elements = {
    cityInput: document.getElementById('city-input'),
    searchBtn: document.getElementById('search-btn'),
    notifyBtn: document.getElementById('notify-btn'),
    themeToggle: document.getElementById('theme-toggle'),
    weatherSection: document.getElementById('weather-section'),
    favoritesSection: document.getElementById('favorites-section'),
    favoritesList: document.getElementById('favorites-list'),
    favoriteBtn: document.getElementById('favorite-btn'),
    cityName: document.getElementById('city-name'),
    temperature: document.getElementById('temperature'),
    weatherIcon: document.getElementById('weather-icon'),
    wind: document.getElementById('wind'),
    humidity: document.getElementById('humidity'),
    feelsLike: document.getElementById('feels-like'),
    hourlyList: document.getElementById('hourly-list'),
    loading: document.getElementById('loading'),
    errorMessage: document.getElementById('error-message')
};

// ===== État =====
let currentCity = null;

// ===== Initialisation =====
document.addEventListener('DOMContentLoaded', () => {
    updateNotifyButton();
    registerServiceWorker();
});

// ===== Service Worker =====
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js');
            console.log('Service Worker enregistré:', registration.scope);
        } catch (error) {
            console.error('Erreur Service Worker:', error);
        }
    }
}

// ===== Notification Utils =====
function isNotificationSupported() {
    return ('Notification' in window);
}

function updateNotifyButton() {
    if (!isNotificationSupported()) {
        elements.notifyBtn.textContent = '🔔 Notifications non supportées';
        elements.notifyBtn.disabled = true;
        return;
    }

    const permission = Notification.permission;

    if (permission === 'granted') {
        elements.notifyBtn.textContent = '✅ Notifications activées';
        elements.notifyBtn.classList.add('granted');
    } else if (permission === 'denied') {
        elements.notifyBtn.textContent = '❌ Notifications bloquées';
        elements.notifyBtn.classList.add('denied');
    } else {
        elements.notifyBtn.textContent = '🔔 Activer les notifications';
    }
}

// CORRECTION IMPORTANTE — Chrome n'accepte plus requestPermission() en async/await
function requestNotificationPermission() {
    Notification.requestPermission().then(permission => {
        updateNotifyButton();

        if (permission === 'granted') {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification('MétéoPWA', {
                        body: 'Notifications activées 🎉',
                        icon: 'icons/icon-192.png',
                        vibrate: [200, 100, 200]
                    });
                });
            }
        }
    });
}

function sendWeatherNotification(city, message, tag = 'info') {
    if (!isNotificationSupported()) return;
    if (Notification.permission !== 'granted') return;

    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(`Alerte météo: ${city}`, {
            body: message,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            tag: tag,
            vibrate: [200, 100, 200]
        });
    });
}

// ===== Recherche =====
async function handleSearch() {
    const query = elements.cityInput.value.trim();
    if (!query) return showError('Veuillez entrer un nom de ville.');

    showLoading();
    hideError();

    try {
        const geoResponse = await fetch(
            `${CONFIG.GEOCODING_API}?name=${encodeURIComponent(query)}&count=1&language=fr&format=json`
        );

        if (!geoResponse.ok) throw new Error('Erreur de géocodage');

        const geoData = await geoResponse.json();
        if (!geoData.results || geoData.results.length === 0)
            throw new Error(`Ville "${query}" non trouvée.`);

        const loc = geoData.results[0];
        const cityName = `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}, ${loc.country}`;

        await fetchWeather(loc.latitude, loc.longitude, cityName);

    } catch (err) {
        showError(err.message);
    } finally {
        hideLoading();
    }
}

async function fetchWeather(lat, lon, cityName) {
    try {
        showLoading();
        const res = await fetch(
            `${CONFIG.WEATHER_API}?latitude=${lat}&longitude=${lon}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
            `&hourly=temperature_2m,weather_code,precipitation_probability` +
            `&timezone=auto&forecast_days=1`
        );

        if (!res.ok) throw new Error('Erreur lors de la récupération des données météo');

        const data = await res.json();
        currentCity = { name: cityName, lat, lon };

        displayWeather(data, cityName);
        checkWeatherAlerts(data, cityName);

    } catch (err) {
        showError(err.message);
    } finally {
        hideLoading();
    }
}

// ===== Affichage =====
function displayWeather(data, cityName) {
    const current = data.current;
    const hourly = data.hourly;

    elements.cityName.textContent = cityName;
    elements.temperature.textContent = Math.round(current.temperature_2m);
    elements.weatherIcon.textContent = getWeatherEmoji(current.weather_code);
    elements.wind.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    elements.humidity.textContent = `${current.relative_humidity_2m} %`;
    elements.feelsLike.textContent = `${Math.round(current.apparent_temperature)}°C`;

    // Prévisions horaires
    const nowHour = new Date().getHours();
    const items = [];

    for (let i = 0; i < 4; i++) {
        const idx = nowHour + i + 1;
        if (idx >= hourly.time.length) continue;

        const time = new Date(hourly.time[idx]);
        const temp = hourly.temperature_2m[idx];
        const code = hourly.weather_code[idx];
        const isRain = CONFIG.RAIN_CODES.includes(code);
        const isWarm = temp > CONFIG.TEMP_THRESHOLD;

        let style = 'bg-gradient-to-b from-blue-100 to-blue-50 dark:from-gray-700 dark:to-gray-800';
        if (isRain) style = 'bg-gradient-to-b from-blue-300 to-blue-200 dark:from-blue-900 dark:to-blue-800 border-2 border-blue-400';
        if (isWarm) style = 'bg-gradient-to-b from-orange-200 to-orange-100 dark:from-orange-900 dark:to-orange-800 border-2 border-orange-400';

        items.push(`
            <div class="hourly-item p-4 rounded-lg min-w-max ${style}">
                <div class="text-sm font-semibold">${time.getHours()}h</div>
                <div class="text-3xl">${getWeatherEmoji(code)}</div>
                <div class="text-lg font-bold">${Math.round(temp)}°C</div>
            </div>
        `);
    }

    elements.hourlyList.innerHTML = items.join('');
    elements.weatherSection.classList.remove('hidden');
}

function checkWeatherAlerts(data, cityName) {
    const hourly = data.hourly;
    const nowHour = new Date().getHours();

    let rainIn = null;
    let hotTemp = null;

    for (let i = 1; i <= 4; i++) {
        const idx = nowHour + i;
        if (idx >= hourly.time.length) continue;

        const code = hourly.weather_code[idx];
        const temp = hourly.temperature_2m[idx];

        if (!rainIn && CONFIG.RAIN_CODES.includes(code)) rainIn = i;
        if (!hotTemp && temp > CONFIG.TEMP_THRESHOLD) hotTemp = Math.round(temp);
    }

    if (rainIn) {
        sendWeatherNotification(
            cityName,
            `🌧️ Pluie prévue dans ${rainIn} heure${rainIn > 1 ? 's' : ''} !`,
            'rain'
        );
    }

    if (hotTemp) {
        sendWeatherNotification(
            cityName,
            `🌡️ Température élevée prévue : ${hotTemp}°C`,
            'temp'
        );
    }
}

// ===== Utilitaires =====
function getWeatherEmoji(code) {
    const icons = {
        0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
        45: '🌫️', 48: '🌫️',
        51: '🌦️', 53: '🌦️', 55: '🌧️',
        56: '🌨️', 57: '🌨️',
        61: '🌧️', 63: '🌧️', 65: '🌧️',
        66: '🌨️', 67: '🌨️',
        71: '🌨️', 73: '🌨️', 75: '❄️', 77: '🌨️',
        80: '🌦️', 81: '🌧️', 82: '⛈️',
        85: '🌨️', 86: '❄️',
        95: '⛈️', 96: '⛈️', 99: '⛈️'
    };
    return icons[code] || '🌤️';
}

function showLoading() {
    elements.loading.classList.remove('hidden');
    elements.weatherSection.classList.add('hidden');
}

function hideLoading() {
    elements.loading.classList.add('hidden');
}

function showError(msg) {
    elements.errorMessage.textContent = msg;
    elements.errorMessage.classList.remove('hidden');
}

function hideError() {
    elements.errorMessage.classList.add('hidden');
}

// ===== Favoris =====
function getFavorites() {
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY_FAVORITES) || '[]');
}

function saveFavorites(favs) {
    localStorage.setItem(CONFIG.STORAGE_KEY_FAVORITES, JSON.stringify(favs));
    renderFavorites();
}

function addCurrentCityToFavorites() {
    if (!currentCity) return;
    const favs = getFavorites();
    if (!favs.some(f => f.name === currentCity.name)) {
        favs.push(currentCity);
        saveFavorites(favs);
    }
}

function renderFavorites() {
    const favs = getFavorites();
    elements.favoritesList.innerHTML = favs.map(f =>
        `<button class="favorite-city px-4 py-2 bg-blue-500 text-white rounded-lg"
         data-city="${f.name}" data-lat="${f.lat}" data-lon="${f.lon}">
            ${f.name}
        </button>`
    ).join('');
}

renderFavorites();

// ===== Thème =====
function getTheme() {
    return localStorage.getItem(CONFIG.STORAGE_KEY_THEME) || 'light';
}

function setTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
    elements.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem(CONFIG.STORAGE_KEY_THEME, theme);
}

function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

setTheme(getTheme());

// ===== Événements =====
elements.searchBtn.addEventListener('click', handleSearch);
elements.cityInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
});
elements.favoriteBtn.addEventListener('click', addCurrentCityToFavorites);
elements.favoritesList.addEventListener('click', e => {
    if (e.target.classList.contains('favorite-city')) {
        fetchWeather(e.target.dataset.lat, e.target.dataset.lon, e.target.dataset.city);
    }
});
elements.themeToggle.addEventListener('click', toggleTheme);
elements.notifyBtn.addEventListener('click', requestNotificationPermission);
