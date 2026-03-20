export type WeatherHour = {
  time: string;        // e.g. "09:00"
  temp: number;
  icon: string;
  description: string;
};

export type WeatherDay = {
  date: string;        // e.g. "Mon"
  icon: string;
  tempMin: number;
  tempMax: number;
  description: string;
  hours: WeatherHour[];
};

export type WeatherData = {
  city: string;
  temp: number;
  feelsLike: number;
  description: string;
  icon: string;
  humidity: number;
  forecast: WeatherDay[];  // next 3 days
  fetchedAt: number;       // epoch ms
};

let cache: WeatherData | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getWeather(
  apiKey: string,
  lat: string,
  lon: string,
  fetchFn: typeof fetch = fetch
): Promise<WeatherData> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  // Current weather
  const currentUrl =
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
  const forecastUrl =
    `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&cnt=24`;

  const [currentRes, forecastRes] = await Promise.all([
    fetchFn(currentUrl),
    fetchFn(forecastUrl),
  ]);

  if (!currentRes.ok) throw new Error(`OWM current: ${currentRes.status}`);
  if (!forecastRes.ok) throw new Error(`OWM forecast: ${forecastRes.status}`);

  const current = await currentRes.json() as {
    name: string;
    main: { temp: number; feels_like: number; humidity: number };
    weather: Array<{ description: string; icon: string }>;
  };

  const forecastRaw = await forecastRes.json() as {
    list: Array<{
      dt: number;
      main: { temp: number; temp_min: number; temp_max: number };
      weather: Array<{ description: string; icon: string }>;
    }>;
  };

  // Group forecast by calendar day
  const dayMap = new Map<string, {
    tempMin: number; tempMax: number; icon: string; description: string;
    hours: WeatherHour[];
  }>();

  for (const entry of forecastRaw.list) {
    const d = new Date(entry.dt * 1000);
    const key = d.toLocaleDateString("en-US", { weekday: "short" });
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const hour: WeatherHour = {
      time,
      temp: Math.round(entry.main.temp),
      icon: entry.weather[0]?.icon ?? "01d",
      description: entry.weather[0]?.description ?? "",
    };
    const existing = dayMap.get(key);
    if (!existing) {
      dayMap.set(key, {
        tempMin: entry.main.temp_min,
        tempMax: entry.main.temp_max,
        icon: entry.weather[0]?.icon ?? "01d",
        description: entry.weather[0]?.description ?? "",
        hours: [hour],
      });
    } else {
      existing.tempMin = Math.min(existing.tempMin, entry.main.temp_min);
      existing.tempMax = Math.max(existing.tempMax, entry.main.temp_max);
      existing.hours.push(hour);
    }
  }

  const todayKey = new Date().toLocaleDateString("en-US", { weekday: "short" });
  const forecast: WeatherDay[] = [...dayMap.entries()]
    .filter(([key]) => key !== todayKey)
    .slice(0, 3)
    .map(([date, d]) => ({
      date,
      icon: d.icon,
      description: d.description,
      tempMin: Math.round(d.tempMin),
      tempMax: Math.round(d.tempMax),
      hours: d.hours,
    }));

  cache = {
    city: current.name,
    temp: Math.round(current.main.temp),
    feelsLike: Math.round(current.main.feels_like),
    description: current.weather[0]?.description ?? "",
    icon: current.weather[0]?.icon ?? "01d",
    humidity: current.main.humidity,
    forecast,
    fetchedAt: now,
  };

  return cache;
}

/** Clear the in-memory cache (useful for testing). */
export function clearWeatherCache(): void {
  cache = null;
}
