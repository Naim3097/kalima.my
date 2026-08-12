/*
  Samples a representative swatch hex from each colourway photo.

  A fixed crop doesn't work: the garment sits in a different part of every
  frame (palazzo pants low, shawls high, sets full-length), so a central band
  catches skin or wall as often as fabric.

  Instead we use both signals we have. The PHOTO tells us which colours are
  actually present — k-means over the whole frame gives the handful of colours
  that matter. The FILENAME tells us which of those is the garment: a file
  called MAGENTA.jpg is a magenta dress against whatever background. So we
  cluster, then pick the cluster nearest the name's reference colour in CIELAB
  (perceptual distance, so "near" means near to the eye, not in RGB space).

  Prints have no single reference colour ("DREAMY GARDEN"), so those fall back
  to the largest cluster that isn't background or skin.

  Output: scripts/out/swatches.json  { "<folder>": { "<COLOUR>": {hex, method} } }
*/
import sharp from "sharp";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "public/products/WEBSITE KALIMA";
const SKIP = /sizing chart|video|close ?up|closeup|extra|whatsapp/i;

/* What each colour name should look like, roughly. Only used to choose
   between colours the photo actually contains — never used as the output. */
const REFERENCE = {
  black: "#1a1a1a", "polka black": "#1a1a1a",
  burgundy: "#6b1f2e", maroon: "#5c1a24", raspberry: "#b3446c",
  magenta: "#c2186b", blush: "#e8b4b8", "dusty lily": "#b98b9a",
  cream: "#f0e6d2", butter: "#f3e3a3", "sand beige": "#d8c3a5",
  sand: "#d8c3a5", nude: "#d9b99b", latte: "#b8926a", mocha: "#7b5e4b",
  silver: "#c0c0c0", grey: "#808080",
  green: "#3a5f3a", "kelly green": "#4cbb17", "green apple": "#8db600",
  emerald: "#046307", olive: "#6b7d3a",
  "teal green": "#0f766e", "teal blue": "#2a6f80", "steel blue": "#4682b4",
  navy: "#1f2a44", brick: "#9c4a2f",
};

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");

/* sRGB -> CIELAB, so distances match how different two colours look. */
function lab([r, g, b]) {
  const f = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * k(y) - 16, 500 * (k(x) - k(y)), 200 * (k(y) - k(z))];
}
const dist = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/* Skin, so a model's arms don't win the vote. */
function isSkin([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return r > 95 && g > 40 && b > 20 && r > g && g > b && r - min > 15 && max - min < 130 && r < 245;
}
const isPaper = ([r, g, b]) => r > 235 && g > 235 && b > 235;

function kmeans(pixels, k = 7, iters = 12) {
  let centres = Array.from({ length: k }, (_, i) => pixels[Math.floor((i + 0.5) * pixels.length / k)]);
  let groups = [];
  for (let it = 0; it < iters; it++) {
    groups = Array.from({ length: k }, () => []);
    for (const p of pixels) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (p[0] - centres[c][0]) ** 2 + (p[1] - centres[c][1]) ** 2 + (p[2] - centres[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      groups[best].push(p);
    }
    centres = groups.map((g, i) =>
      g.length ? [0, 1, 2].map((c) => g.reduce((s, p) => s + p[c], 0) / g.length) : centres[i]);
  }
  return centres
    .map((c, i) => ({ rgb: c, size: groups[i].length, members: groups[i] }))
    .filter((c) => c.size > pixels.length * 0.02)
    .sort((a, b) => b.size - a.size);
}

/*
  A cluster's mean sits in its shadows: draped fabric is mostly fold, so the
  average of "burgundy" reads near-black and "blush" reads grey. Take the
  median of the cluster's better-lit half instead — that's the colour a
  shopper would name if handed the garment.
*/
function litColour(cluster) {
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sorted = [...cluster.members].sort((a, b) => lum(a) - lum(b));
  const upper = sorted.slice(Math.floor(sorted.length * 0.55), Math.floor(sorted.length * 0.9));
  const pool = upper.length ? upper : sorted;
  return [0, 1, 2].map((c) => pool.reduce((s, p) => s + p[c], 0) / pool.length);
}

async function sampleHex(file, colourName) {
  const { data, info } = await sharp(file).resize(90, 120, { fit: "inside" }).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });

  /* Keep only the box the model stands in. Walls and tiled floors otherwise
     dominate every count, which is what sends prints grey. */
  const all = [];
  const x0 = info.width * 0.25, x1 = info.width * 0.75;
  const y0 = info.height * 0.22, y1 = info.height * 0.88;
  for (let i = 0; i < data.length; i += 3) {
    const px = (i / 3) % info.width, py = Math.floor(i / 3 / info.width);
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    all.push([data[i], data[i + 1], data[i + 2]]);
  }

  const candidates = all.filter((p) => !isPaper(p) && !isSkin(p));
  const clusters = kmeans(candidates.length > 500 ? candidates : all);
  if (!clusters.length) return { hex: "#888888", method: "fallback" };

  const ref = REFERENCE[colourName.toLowerCase()];
  if (!ref) return { hex: toHex(litColour(clusters[0])), method: "largest-cluster" };

  const target = hexToRgb(ref);
  const best = clusters
    .map((c) => ({ ...c, d: dist(c.rgb, target) }))
    .sort((a, b) => a.d - b.d)[0];

  return { hex: toHex(litColour(best)), method: "name-matched", confidence: Math.round(best.d) };
}

const out = {};
const folders = (await readdir(ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory()).map((d) => d.name);

for (const folder of folders) {
  const files = (await readdir(join(ROOT, folder)))
    .filter((f) => /\.(jpe?g|png)$/i.test(f) && !SKIP.test(f)).sort();

  out[folder.trim()] = {};
  for (const f of files) {
    const name = f.replace(/\.(jpe?g|png)$/i, "").replace(/_$/, "").trim();
    out[folder.trim()][name] = { ...(await sampleHex(join(ROOT, folder, f), name)), file: f };
  }
}

await mkdir("scripts/out", { recursive: true });
await writeFile("scripts/out/swatches.json", JSON.stringify(out, null, 2));

for (const [folder, colours] of Object.entries(out)) {
  console.log(`\n${folder}`);
  for (const [name, v] of Object.entries(colours)) {
    const flag = v.confidence > 45 ? "  <-- check" : "";
    console.log(`  ${v.hex}  ${name.padEnd(16)} ${v.method}${v.confidence != null ? ` d=${v.confidence}` : ""}${flag}`);
  }
}
