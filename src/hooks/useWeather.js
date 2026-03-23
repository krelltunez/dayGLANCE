import { useState, useEffect, useCallback } from 'react';

const getWeatherCondition = (code) => {
  if (code === 0) return 'Clear';
  if ([1, 2, 3].includes(code)) return 'Partly Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'Rainy';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snowy';
  if ([95, 96, 99].includes(code)) return 'Stormy';
  return 'Cloudy';
};

const getWeatherIcon = (code) => {
  // WMO Weather interpretation codes
  if (code === 0) return '☀️'; // Clear sky
  if (code === 1) return '🌤️'; // Mainly clear
  if (code === 2) return '⛅'; // Partly cloudy
  if (code === 3) return '☁️'; // Overcast
  if ([45, 48].includes(code)) return '🌁'; // Fog
  if ([51, 53, 55].includes(code)) return '🌦️'; // Drizzle
  if ([56, 57].includes(code)) return '🌧️'; // Freezing drizzle
  if ([61, 63, 65].includes(code)) return '🌧️'; // Rain
  if ([66, 67].includes(code)) return '🌧️'; // Freezing rain
  if ([71, 73, 75].includes(code)) return '🌨️'; // Snow fall
  if (code === 77) return '🌨️'; // Snow grains
  if ([80, 81, 82].includes(code)) return '🌧️'; // Rain showers
  if ([85, 86].includes(code)) return '🌨️'; // Snow showers
  if (code === 95) return '⛈️'; // Thunderstorm
  if ([96, 99].includes(code)) return '⛈️'; // Thunderstorm with hail

  console.warn('Unknown weather code:', code);
  return '☁️'; // Default fallback
};

const useWeather = () => {
  const [weatherZip, setWeatherZip] = useState(() => {
    return localStorage.getItem('day-planner-weather-zip') || '';
  });
  const [weatherTempUnit, setWeatherTempUnit] = useState(() => {
    return localStorage.getItem('day-planner-weather-temp-unit') || 'fahrenheit';
  });
  const [weather, setWeather] = useState(null);

  // Persist weather settings to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-weather-zip', weatherZip);
  }, [weatherZip]);

  useEffect(() => {
    localStorage.setItem('day-planner-weather-temp-unit', weatherTempUnit);
  }, [weatherTempUnit]);

  const fetchWeather = useCallback(async () => {
    try {
      // Read settings from localStorage to avoid stale closures
      const zip = localStorage.getItem('day-planner-weather-zip') || '';
      const tempUnit = localStorage.getItem('day-planner-weather-temp-unit') || 'fahrenheit';

      if (!zip) {
        setWeather(null);
        return;
      }

      let latitude, longitude, tz;
      const query = zip.trim();

      // Try US ZIP code via zippopotam.us (free, no key needed)
      if (/^\d{5}(-\d{4})?$/.test(query)) {
        try {
          const geoResponse = await fetch(`https://api.zippopotam.us/us/${query.slice(0, 5)}`);
          if (geoResponse.ok) {
            const geoData = await geoResponse.json();
            if (geoData.places && geoData.places.length > 0) {
              latitude = parseFloat(geoData.places[0].latitude);
              longitude = parseFloat(geoData.places[0].longitude);
            }
          }
        } catch (e) { /* fall through to city name search */ }
      }

      // Fall back to Open-Meteo geocoding for city/place names
      if (latitude === undefined) {
        try {
          const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
          const geoData = await geoResponse.json();
          if (geoData.results && geoData.results.length > 0) {
            latitude = geoData.results[0].latitude;
            longitude = geoData.results[0].longitude;
            tz = geoData.results[0].timezone;
          }
        } catch (e) { /* no results */ }
      }

      if (latitude === undefined) {
        setWeather({
          temp: '--',
          condition: 'Location not found',
          icon: '📍',
          high: '--',
          low: '--',
          forecast: []
        });
        return;
      }

      tz = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=${tempUnit}&timezone=${encodeURIComponent(tz)}&forecast_days=6`);
      const data = await response.json();

      if (data.current && data.daily) {
        // Build forecast array for next 5 days (starting from tomorrow)
        const forecast = [];
        for (let i = 1; i <= 5; i++) {
          // Append T12:00:00 to avoid timezone issues (date-only strings are parsed as UTC midnight)
          const date = new Date(data.daily.time[i] + 'T12:00:00');
          forecast.push({
            day: date.toLocaleDateString('en-US', { weekday: 'short' }),
            high: Math.round(data.daily.temperature_2m_max[i]),
            low: Math.round(data.daily.temperature_2m_min[i]),
            icon: getWeatherIcon(data.daily.weather_code[i]),
            code: data.daily.weather_code[i] // For debugging
          });
        }

        setWeather({
          temp: Math.round(data.current.temperature_2m),
          condition: getWeatherCondition(data.current.weather_code),
          icon: getWeatherIcon(data.current.weather_code),
          high: Math.round(data.daily.temperature_2m_max[0]),
          low: Math.round(data.daily.temperature_2m_min[0]),
          forecast: forecast
        });
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
      // Set a fallback so we know it tried
      setWeather({
        temp: '--',
        condition: 'Unable to load',
        icon: '🌡️',
        high: '--',
        low: '--',
        forecast: []
      });
    }
  }, []);

  // Fetch on mount and refresh every hour
  useEffect(() => {
    fetchWeather();
    const weatherInterval = setInterval(() => {
      fetchWeather();
    }, 60 * 60 * 1000);
    return () => clearInterval(weatherInterval);
  }, [fetchWeather]);

  return { weather, setWeather, weatherZip, setWeatherZip, weatherTempUnit, setWeatherTempUnit, fetchWeather };
};

export default useWeather;
