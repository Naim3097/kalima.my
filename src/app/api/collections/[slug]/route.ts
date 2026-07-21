import { NextResponse } from "next/server";
import { fetchCollection } from "@/data/catalog.queries";

/** GET /api/collections/:slug */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const result = await fetchCollection(slug);

  if (!result) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  return NextResponse.json({
    collection: result.meta,
    products: result.products,
  });
}
