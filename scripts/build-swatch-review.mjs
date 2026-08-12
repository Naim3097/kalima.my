/*
  Builds the swatch approval page: every colourway's photo beside the hex that
  will become its swatch dot, so a wrong colour is obvious and correctable
  before any of it reaches the database.

  Thumbnails are inlined as data URIs — the Artifact CSP blocks external hosts.

  Output: scratchpad/swatch-review.html
*/
import sharp from "sharp";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "public/products/WEBSITE KALIMA";
const OUT = process.argv[2] || "scratchpad/swatch-review.html";

/* Catalogue facts, from Shopee listings and the sizing charts in each folder. */
const META = {
  "ITALIAN CHIFFON SHAWL": { name: "Exclusive Shawl Italian Chiffon", rm: 59, sizes: ["Free size"], fabric: "100% premium Italian chiffon", cat: "Accessories" },
  "KURTA ZAID": { name: "Kurta Zaid", rm: 99, sizes: ["S", "M", "L", "XL", "2XL", "3XL"], fabric: "Premium polyester", cat: "Men" },
  "KURTA YASIR": { name: "Kurta Yasir", rm: 125, sizes: ["S", "M", "L", "XL", "2XL", "3XL"], fabric: "Polyester", cat: "Men" },
  "ANNA TOP": { name: "Anna Top", rm: 130, sizes: ["Free size"], fabric: "Chiffon", cat: "Women", note: "Sold out on Shopee" },
  "LUNA PALAZO": { name: "Luna Palazzo with Lining", rm: 170, sizes: ["S/M", "L/XL"], fabric: "Chiffon, lined", cat: "Women" },
  "ANAYA COTTON": { name: "Anaya Cotton Top with Pants", rm: 200, sizes: ["S/M", "L/XL"], fabric: "100% breathable cotton", cat: "Women" },
  "DANISYA SETS": { name: "Danisya Set Top with Palazzo", rm: 200, sizes: ["S/M", "L/XL"], fabric: "Premium satin", cat: "Women" },
  "RUWA CAFTAN": { name: "Ruwa Caftan", rm: 250, sizes: ["S/M", "L/XL"], fabric: "Premium satin", cat: "Women" },
  "SERRA SCALLOP": { name: "Serra Scallop Cardigan Abaya", rm: 395, sizes: ["S", "M", "L-XL"], fabric: "Embroidery over premium satin", cat: "Women", note: "Not listed on Shopee" },
};
const ORDER = Object.keys(META);

const swatches = JSON.parse(await readFile("scripts/out/swatches.final.json", "utf8"));
const dirs = Object.fromEntries(
  (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => [d.name.trim(), d.name])
);

async function thumb(product, file) {
  const buf = await sharp(join(ROOT, dirs[product], file))
    .resize(220, 293, { fit: "cover", position: "top" })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let totalColours = 0, totalCorrected = 0, totalVariants = 0;
const sections = [];

for (const product of ORDER) {
  const colours = swatches[product];
  if (!colours) continue;
  const m = META[product];
  const entries = Object.entries(colours);
  const variants = entries.length * m.sizes.length;
  totalColours += entries.length;
  totalVariants += variants;

  const cards = [];
  for (const [colour, v] of entries) {
    const corrected = v.source === "hand-corrected";
    if (corrected) totalCorrected++;
    cards.push(`
      <figure class="card${corrected ? " card--fixed" : ""}">
        <img src="${await thumb(product, v.file)}" alt="${esc(m.name)} in ${esc(colour)}" loading="lazy" />
        <figcaption>
          <span class="chip" style="background:${v.hex}"></span>
          <span class="cname">${esc(colour)}</span>
          <span class="chex">${v.hex}</span>
          ${corrected ? `<span class="fix" title="${esc(v.note)}">corrected from ${v.sampled}</span>` : ""}
        </figcaption>
      </figure>`);
  }

  sections.push(`
    <section class="product" id="${product.toLowerCase().replace(/\s+/g, "-")}">
      <header class="phead">
        <div>
          <h2>${esc(m.name)}</h2>
          <p class="pmeta">${m.cat} · ${esc(m.fabric)}${m.note ? ` · <em>${esc(m.note)}</em>` : ""}</p>
        </div>
        <dl class="pstats">
          <div><dt>Price</dt><dd>RM${m.rm}</dd></div>
          <div><dt>Sizes</dt><dd>${m.sizes.join(" · ")}</dd></div>
          <div><dt>Colours</dt><dd>${entries.length}</dd></div>
          <div><dt>Variants</dt><dd>${variants}</dd></div>
        </dl>
      </header>
      <div class="grid">${cards.join("")}</div>
    </section>`);
}

const html = `<title>Kalima — colourway approval</title>
<style>
  :root {
    --navy-900:#20233a; --navy:#383c61; --navy-400:#686c8f; --navy-300:#9b9cb0;
    --cream:#f7f3ec; --cream-50:#fbf9f5; --beige:#efe7db; --beige-300:#e3d7c6;
    --ground:var(--cream); --surface:var(--cream-50); --ink:var(--navy);
    --ink-soft:var(--navy-400); --ink-faint:var(--navy-300); --line:var(--beige-300);
    --flag:#9b5c2c;
    --serif:"Playfair Display",Georgia,"Times New Roman",serif;
    --sans:"Jost",ui-sans-serif,system-ui,"Segoe UI",sans-serif;
    --luxe:0.18em;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#191b2b; --surface:#20233a; --ink:#ece9e2; --ink-soft:#a7a9be;
      --ink-faint:#75789a; --line:#33375a; --flag:#d99a5b;
    }
  }
  :root[data-theme="dark"] {
    --ground:#191b2b; --surface:#20233a; --ink:#ece9e2; --ink-soft:#a7a9be;
    --ink-faint:#75789a; --line:#33375a; --flag:#d99a5b;
  }

  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--ink);
    font-family:var(--sans); font-size:15px; line-height:1.6;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1180px; margin:0 auto; padding:56px 24px 96px; }

  .masthead { border-bottom:1px solid var(--line); padding-bottom:32px; margin-bottom:8px; }
  .eyebrow {
    font-size:11px; letter-spacing:var(--luxe); text-transform:uppercase;
    color:var(--ink-soft); margin:0 0 18px; display:flex; align-items:center; gap:12px;
  }
  .eyebrow::before { content:""; width:36px; height:1px; background:var(--ink-faint); }
  h1 { font-family:var(--serif); font-weight:400; font-size:clamp(30px,4.4vw,46px);
       line-height:1.12; margin:0 0 14px; text-wrap:balance; }
  .lede { margin:0; max-width:62ch; color:var(--ink-soft); font-size:15.5px; }

  .totals { display:flex; flex-wrap:wrap; gap:36px; margin:30px 0 0; padding:0; list-style:none; }
  .totals div { display:flex; flex-direction:column; gap:2px; }
  .totals dt { font-size:10.5px; letter-spacing:var(--luxe); text-transform:uppercase; color:var(--ink-soft); }
  .totals dd { margin:0; font-family:var(--serif); font-size:27px; font-variant-numeric:tabular-nums; }

  .note {
    margin:34px 0 0; padding:16px 18px; background:var(--surface);
    border-left:2px solid var(--flag); font-size:13.5px; color:var(--ink-soft);
  }
  .note strong { color:var(--ink); font-weight:500; }

  .product { padding-top:52px; }
  .phead {
    display:flex; flex-wrap:wrap; gap:20px 40px; align-items:flex-end;
    justify-content:space-between; padding-bottom:16px; border-bottom:1px solid var(--line);
  }
  .phead h2 { font-family:var(--serif); font-weight:400; font-size:25px; margin:0; }
  .pmeta { margin:4px 0 0; font-size:12.5px; letter-spacing:0.04em; color:var(--ink-soft); }
  .pmeta em { font-style:normal; color:var(--flag); }
  .pstats { display:flex; gap:30px; margin:0; }
  .pstats div { display:flex; flex-direction:column; gap:1px; }
  .pstats dt { font-size:10px; letter-spacing:var(--luxe); text-transform:uppercase; color:var(--ink-faint); }
  .pstats dd { margin:0; font-size:14px; font-variant-numeric:tabular-nums; }

  .grid {
    display:grid; gap:18px; margin-top:24px;
    grid-template-columns:repeat(auto-fill,minmax(148px,1fr));
  }
  .card { margin:0; background:var(--surface); border:1px solid var(--line); }
  .card img { display:block; width:100%; aspect-ratio:3/4; object-fit:cover; }
  figcaption { display:grid; grid-template-columns:auto 1fr; gap:2px 9px;
               align-items:center; padding:11px 12px 12px; }
  .chip { width:19px; height:19px; grid-row:span 2; border:1px solid rgba(0,0,0,.16); }
  .cname { font-size:11.5px; letter-spacing:0.05em; text-transform:uppercase; }
  .chex { font-size:11.5px; font-variant-numeric:tabular-nums; color:var(--ink-soft);
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .fix { grid-column:1/-1; margin-top:7px; padding-top:7px; border-top:1px solid var(--line);
         font-size:10.5px; letter-spacing:0.04em; color:var(--flag); }
  .card--fixed .chip { box-shadow:0 0 0 2px var(--ground), 0 0 0 3px var(--flag); }

  a:focus-visible, [tabindex]:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Catalogue migration · colourway approval</p>
    <h1>Every colour, against the garment it came from</h1>
    <p class="lede">
      These hex values become the swatch dots shoppers click to change colour on kalima.my.
      Each was read from your own product photography. Check that every dot matches the garment
      beside it — anything wrong is a one-line fix now, and a customer complaint later.
    </p>
    <dl class="totals">
      <div><dt>Products</dt><dd>${ORDER.length}</dd></div>
      <div><dt>Colourways</dt><dd>${totalColours}</dd></div>
      <div><dt>Variants</dt><dd>${totalVariants}</dd></div>
      <div><dt>Hand-corrected</dt><dd>${totalCorrected}</dd></div>
    </dl>
    <p class="note">
      <strong>${totalCorrected} of ${totalColours} were corrected by hand.</strong>
      Colour was read automatically from each photo, which works cleanly on the plain-backdrop
      studio shots — both kurtas needed no correction at all. On location shots the archway walls
      and pale paving often out-voted the garment, so those were set by eye and are marked below.
      Prints can only ever be approximated by a single dot: their values are the dominant accent,
      chosen to stay distinguishable from one another.
    </p>
  </header>
  ${sections.join("")}
</div>`;

await mkdir(OUT.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await writeFile(OUT, html);
console.log(`${OUT} — ${ORDER.length} products, ${totalColours} colourways, ${totalVariants} variants, ${(html.length / 1024 / 1024).toFixed(2)} MB`);
