export type SmartThingsCommandFn = (
  smartthingsDeviceId: string,
  command: "on" | "off"
) => Promise<void>;

export async function sendDeviceCommand(
  smartthingsDeviceId: string,
  command: "on" | "off",
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const url = `https://api.smartthings.com/v1/devices/${smartthingsDeviceId}/commands`;
  const body = JSON.stringify({
    commands: [
      {
        component: "main",
        capability: "switch",
        command,
      },
    ],
  });

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`SmartThings API error: ${response.status} ${response.statusText}`);
  }
}
