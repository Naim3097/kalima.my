/*
  Minimal RFC-4180 CSV reader/writer.

  Hand-rolled rather than pulling a dependency: the catalog import/export is the
  only consumer and the format we need is small. It does handle the parts that
  actually bite — quoted fields containing commas, escaped "" quotes, embedded
  newlines, CRLF line endings and a leading UTF-8 BOM (Excel writes one).
*/

/** Splits CSV text into rows of raw cell strings. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, ""); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // Ignore lines that are entirely empty (e.g. a trailing newline).
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ",") {
      endCell();
      i += 1;
    } else if (ch === "\r") {
      // Swallow CR; the following LF ends the row.
      i += 1;
    } else if (ch === "\n") {
      endRow();
      i += 1;
    } else {
      cell += ch;
      i += 1;
    }
  }
  // Flush whatever the last line left behind.
  if (cell !== "" || row.length) endRow();
  return rows;
}

/*
  Parses into objects keyed by the header row, lower-cased and trimmed so
  "Color Name", "color_name" and "COLOR NAME " all land on the same key.
*/
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((key, idx) => {
      if (key) rec[key] = (cells[idx] ?? "").trim();
    });
    return rec;
  });
}

type Cell = string | number | boolean | null | undefined;

/** Quotes only when needed; always CRLF, which Excel and Sheets both expect. */
export function toCsv(rows: Cell[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          if (value === null || value === undefined) return "";
          const s = String(value);
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
