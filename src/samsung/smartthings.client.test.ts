import { describe, it, expect, vi } from "vitest";
import { sendDeviceCommand } from "./smartthings.client.js";

const DEVICE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TOKEN = "test-token";

function makeFetch(status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
  } as Response);
}

describe("sendDeviceCommand", () => {
  it("sends POST to correct URL with Bearer auth for 'on'", async () => {
    const fetchFn = makeFetch();
    await sendDeviceCommand(DEVICE_ID, "on", TOKEN, fetchFn);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://api.smartthings.com/v1/devices/${DEVICE_ID}/commands`
    );
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`
    );
    expect(init.method).toBe("POST");
  });

  it("sends correct body for 'on' command", async () => {
    const fetchFn = makeFetch();
    await sendDeviceCommand(DEVICE_ID, "on", TOKEN, fetchFn);

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      commands: [{ component: "main", capability: "switch", command: "on" }],
    });
  });

  it("sends correct body for 'off' command", async () => {
    const fetchFn = makeFetch();
    await sendDeviceCommand(DEVICE_ID, "off", TOKEN, fetchFn);

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.commands[0].command).toBe("off");
  });

  it("throws with status code on non-ok response", async () => {
    const fetchFn = makeFetch(400);
    await expect(
      sendDeviceCommand(DEVICE_ID, "on", TOKEN, fetchFn)
    ).rejects.toThrow("400");
  });
});
