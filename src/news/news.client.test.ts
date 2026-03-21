import { describe, it, expect, beforeEach } from "vitest";
import { getNews, clearNewsCache } from "./news.client.js";

beforeEach(() => clearNewsCache());

const RSS_SIMPLE = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>First headline</title>
      <link>https://example.com/1</link>
    </item>
    <item>
      <title><![CDATA[Second headline & more]]></title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>`;

function mockFetch(xml: string, status = 200) {
  return async (_url: string) =>
    ({
      ok: status === 200,
      status,
      text: async () => xml,
    }) as Response;
}

describe("getNews", () => {
  it("parses plain title and link", async () => {
    const items = await getNews("https://rss.test/feed", mockFetch(RSS_SIMPLE));
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ title: "First headline", link: "https://example.com/1" });
  });

  it("strips CDATA and decodes HTML entities", async () => {
    const items = await getNews("https://rss.test/feed", mockFetch(RSS_SIMPLE));
    expect(items[1].title).toBe("Second headline & more");
  });

  it("returns cached result on second call", async () => {
    let callCount = 0;
    const fetchFn = async (_url: string) => {
      callCount++;
      return { ok: true, status: 200, text: async () => RSS_SIMPLE } as Response;
    };
    await getNews("https://rss.test/feed", fetchFn);
    await getNews("https://rss.test/feed", fetchFn);
    expect(callCount).toBe(1);
  });

  it("re-fetches after clearNewsCache()", async () => {
    let callCount = 0;
    const fetchFn = async (_url: string) => {
      callCount++;
      return { ok: true, status: 200, text: async () => RSS_SIMPLE } as Response;
    };
    await getNews("https://rss.test/feed", fetchFn);
    clearNewsCache();
    await getNews("https://rss.test/feed", fetchFn);
    expect(callCount).toBe(2);
  });

  it("throws when feed returns non-200", async () => {
    await expect(getNews("https://rss.test/feed", mockFetch("", 503))).rejects.toThrow("RSS fetch failed");
  });

  it("limits results to 10 items", async () => {
    const items = Array.from(
      { length: 15 },
      (_, i) => `<item><title>Item ${i}</title><link>https://x.com/${i}</link></item>`
    ).join("\n");
    const xml = `<rss><channel>${items}</channel></rss>`;
    const result = await getNews("https://rss.test/feed", mockFetch(xml));
    expect(result).toHaveLength(10);
  });
});
