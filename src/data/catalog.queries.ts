import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import {
  PRODUCTS,
  COLLECTIONS,
  variantKey,
  type Product,
  type ProductAddon,
  type ColorOption,
  type CollectionMeta,
} from "./catalog";

/*
  Catalog data access, backed by Supabase.

  Signatures are unchanged from the seed-data version, so every caller kept
  working when this moved off the local arrays.

  Fallback policy: if Supabase is *not configured* (no env vars) these fall
  back to the seed catalog, which keeps the app runnable for a fresh clone or
  CI. If Supabase IS configured but a query fails, they throw — serving stale
  seed prices while the database is unreachable would be worse than an error.
*/

/** Shape returned by the embedded select below. */
type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  fabric: string | null;
  category: Product["category"];
  price_sen: number;
  sale_price_sen: number | null;
  size_chart_url: string | null;
  best_seller: boolean;
  new_arrival: boolean;
  offers_custom_sizing: boolean;
  tone: string;
  product_variants: {
    color_name: string;
    color_hex: string;
    size: string;
    color_position: number;
    position: number;
    stock_on_hand: number;
  }[];
  product_images: {
    url: string;
    color_name: string | null;
    position: number;
  }[];
  collection_products: { collections: { slug: string } | null }[];
};

const PRODUCT_SELECT = `
  id, slug, name, description, fabric, category, price_sen, sale_price_sen, size_chart_url,
  best_seller, new_arrival, offers_custom_sizing, tone,
  product_variants ( color_name, color_hex, size, color_position, position, stock_on_hand ),
  product_images ( url, color_name, position ),
  collection_products ( collections ( slug ) )
`;


function mapProduct(row: ProductRow): Product {
  /*
    Variants are the colour × size cross product. Collapse them back into the
    catalog's shape: an ordered colour list plus an ordered size list.
  */
  const colorsByName = new Map<string, ColorOption & { order: number }>();
  const sizeOrder = new Map<string, number>();

  for (const v of row.product_variants) {
    if (!colorsByName.has(v.color_name)) {
      colorsByName.set(v.color_name, {
        name: v.color_name,
        hex: v.color_hex,
        order: v.color_position,
      });
    }
    // A size keeps the lowest position it appears at across colours.
    const seen = sizeOrder.get(v.size);
    if (seen === undefined || v.position < seen) sizeOrder.set(v.size, v.position);
  }

  // Per-colour photography drives the swatch-click image swap.
  const colorImages = new Map(
    row.product_images
      .filter((i) => i.color_name)
      .map((i) => [i.color_name as string, i.url]),
  );

  const colors = [...colorsByName.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...c }) => ({
      ...c,
      image: colorImages.get(c.name),
    }));

  const sizes = [...sizeOrder.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([size]) => size);

  // The product-level shot: the image with no colour scope, lowest position.
  const primaryImage = row.product_images
    .filter((i) => !i.color_name)
    .sort((a, b) => a.position - b.position)[0]?.url;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // The database stores sen as an integer; the UI works in ringgit.
    price: row.price_sen / 100,
    salePrice: row.sale_price_sen != null ? row.sale_price_sen / 100 : undefined,
    sizeChart: row.size_chart_url ?? undefined,
    category: row.category,
    colors,
    sizes,
    fabric: row.fabric ?? "",
    description: row.description ?? "",
    bestSeller: row.best_seller,
    newArrival: row.new_arrival,
    offersCustomSizing: row.offers_custom_sizing,
    tone: row.tone,
    image: primaryImage,
    stock: row.product_variants.reduce((total, v) => total + v.stock_on_hand, 0),
    stockByVariant: Object.fromEntries(
      row.product_variants.map((v) => [variantKey(v.color_name, v.size), v.stock_on_hand]),
    ),
  };
}

/*
  cache() dedupes within a single render pass, so a page that calls
  fetchProducts() and generateMetadata() that calls it again issue one query.
*/
export const fetchProducts = cache(async (): Promise<Product[]> => {
  const supabase = createPublicClient();
  if (!supabase) return PRODUCTS;

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("published", true)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`fetchProducts failed: ${error.message}`);
  return (data as unknown as ProductRow[]).map(mapProduct);
});

/*
  Matching add-ons for one product.

  A SEPARATE QUERY, not part of PRODUCT_SELECT, because only the PDP renders
  these — folding them into the shared select would make every collection grid
  and the search overlay pay for a two-level join they never read.

  RLS already restricts the rows to pairs where both products are published
  (see the product_addons migration), so nothing here re-checks that.
*/
type AddonRow = {
  id: string;
  addon_color_name: string | null;
  label: string | null;
  products: {
    id: string;
    slug: string;
    name: string;
    price_sen: number;
    sale_price_sen: number | null;
    product_variants: {
      color_name: string;
      color_hex: string;
      color_position: number;
      size: string;
      price_sen: number | null;
      stock_on_hand: number;
    }[];
    product_images: { url: string; color_name: string | null; position: number }[];
  } | null;
};

async function fetchAddons(
  supabase: NonNullable<ReturnType<typeof createPublicClient>>,
  parentProductId: string,
): Promise<ProductAddon[]> {
  const { data, error } = await supabase
    .from("product_addons")
    .select(
      `id, addon_color_name, label,
       products:addon_product_id (
         id, slug, name, price_sen, sale_price_sen,
         product_variants ( color_name, color_hex, color_position, size, price_sen, stock_on_hand ),
         product_images ( url, color_name, position )
       )`,
    )
    .eq("parent_product_id", parentProductId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`fetchAddons failed: ${error.message}`);

  const addons: ProductAddon[] = [];

  for (const row of (data ?? []) as unknown as AddonRow[]) {
    const p = row.products;
    /* Defensive: a null embed means the row survived RLS but the product did
       not — treat it as absent rather than rendering a nameless tickbox. */
    if (!p || p.product_variants.length === 0) continue;

    /*
      The pinned colourway, or the first by position when staff left it unset —
      which is the single-colour case, where there is nothing to pin.
    */
    const byPosition = [...p.product_variants].sort((a, b) => a.color_position - b.color_position);
    const colorName = row.addon_color_name ?? byPosition[0].color_name;
    const variants = p.product_variants.filter((v) => v.color_name === colorName);

    /* A pinned colour that no longer exists (renamed, or its variants deleted)
       leaves nothing to sell. Drop the row rather than offer an empty size map
       that would disable itself for every size with no explanation. */
    if (variants.length === 0) continue;

    /*
      The same coalesce resolveCartLines applies (src/lib/commerce.ts) —
      variant override, else the product's sale price, else its list price. Any
      other order here would show one figure on the PDP and charge another.
    */
    const unitSen = variants[0].price_sen ?? p.sale_price_sen ?? p.price_sen;

    addons.push({
      id: row.id,
      productId: p.id,
      slug: p.slug,
      name: row.label ?? p.name,
      colorName,
      colorHex: variants[0].color_hex,
      image:
        p.product_images.find((i) => i.color_name === colorName)?.url ??
        p.product_images
          .filter((i) => !i.color_name)
          .sort((a, b) => a.position - b.position)[0]?.url,
      price: unitSen / 100,
      stockBySize: Object.fromEntries(variants.map((v) => [v.size, v.stock_on_hand])),
    });
  }

  return addons;
}

export const fetchProductBySlug = cache(
  async (slug: string): Promise<Product | undefined> => {
    const supabase = createPublicClient();
    if (!supabase) return PRODUCTS.find((p) => p.slug === slug);

    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();

    if (error) throw new Error(`fetchProductBySlug(${slug}) failed: ${error.message}`);
    if (!data) return undefined;

    const product = mapProduct(data as unknown as ProductRow);
    return { ...product, addons: await fetchAddons(supabase, product.id) };
  },
);

export const fetchCollections = cache(async (): Promise<CollectionMeta[]> => {
  const supabase = createPublicClient();
  if (!supabase) {
    return COLLECTIONS.map(({ filter: _filter, ...meta }) => meta);
  }

  const { data, error } = await supabase
    .from("collections")
    .select("slug, title, description")
    .eq("published", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`fetchCollections failed: ${error.message}`);
  return data.map((c) => ({ ...c, description: c.description ?? "" }));
});

export const fetchCollection = cache(
  async (
    slug: string,
  ): Promise<{ meta: CollectionMeta; products: Product[] } | undefined> => {
    const supabase = createPublicClient();

    if (!supabase) {
      const seed = COLLECTIONS.find((c) => c.slug === slug);
      if (!seed) return undefined;
      const { filter, ...meta } = seed;
      return { meta, products: PRODUCTS.filter(filter) };
    }

    const { data: collection, error } = await supabase
      .from("collections")
      .select("slug, title, description, is_smart")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();

    if (error) throw new Error(`fetchCollection(${slug}) failed: ${error.message}`);
    if (!collection) return undefined;

    const meta: CollectionMeta = {
      slug: collection.slug,
      title: collection.title,
      description: collection.description ?? "",
    };

    /*
      Smart collections are derived from product flags rather than membership
      rows, so they stay correct without anyone maintaining a list.
    */
    if (collection.is_smart) {
      const all = await fetchProducts();
      const products =
        slug === "best-sellers"
          ? all.filter((p) => p.bestSeller)
          : slug === "new-arrivals"
            ? all.filter((p) => p.newArrival)
            : [];
      return { meta, products };
    }

    const { data: members, error: membersError } = await supabase
      .from("collection_products")
      .select(`sort_order, products!inner ( ${PRODUCT_SELECT} )`)
      .eq("collection_id", await collectionId(supabase, slug))
      .eq("products.published", true)
      .order("sort_order", { ascending: true });

    if (membersError) {
      throw new Error(`fetchCollection(${slug}) members failed: ${membersError.message}`);
    }

    const products = (members as unknown as { products: ProductRow }[])
      .map((m) => m.products)
      .map(mapProduct);

    return { meta, products };
  },
);

/** Resolves a collection slug to its id — membership is keyed by id, not slug. */
async function collectionId(
  supabase: NonNullable<ReturnType<typeof createPublicClient>>,
  slug: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("collections")
    .select("id")
    .eq("slug", slug)
    .single();

  if (error) throw new Error(`collectionId(${slug}) failed: ${error.message}`);
  return data.id;
}

/*
  Slug lists for generateStaticParams().

  These deliberately do NOT reuse fetchProducts()/fetchCollections():
  generateStaticParams runs at build time with no HTTP request, and those go
  through the cookie-backed client, which throws in that context. The
  session-less client is also the honest choice here — prerendering has no
  user, so it should see exactly what an anonymous visitor sees.
*/
export async function listProductSlugs(): Promise<string[]> {
  const supabase = createPublicClient();
  if (!supabase) return PRODUCTS.map((p) => p.slug);

  const { data, error } = await supabase
    .from("products")
    .select("slug")
    .eq("published", true);

  if (error) throw new Error(`listProductSlugs failed: ${error.message}`);
  return data.map((p) => p.slug);
}

export async function listCollectionSlugs(): Promise<string[]> {
  const supabase = createPublicClient();
  if (!supabase) return COLLECTIONS.map((c) => c.slug);

  const { data, error } = await supabase
    .from("collections")
    .select("slug")
    .eq("published", true);

  if (error) throw new Error(`listCollectionSlugs failed: ${error.message}`);
  return data.map((c) => c.slug);
}
