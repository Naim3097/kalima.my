import { useQuery } from "@tanstack/react-query";
import { fetchProducts, fetchProductBySlug, fetchCollection } from "../data/catalog";

export function useProducts() {
  return useQuery({ queryKey: ["products"], queryFn: fetchProducts });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["product", slug],
    queryFn: () => fetchProductBySlug(slug!),
    enabled: !!slug,
  });
}

export function useCollection(slug: string | undefined) {
  return useQuery({
    queryKey: ["collection", slug],
    queryFn: () => fetchCollection(slug!),
    enabled: !!slug,
  });
}
