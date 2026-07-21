"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  Client boundary for TanStack Query. Most data now arrives via Server
  Components, so this covers client-side interactions only (search overlay,
  optimistic cart/wishlist work in Phase 2+).

  The QueryClient is created in state, not at module scope: at module scope a
  single instance would be shared across all users on the server.
*/
export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
