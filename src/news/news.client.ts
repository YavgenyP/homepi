export type NewsItem = { title: string; link: string };

let cache: { items: NewsItem[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function getNews(
  rssUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<NewsItem[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.items;

  const r = await fetchFn(rssUrl);
  if (!r.ok) throw new Error(`RSS fetch failed: ${r.status}`);
  const xml = await r.text();

  const items: NewsItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const titleM = block.match(
      /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/
    );
    const linkM = block.match(/<link[^>]*>([\s\S]*?)<\/link>/);

    const raw = titleM?.[1]?.trim() ?? "";
    const title = raw
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "");
    const link = linkM?.[1]?.trim() ?? "";

    if (title && link) items.push({ title, link });
    if (items.length >= 10) break;
  }

  cache = { items, fetchedAt: now };
  return items;
}

export function clearNewsCache(): void {
  cache = null;
}
