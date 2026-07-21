"use client";

import { useQuery } from "@tanstack/react-query";
import type { Product, CollectionMeta } from "@/data/catalog";

/*
  Client-side catalog access. These go through the route handlers in
  src/app/api rather than importing src/data/catalog.queries.ts directly —
  that module is server-only (it reads cookies and holds the Supabase server
  client), so importing it from a client component is a build error.

  Server Components should NOT use these hooks; they call the query module
  directly, which avoids an HTTP round trip back into our own app.
*/

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} responded ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () =>
      (await getJson<{ products: Product[] }>("/api/products")).products,
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["product", slug],
    queryFn: async () =>
      (await getJson<{ product: Product }>(`/api/products/${slug}`)).product,
    enabled: !!slug,
  });
}

export function useCollection(slug: string | undefined) {
  return useQuery({
    queryKey: ["collection", slug],
    queryFn: async () =>
      getJson<{ collection: CollectionMeta; products: Product[] }>(
        `/api/collections/${slug}`,
      ),
    enabled: !!slug,
  });
}
