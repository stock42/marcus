import { expect, test } from "bun:test";
import { resolve } from "node:path";

const pngDimensions = async (path: string): Promise<readonly [number, number]> => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

test("publishes the adapted official Marcus logo", async () => {
  const logoPath = resolve(import.meta.dir, "../public/marcus-logo.png");
  const page = await Bun.file(resolve(import.meta.dir, "app/page.tsx")).text();
  const css = await Bun.file(resolve(import.meta.dir, "app/globals.css")).text();

  expect(await Bun.file(logoPath).exists()).toBe(true);
  expect(await pngDimensions(logoPath)).toEqual([606, 540]);
  const bytes = new Uint8Array(await Bun.file(logoPath).arrayBuffer());
  expect(bytes[25]).toBe(6); // PNG color type 6: RGBA.
  expect(page).toContain('src="/marcus-logo.png"');
  expect(css).toContain('url("/marcus-logo.png")');
});
