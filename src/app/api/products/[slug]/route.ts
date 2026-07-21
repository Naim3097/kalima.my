import { NextResponse } from "next/server";
import { fetchProductBySlug } from "@/data/catalog.queries";

/** GET /api/products/:slug */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({ product });
}
