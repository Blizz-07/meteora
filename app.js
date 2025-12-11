// ===== Configuration =====
const CONFIG = {
    GEOCODING_API: 'https://geocoding-api.open-meteo.com/v1/search',
    WEATHER_API: 'https://api.open-meteo.com/v1/forecast',
    STORAGE_KEY_FAVORITES: 'meteo-pwa-favorites',
    STORAGE_KEY_THEME: 'meteo-pwa-theme',
    RAIN_CODES: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99],
    TEMP_THRESHOLD: 10 // Température seuil pour notification
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

// ===== État de l'application =====
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
            console.log('✅ Service Worker enregistré:', registration.scope);
        } catch (error) {
            console.error('❌ Erreur Service Worker:', error);
        }
    }
}

// ===== Notifications =====
function isNotificationSupported() {
    return 'Notification' in window && typeof Notification !== 'undefined';
}

function updateNotifyButton() {
    if (!isNotificationSupported()) {
        elements.notifyBtn.textContent = '🔔 Non disponible (iOS)';
        elements.notifyBtn.disabled = true;
        return;
    }
    
    if (!('Notification' in window)) {
        elements.notifyBtn.textContent = '🔔 Notifications non supportées';
        elements.notifyBtn.disabled = true;
        return;
    }

    const permission = Notification.permission;
    
    if (permission === 'granted') {
        elements.notifyBtn.textContent = '✅ Notifications activées';
        elements.notifyBtn.classList.add('granted');
        elements.notifyBtn.classList.remove('denied');
    } else if (permission === 'denied') {
        elements.notifyBtn.textContent = '❌ Notifications bloquées';
        elements.notifyBtn.classList.add('denied');
        elements.notifyBtn.classList.remove('granted');
    } else {
        elements.notifyBtn.textContent = '🔔 Activer les notifications';
        elements.notifyBtn.classList.remove('granted', 'denied');
    }
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showError('Les notifications ne sont pas supportées par votre navigateur.');
        return;
    }

    if (Notification.permission === 'denied') {
        showError('Les notifications sont bloquées. Veuillez les réactiver dans les paramètres de votre navigateur.');
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        updateNotifyButton();
        
        if (permission === 'granted') {
            // Notification de test
            new Notification('MétéoPWA', {
                body: 'Les notifications sont maintenant activées ! 🎉',
                icon: 'icons/icon-192.png',
                tag: 'welcome'
            });
        }
    } catch (error) {
        console.error('Erreur lors de la demande de permission:', error);
    }
}

function sendWeatherNotification(city, message, type = 'info') {
    if (Notification.permission === 'granted') {
        new Notification(`Alerte météo: ${city}`, {
            body: message,
            icon: 'icons/icon-192.png',
            tag: type
        });
    }
}
// ===== Recherche et API Météo =====
async function handleSearch() {
    const query = elements.cityInput.value.trim();
    
    if (!query) {
        showError('Veuillez entrer un nom de ville.');
        return;
    }

    showLoading();
    hideError();

    try {
        // 1. Géocodage : trouver les coordonnées de la ville
        const geoResponse = await fetch(
            `${CONFIG.GEOCODING_API}?name=${encodeURIComponent(query)}&count=1&language=fr&format=json`
        );
        
        if (!geoResponse.ok) throw new Error('Erreur de géocodage');
        
        const geoData = await geoResponse.json();
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error(`Ville "${query}" non trouvée. Vérifiez l'orthographe.`);
        }

        const location = geoData.results[0];
        const cityName = `${location.name}${location.admin1 ? ', ' + location.admin1 : ''}, ${location.country}`;
        
        // 2. Récupérer la météo
        await fetchWeather(location.latitude, location.longitude, cityName);
        
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

async function fetchWeather(lat, lon, cityName) {
    showLoading();
    hideError();

    try {
        const weatherResponse = await fetch(
            `${CONFIG.WEATHER_API}?latitude=${lat}&longitude=${lon}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
            `&hourly=temperature_2m,weather_code,precipitation_probability` +
            `&timezone=auto&forecast_days=1`
        );

        if (!weatherResponse.ok) throw new Error('Erreur lors de la récupération des données météo');

        const weatherData = await weatherResponse.json();
        
        // Sauvegarder la ville courante
        currentCity = { name: cityName, lat, lon };
        
        // Afficher les résultats
        displayWeather(weatherData, cityName);
        
        // Vérifier les alertes pour les 4 prochaines heures
        checkWeatherAlerts(weatherData, cityName);
        
        hideLoading();
        
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

function displayWeather(data, cityName) {
    const current = data.current;
    const hourly = data.hourly;

    // Données actuelles
    elements.cityName.textContent = cityName;
    elements.temperature.textContent = Math.round(current.temperature_2m);
    elements.weatherIcon.textContent = getWeatherEmoji(current.weather_code);
    elements.wind.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    elements.humidity.textContent = `${current.relative_humidity_2m} %`;
    elements.feelsLike.textContent = `${Math.round(current.apparent_temperature)}°C`;

    // Prévisions horaires (4 prochaines heures)
    const currentHour = new Date().getHours();
    const hourlyItems = [];
    
    for (let i = 0; i < 4; i++) {
        const hourIndex = currentHour + i + 1;
        if (hourIndex < hourly.time.length) {
            const time = new Date(hourly.time[hourIndex]);
            const temp = hourly.temperature_2m[hourIndex];
            const code = hourly.weather_code[hourIndex];
            const isRain = CONFIG.RAIN_CODES.includes(code);
            const isHighTemp = temp > CONFIG.TEMP_THRESHOLD;
            
            let alertClass = '';
            if (isRain) alertClass = 'rain-alert';
            else if (isHighTemp) alertClass = 'temp-alert';

            hourlyItems.push(`
                <div class="hourly-item ${alertClass}">
                    <div class="hourly-time">${time.getHours()}h</div>
                    <div class="hourly-icon">${getWeatherEmoji(code)}</div>
                    <div class="hourly-temp">${Math.round(temp)}°C</div>
                </div>
            `);
        }
    }

    elements.hourlyList.innerHTML = hourlyItems.join('');
    elements.weatherSection.classList.remove('hidden');
}

function checkWeatherAlerts(data, cityName) {
    const hourly = data.hourly;
    const currentHour = new Date().getHours();
    
    let rainAlert = false;
    let tempAlert = false;
    let rainHour = null;
    let highTemp = null;

    // Vérifier les 4 prochaines heures
    for (let i = 1; i <= 4; i++) {
        const hourIndex = currentHour + i;
        if (hourIndex < hourly.time.length) {
            const code = hourly.weather_code[hourIndex];
            const temp = hourly.temperature_2m[hourIndex];
            
            // Vérifier la pluie
            if (!rainAlert && CONFIG.RAIN_CODES.includes(code)) {
                rainAlert = true;
                rainHour = i;
            }
            
            // Vérifier la température > 10°C
            if (!tempAlert && temp > CONFIG.TEMP_THRESHOLD) {
                tempAlert = true;
                highTemp = Math.round(temp);
            }
        }
    }

    // Envoyer les notifications
    if (rainAlert) {
        sendWeatherNotification(
            cityName,
            `🌧️ Pluie prévue dans ${rainHour} heure${rainHour > 1 ? 's' : ''} !`,
            'rain'
        );
    }

    if (tempAlert) {
        sendWeatherNotification(
            cityName,
            `🌡️ Température supérieure à ${CONFIG.TEMP_THRESHOLD}°C prévue (${highTemp}°C)`,
            'temp'
        );
    }
}

// ===== Utilitaires =====
function getWeatherEmoji(code) {
    const weatherEmojis = {
        0: '☀️',      // Clear sky
        1: '🌤️',     // Mainly clear
        2: '⛅',      // Partly cloudy
        3: '☁️',      // Overcast
        45: '🌫️',    // Fog
        48: '🌫️',    // Depositing rime fog
        51: '🌦️',    // Light drizzle
        53: '🌦️',    // Moderate drizzle
        55: '🌧️',    // Dense drizzle
        56: '🌨️',    // Light freezing drizzle
        57: '🌨️',    // Dense freezing drizzle
        61: '🌧️',    // Slight rain
        63: '🌧️',    // Moderate rain
        65: '🌧️',    // Heavy rain
        66: '🌨️',    // Light freezing rain
        67: '🌨️',    // Heavy freezing rain
        71: '🌨️',    // Slight snow
        73: '🌨️',    // Moderate snow
        75: '❄️',     // Heavy snow
        77: '🌨️',    // Snow grains
        80: '🌦️',    // Slight rain showers
        81: '🌧️',    // Moderate rain showers
        82: '⛈️',     // Violent rain showers
        85: '🌨️',    // Slight snow showers
        86: '❄️',     // Heavy snow showers
        95: '⛈️',     // Thunderstorm
        96: '⛈️',     // Thunderstorm with slight hail
        99: '⛈️'      // Thunderstorm with heavy hail
    };
    
    return weatherEmojis[code] || '🌤️';
}

function showLoading() {
    elements.loading.classList.remove('hidden');
    elements.weatherSection.classList.add('hidden');
}

function hideLoading() {
    elements.loading.classList.add('hidden');
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');
}

function hideError() {
    elements.errorMessage.classList.add('hidden');
}

// ===== Gestion des événements =====
elements.searchBtn.addEventListener('click', handleSearch);
elements.cityInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
});
elements.favoriteBtn.addEventListener('click', addCurrentCityToFavorites);
elements.favoritesList.addEventListener('click', (e) => {
    if (e.target.classList.contains('favorite-city')) {
        const city = e.target.dataset.city;
        const lat = e.target.dataset.lat;
        const lon = e.target.dataset.lon;
        fetchWeather(lat, lon, city);
    }
});
elements.themeToggle.addEventListener('click', toggleTheme);
elements.notifyBtn.addEventListener('click', requestNotificationPermission);

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
    let favs = getFavorites();
    if (!favs.some(f => f.name === currentCity.name)) {
        favs.push(currentCity);
        saveFavorites(favs);
    }
}

function renderFavorites() {
    const favs = getFavorites();
    elements.favoritesList.innerHTML = favs.map(f =>
        `<span class="favorite-city" data-city="${f.name}" data-lat="${f.lat}" data-lon="${f.lon}">${f.name}</span>`
    ).join('');
}
renderFavorites();

// ===== Thème sombre/clair =====
function getTheme() {
    return localStorage.getItem(CONFIG.STORAGE_KEY_THEME) || 'light';
}

function setTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
    elements.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem(CONFIG.STORAGE_KEY_THEME, theme);
}

function toggleTheme() {
    const theme = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(theme);
}
setTheme(getTheme());

