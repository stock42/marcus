import { expect, test } from "bun:test";
import { resolve } from "node:path";

const assets = [
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "site.webmanifest",
] as const;
const metadataAssets = [
  "apple-touch-icon.png",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "site.webmanifest",
] as const;
const pngAssets = assets.filter((asset) => asset.endsWith(".png"));

test("publishes the complete Marcus favicon set", async () => {
  const layout = await Bun.file(resolve(import.meta.dir, "app/layout.tsx")).text();
  for (const asset of assets) {
    expect(await Bun.file(resolve(import.meta.dir, "../public", asset)).exists()).toBe(true);
  }
  for (const asset of metadataAssets) {
    expect(layout).toContain(`/${asset}`);
  }
  for (const asset of pngAssets) {
    const bytes = new Uint8Array(await Bun.file(resolve(import.meta.dir, "../public", asset)).arrayBuffer());
    expect(bytes[25]).toBe(6); // PNG color type 6: RGBA.
  }

  const manifest = await Bun.file(resolve(import.meta.dir, "../public/site.webmanifest")).json() as {
    icons: Array<{ src: string; sizes: string; type: string }>;
  };
  expect(manifest.icons).toEqual([
    { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
  ]);
});
