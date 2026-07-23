/*
  Malaysian state names <-> ISO 3166-2 subdivision codes.

  Kalima's checkout collects a human state name ("Selangor"); EasyParcel wants
  the ISO code ("MY-10"). Getting this wrong doesn't error — it silently prices
  the wrong lane, and West/East Malaysia differ by several ringgit — so the
  mapping is explicit and covers the spellings people actually type.
*/
export const STATE_TO_ISO: Record<string, string> = {
  johor: "MY-01",
  kedah: "MY-02",
  kelantan: "MY-03",
  melaka: "MY-04",
  malacca: "MY-04",
  "negeri sembilan": "MY-05",
  pahang: "MY-06",
  penang: "MY-07",
  "pulau pinang": "MY-07",
  perak: "MY-08",
  perlis: "MY-09",
  selangor: "MY-10",
  terengganu: "MY-11",
  sabah: "MY-12",
  sarawak: "MY-13",
  "kuala lumpur": "MY-14",
  "wilayah persekutuan kuala lumpur": "MY-14",
  labuan: "MY-15",
  putrajaya: "MY-16",
};

/** East Malaysia — materially different rates, and the usual source of
    "why was my postage wrong" complaints. */
const EAST_MALAYSIA = new Set(["MY-12", "MY-13", "MY-15"]);

export function stateToIso(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  // Already an ISO code?
  if (/^MY-\d{2}$/i.test(name.trim())) return name.trim().toUpperCase();
  return STATE_TO_ISO[key] ?? null;
}

export function isEastMalaysia(iso: string | null | undefined): boolean {
  return iso ? EAST_MALAYSIA.has(iso.toUpperCase()) : false;
}
