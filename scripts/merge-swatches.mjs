/*
  Merges the hand corrections in swatch-overrides.json over the sampled values
  in out/swatches.json, and records which is which so the provenance of every
  swatch stays visible.

  Output: scripts/out/swatches.final.json
*/
import { readFile, writeFile } from "node:fs/promises";

const sampled = JSON.parse(await readFile("scripts/out/swatches.json", "utf8"));
const overrides = JSON.parse(await readFile("scripts/swatch-overrides.json", "utf8"));

const final = {};
let corrected = 0, kept = 0;

for (const [product, colours] of Object.entries(sampled)) {
  final[product] = {};
  for (const [colour, v] of Object.entries(colours)) {
    const o = overrides[product]?.[colour];
    if (o) {
      final[product][colour] = { hex: o[0], source: "hand-corrected", note: o[1], sampled: v.hex, file: v.file };
      corrected++;
    } else {
      final[product][colour] = { hex: v.hex, source: "sampled", file: v.file };
      kept++;
    }
  }
}

await writeFile("scripts/out/swatches.final.json", JSON.stringify(final, null, 2));
console.log(`${kept + corrected} swatches: ${kept} sampled as-is, ${corrected} hand-corrected`);
for (const [p, c] of Object.entries(final)) {
  const n = Object.values(c).filter((v) => v.source === "hand-corrected").length;
  console.log(`  ${p.padEnd(24)} ${Object.keys(c).length} colours${n ? `, ${n} corrected` : ""}`);
}
