import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export type PhotoSyncResult = {
  downloaded: number;
  skipped: number;
  errors: number;
};

/**
 * Sync JPEG/PNG files from a Google Drive folder to a local directory.
 * Uses the same service account key file as GCal.
 */
export async function syncPhotosFromDrive(
  keyFile: string,
  folderId: string,
  destDir: string
): Promise<PhotoSyncResult> {
  fs.mkdirSync(destDir, { recursive: true });

  const auth = new google.auth.GoogleAuth({ keyFile, scopes: [DRIVE_SCOPE] });
  const drive = google.drive({ version: "v3", auth });

  // List image files in the folder
  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png') and trashed=false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
  });

  const files = listRes.data.files ?? [];
  let downloaded = 0, skipped = 0, errors = 0;

  for (const file of files) {
    if (!file.id || !file.name) continue;
    const destPath = path.join(destDir, file.name);
    if (fs.existsSync(destPath)) { skipped++; continue; }

    try {
      const res = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "stream" }
      );
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(destPath);
        (res.data as NodeJS.ReadableStream).pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });
      downloaded++;
    } catch {
      errors++;
    }
  }

  return { downloaded, skipped, errors };
}

/**
 * List locally synced photo filenames (sorted alphabetically).
 */
export function listLocalPhotos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
}
