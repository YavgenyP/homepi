import { spawn as nodeSpawn } from "node:child_process";

export type YtResult = {
  id: string;
  title: string;
  duration: number | null;
  thumbnail: string;
};

type SpawnFn = typeof nodeSpawn;

export async function searchYouTube(
  query: string,
  cookiesFile?: string,
  spawnFn: SpawnFn = nodeSpawn
): Promise<YtResult[]> {
  return new Promise((resolve, reject) => {
    const args = [`ytsearch5:${query}`, "-j", "--no-playlist"];
    if (cookiesFile) args.push("--cookies", cookiesFile);

    const proc = spawnFn("yt-dlp", args);
    let stdout = "";

    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`yt-dlp exited ${code}`));
        return;
      }
      type Raw = { id?: string; title?: string; duration?: number | null; thumbnail?: string };
      const results = stdout
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const v = JSON.parse(line) as Raw;
            if (!v.id) return [];
            return [
              {
                id: v.id,
                title: v.title ?? "Unknown",
                duration: v.duration ?? null,
                thumbnail: v.thumbnail ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
              },
            ];
          } catch {
            return [];
          }
        });
      resolve(results);
    });
  });
}
