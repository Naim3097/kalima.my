/*
  Builds one contact sheet per product: each colourway's photo with the sampled
  swatch directly beneath it, so a wrong sample is obvious at a glance.
  Written for eyeballing, not for shipping — output is gitignored scratch.
*/
import sharp from "sharp";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "public/products/WEBSITE KALIMA";
const OUT = "scripts/out/sheets";
const W = 150, PH = 200, SH = 54;

const swatches = JSON.parse(await readFile("scripts/out/swatches.json", "utf8"));
const dirs = Object.fromEntries(
  (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => [d.name.trim(), d.name])
);
await mkdir(OUT, { recursive: true });

for (const [product, colours] of Object.entries(swatches)) {
  const entries = Object.entries(colours);
  const width = W * entries.length;
  const height = PH + SH;

  const photos = await Promise.all(
    entries.map(async ([, v], i) => ({
      input: await sharp(join(ROOT, dirs[product], v.file)).resize(W, PH, { fit: "cover" }).png().toBuffer(),
      left: i * W, top: 0,
    }))
  );

  const labels = entries.map(([name, v], i) => `
    <rect x="${i * W}" y="${PH}" width="${W}" height="${SH}" fill="${v.hex}"/>
    <text x="${i * W + 6}" y="${PH + 18}" font-family="monospace" font-size="11"
          fill="white" stroke="black" stroke-width="0.4">${name.slice(0, 16)}</text>
    <text x="${i * W + 6}" y="${PH + 34}" font-family="monospace" font-size="11"
          fill="white" stroke="black" stroke-width="0.4">${v.hex}</text>`).join("");

  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite([...photos, { input: Buffer.from(`<svg width="${width}" height="${height}">${labels}</svg>`), top: 0, left: 0 }])
    .png()
    .toFile(join(OUT, `${product.replace(/\s+/g, "-").toLowerCase()}.png`));

  console.log(`${product}: ${entries.length} colourways`);
}
