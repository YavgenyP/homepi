import { createConnection } from "node:net";

export const MPV_SOCKET = process.env.MPV_SOCKET_PATH ?? "/tmp/mpv-socket";

type ConnectFn = typeof createConnection;

/**
 * Send a command to a running mpv instance via its IPC socket.
 * Silently resolves if the socket doesn't exist (nothing playing).
 */
export async function sendMpvCommand(
  command: unknown[],
  socketPath: string = MPV_SOCKET,
  connectFn: ConnectFn = createConnection
): Promise<void> {
  return new Promise((resolve) => {
    const client = connectFn(socketPath as never, () => {
      client.write(JSON.stringify({ command }) + "\n");
      client.end();
    });
    client.on("close", resolve);
    client.on("error", () => resolve()); // socket missing → nothing playing, ignore
    client.setTimeout(1000, () => { client.destroy(); resolve(); });
  });
}
