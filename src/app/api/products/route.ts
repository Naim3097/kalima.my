import { NextResponse, type NextRequest } from "next/server";
import { fetchProducts } from "@/data/catalog.queries";

/*
  GET /api/products?category=women&bestSeller=true

  Note: Server Components import the data layer directly rather than calling
  this route — a server fetching its own HTTP endpoint is a wasted round trip.
  These handlers exist for client-side consumers (search overlay, admin
  tables) and as the integration surface for Phase 2+.
*/
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const category = searchParams.get("category");
  const collection = searchParams.get("collection");
  const bestSeller = searchParams.get("bestSeller");
  const newArrival = searchParams.get("newArrival");
  const q = searchParams.get("q")?.trim().toLowerCase();

  let products = await fetchProducts();

  if (category) products = products.filter((p) => p.category === category);
  if (collection) products = products.filter((p) => p.collection === collection);
  if (bestSeller === "true") products = products.filter((p) => p.bestSeller);
  if (newArrival === "true") products = products.filter((p) => p.newArrival);
  if (q) products = products.filter((p) => p.name.toLowerCase().includes(q));

  return NextResponse.json({ products, count: products.length });
}
