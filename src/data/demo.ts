/*
  Demo datasets for the client-presentation mockups (admin, account, affiliate,
  checkout). Everything here is sample data illustrating Phases 2–9 features;
  real data arrives with Supabase + live integrations.
*/

export type Channel = "web" | "shopee" | "tiktok";

export const CHANNEL_LABEL: Record<Channel, string> = {
  web: "kalima.my",
  shopee: "Shopee",
  tiktok: "TikTok Shop",
};

// ---- Orders ----
export type DemoOrder = {
  id: string;
  customer: string;
  channel: Channel;
  items: string;
  total: number;
  status: "pending" | "paid" | "packed" | "shipped" | "delivered" | "cancelled";
  date: string;
  tracking?: string;
  courier?: string;
};

export const ORDERS: DemoOrder[] = [
  { id: "KLM-10248", customer: "Nurul Aisyah", channel: "web", items: "Maya Chiffon (M), Satin Shawl", total: 339, status: "paid", date: "17 Jul, 10:42" },
  { id: "SPE-88121", customer: "Siti Khadijah", channel: "shopee", items: "Sofea Dress (L)", total: 269, status: "paid", date: "17 Jul, 09:58" },
  { id: "KLM-10247", customer: "Farah Hanim", channel: "web", items: "Bella Dress (S)", total: 289, status: "shipped", date: "16 Jul, 22:14", tracking: "EP934812734MY", courier: "J&T Express" },
  { id: "TTS-40917", customer: "Aina Sofia", channel: "tiktok", items: "Ruwa Kaftan (M)", total: 259, status: "packed", date: "16 Jul, 20:31" },
  { id: "KLM-10246", customer: "Melissa Tan", channel: "web", items: "Amanda Sparkle (M), Rayon Inner ×2", total: 350, status: "delivered", date: "15 Jul, 16:09", tracking: "EP934771093MY", courier: "Pos Laju" },
  { id: "SPE-88054", customer: "Dayang Nurfaizah", channel: "shopee", items: "Stretchable Rayon Inner ×3", total: 150, status: "delivered", date: "15 Jul, 11:47" },
  { id: "KLM-10245", customer: "Priya Nair", channel: "web", items: "Kurung Seri (M)", total: 320, status: "delivered", date: "14 Jul, 19:22", tracking: "EP934702218MY", courier: "J&T Express" },
  { id: "TTS-40816", customer: "Hani Zulaikha", channel: "tiktok", items: "Maya Chiffon (S)", total: 250, status: "cancelled", date: "14 Jul, 08:15" },
];

// ---- Customers ----
export type DemoCustomer = {
  name: string;
  phone: string;
  tags: string[];
  orders: number;
  ltv: number;
  points: number;
  tier: "Member" | "Gold" | "Platinum";
  consent: boolean;
};

export const CUSTOMERS: DemoCustomer[] = [
  { name: "Nurul Aisyah", phone: "+60 12-345 6789", tags: ["VIP", "Raya 2026"], orders: 12, ltv: 3480, points: 1250, tier: "Platinum", consent: true },
  { name: "Melissa Tan", phone: "+60 17-882 4410", tags: ["Maya launch"], orders: 8, ltv: 2140, points: 890, tier: "Gold", consent: true },
  { name: "Farah Hanim", phone: "+60 13-660 1275", tags: ["New"], orders: 2, ltv: 539, points: 289, tier: "Member", consent: true },
  { name: "Siti Khadijah", phone: "+60 19-773 0921", tags: ["Shopee"], orders: 5, ltv: 1105, points: 0, tier: "Member", consent: false },
  { name: "Priya Nair", phone: "+60 16-204 8837", tags: ["VIP"], orders: 9, ltv: 2670, points: 1015, tier: "Gold", consent: true },
  { name: "Aina Sofia", phone: "+60 11-5502 9184", tags: ["TikTok"], orders: 3, ltv: 707, points: 320, tier: "Member", consent: true },
];

// ---- Campaigns (bulk messaging) ----
export type DemoCampaign = {
  name: string;
  channel: "WhatsApp" | "Email";
  segment: string;
  recipients: number;
  delivered: number;
  read: number;
  status: "sent" | "scheduled" | "draft";
  date: string;
};

export const CAMPAIGNS: DemoCampaign[] = [
  { name: "Maya Collection Launch", channel: "WhatsApp", segment: "All consented customers", recipients: 2431, delivered: 2398, read: 1876, status: "sent", date: "12 Jul" },
  { name: "Raya Private Sale — VIP", channel: "WhatsApp", segment: "Tier: Gold + Platinum", recipients: 412, delivered: 409, read: 388, status: "sent", date: "8 Jul" },
  { name: "Abandoned bag reminder", channel: "WhatsApp", segment: "Bag > RM200, inactive 48h", recipients: 67, delivered: 66, read: 51, status: "sent", date: "daily, auto" },
  { name: "Kalima Club July newsletter", channel: "Email", segment: "Newsletter subscribers", recipients: 5108, delivered: 5031, read: 2266, status: "sent", date: "5 Jul" },
  { name: "Merdeka teaser broadcast", channel: "WhatsApp", segment: "Purchased in last 90 days", recipients: 1180, delivered: 0, read: 0, status: "scheduled", date: "28 Aug, 10:00" },
];

// ---- Affiliates ----
export type DemoAffiliate = {
  name: string;
  code: string;
  clicks: number;
  orders: number;
  sales: number;
  commission: number;
  status: "active" | "pending";
};

export const AFFILIATES: DemoAffiliate[] = [
  { name: "Aisyah Rahman (@aisyahstyles)", code: "AISYAH10", clicks: 4212, orders: 218, sales: 56430, commission: 5643, status: "active" },
  { name: "Hana Yusof (@hanamodest)", code: "HANA10", clicks: 2874, orders: 141, sales: 37280, commission: 3728, status: "active" },
  { name: "Zara Iman (@zaraiman.co)", code: "ZARA10", clicks: 1522, orders: 64, sales: 16110, commission: 1611, status: "active" },
  { name: "Balqis Noor (@balqiswears)", code: "BALQIS10", clicks: 0, orders: 0, sales: 0, commission: 0, status: "pending" },
];

// ---- Loyalty ----
export const TIERS = [
  { name: "Member", threshold: "RM0+", multiplier: "1× points", perks: ["Earn 1 pt per RM1", "Birthday voucher RM10"], members: 4820 },
  { name: "Gold", threshold: "RM1,500+ / yr", multiplier: "1.5× points", perks: ["Early access to launches", "Birthday voucher RM25", "Free shipping always"], members: 610 },
  { name: "Platinum", threshold: "RM3,000+ / yr", multiplier: "2× points", perks: ["Private sale invitations", "Birthday voucher RM50", "Priority support", "Free returns pickup"], members: 87 },
] as const;

// ---- EasyParcel shipping ----
export type DemoShipment = {
  order: string;
  customer: string;
  destination: string;
  courier: string;
  awb: string;
  status: "label ready" | "picked up" | "in transit" | "delivered";
};

export const SHIPMENTS: DemoShipment[] = [
  { order: "KLM-10247", customer: "Farah Hanim", destination: "Shah Alam, SGR", courier: "J&T Express", awb: "EP934812734MY", status: "in transit" },
  { order: "KLM-10246", customer: "Melissa Tan", destination: "Georgetown, PNG", courier: "Pos Laju", awb: "EP934771093MY", status: "delivered" },
  { order: "KLM-10245", customer: "Priya Nair", destination: "Johor Bahru, JHR", courier: "J&T Express", awb: "EP934702218MY", status: "delivered" },
];

export const COURIER_QUOTES = [
  { courier: "J&T Express", eta: "1–2 days", price: 8.9 },
  { courier: "Pos Laju", eta: "1–3 days", price: 9.5 },
  { courier: "Ninja Van", eta: "2–3 days", price: 8.5 },
  { courier: "DHL eCommerce", eta: "2–4 days", price: 12.9 },
];

// ---- Dashboard ----
export const SALES_14D = [
  { day: "4 Jul", total: 2140 },
  { day: "5 Jul", total: 3320 },
  { day: "6 Jul", total: 2870 },
  { day: "7 Jul", total: 1980 },
  { day: "8 Jul", total: 4410 },
  { day: "9 Jul", total: 3660 },
  { day: "10 Jul", total: 2950 },
  { day: "11 Jul", total: 3105 },
  { day: "12 Jul", total: 5230 },
  { day: "13 Jul", total: 4020 },
  { day: "14 Jul", total: 3390 },
  { day: "15 Jul", total: 3875 },
  { day: "16 Jul", total: 4540 },
  { day: "17 Jul", total: 2210 },
];

export const CHANNEL_SPLIT = [
  { channel: "kalima.my", pct: 58, amount: 27350 },
  { channel: "Shopee", pct: 27, amount: 12730 },
  { channel: "TikTok Shop", pct: 15, amount: 7075 },
];
