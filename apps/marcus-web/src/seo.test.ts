import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { metadata } from "./app/layout";
import robots from "./app/robots";
import sitemap from "./app/sitemap";
import { SITE_DESCRIPTION, SITE_URL, SOCIAL_IMAGE } from "./lib/site";

const pngDimensions = async (path: string): Promise<readonly [number, number]> => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

test("publishes complete social metadata with the supplied Open Graph image", async () => {
  const imagePath = resolve(import.meta.dir, "../public", SOCIAL_IMAGE.slice(1));

  expect(await Bun.file(imagePath).exists()).toBe(true);
  expect(await pngDimensions(imagePath)).toEqual([1731, 909]);
  expect(metadata.description).toBe(SITE_DESCRIPTION);
  expect(metadata.alternates).toMatchObject({ canonical: "/" });
  expect(metadata.openGraph).toMatchObject({
    url: "/",
    siteName: "Marcus Agentic OS",
    images: [{ url: SOCIAL_IMAGE, width: 1731, height: 909 }],
  });
  expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [SOCIAL_IMAGE] });
});

test("exposes indexable robots rules and the canonical landing sitemap", () => {
  expect(robots()).toEqual({
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  });
  expect(sitemap()).toEqual([
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/empresas`, changeFrequency: "monthly", priority: 0.95 },
    { url: `${SITE_URL}/casos-de-uso`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/documentacion`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/studio`, changeFrequency: "weekly", priority: 0.95 },
    { url: `${SITE_URL}/documentacion/sdk`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${SITE_URL}/documentacion/markdown`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${SITE_URL}/documentacion/tools`, changeFrequency: "monthly", priority: 0.9 },
  ]);
});

test("publishes an LLM-readable root index with canonical product and authoring paths", async () => {
  const content = await Bun.file(resolve(import.meta.dir, "../public/llms.txt")).text();

  expect(content).toStartWith("# Marcus Agentic OS\n\n>");
  expect(content).toContain("https://projectmarcus.com/documentacion");
  expect(content).toContain("https://projectmarcus.com/casos-de-uso");
  expect(content).toContain("https://projectmarcus.com/empresas");
  expect(content).toContain("https://projectmarcus.com/studio");
  expect(content).toContain("MCP");
});

test("renders software and publisher structured data plus the Stock42 credit", async () => {
  const page = await Bun.file(resolve(import.meta.dir, "app/page.tsx")).text();

  expect(page).toContain('"@type": "SoftwareApplication"');
  expect(page).toContain('"@type": "Organization"');
  expect(page).toContain('href="https://stock42.com"');
  expect(page).toContain("Powered by");
});
