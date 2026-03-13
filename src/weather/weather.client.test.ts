import { describe, it, expect, beforeEach, vi } from "vitest";
import { getWeather, clearWeatherCache } from "./weather.client.js";

beforeEach(() => clearWeatherCache());

const CURRENT_RESPONSE = {
  name: "Tel Aviv",
  main: { temp: 24.6, feels_like: 23.1, humidity: 65 },
  weather: [{ description: "clear sky", icon: "01d" }],
};

const FORECAST_RESPONSE = {
  list: [
    // Tomorrow entries (3h intervals)
    { dt: Math.floor(Date.now() / 1000) + 86400,      main: { temp_min: 18, temp_max: 26 }, weather: [{ description: "few clouds", icon: "02d" }] },
    { dt: Math.floor(Date.now() / 1000) + 86400 + 10800, main: { temp_min: 17, temp_max: 28 }, weather: [{ description: "few clouds", icon: "02d" }] },
    // Day after tomorrow
    { dt: Math.floor(Date.now() / 1000) + 172800, main: { temp_min: 20, temp_max: 30 }, weather: [{ description: "sunny", icon: "01d" }] },
    // Three days out
    { dt: Math.floor(Date.now() / 1000) + 259200, main: { temp_min: 15, temp_max: 22 }, weather: [{ description: "rain", icon: "10d" }] },
  ],
};

function makeFetch(ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 401,
    json: vi.fn().mockImplementation(async function(this: unknown) {
      // Return different data based on call count
      const calls = (makeFetch as unknown as { _count?: number })._count ?? 0;
      return calls === 0 ? CURRENT_RESPONSE : FORECAST_RESPONSE;
    }),
  });
}

describe("getWeather", () => {
  it("fetches current weather and forecast", async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      const data = call === 0 ? CURRENT_RESPONSE : FORECAST_RESPONSE;
      call++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    });

    const data = await getWeather("key", "32.07", "34.78", fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(data.city).toBe("Tel Aviv");
    expect(data.temp).toBe(25);         // rounded
    expect(data.feelsLike).toBe(23);
    expect(data.humidity).toBe(65);
    expect(data.icon).toBe("01d");
    expect(data.description).toBe("clear sky");
    expect(data.forecast.length).toBeGreaterThanOrEqual(1);
  });

  it("caches result — second call reuses data without fetching", async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      const data = call === 0 ? CURRENT_RESPONSE : FORECAST_RESPONSE;
      call++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    });

    await getWeather("key", "32", "34", fetchFn);
    await getWeather("key", "32", "34", fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2); // 2 for the first call (current+forecast), 0 for second
  });

  it("throws when current weather API fails", async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      const ok = call > 0;
      call++;
      return Promise.resolve({ ok, status: ok ? 200 : 401, json: () => Promise.resolve({}) });
    });

    await expect(getWeather("bad-key", "0", "0", fetchFn)).rejects.toThrow("OWM current");
  });

  it("throws when forecast API fails", async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      const ok = call === 0;
      call++;
      return Promise.resolve({
        ok,
        status: ok ? 200 : 401,
        json: () => Promise.resolve(ok ? CURRENT_RESPONSE : {}),
      });
    });

    await expect(getWeather("key", "0", "0", fetchFn)).rejects.toThrow("OWM forecast");
  });

  it("OWM icon URLs are well-formed", async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      const data = call === 0 ? CURRENT_RESPONSE : FORECAST_RESPONSE;
      call++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    });

    const data = await getWeather("key", "32", "34", fetchFn);
    expect(data.icon).toMatch(/^\d\d[dn]$/);
  });
});
