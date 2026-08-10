import { useQuery } from "@tanstack/react-query";
import type { QuickBooksConnectionState } from "@/lib/quickbooks";

interface QuickBooksStatusPayload {
  connection: QuickBooksConnectionState;
}

export function useQuickBooksConnectionStatus() {
  return useQuery({
    queryKey: ["quickbooks-connection-status"],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<QuickBooksStatusPayload | null> => {
      const response = await fetch("/api/quickbooks/status");

      if (response.status === 404) {
        return null;
      }

      let payload: QuickBooksStatusPayload | null = null;
      try {
        payload = (await response.json()) as QuickBooksStatusPayload;
      } catch {
        payload = null;
      }

      if (!response.ok && !payload) {
        throw new Error(`QuickBooks status request failed with status ${response.status}`);
      }

      return payload;
    },
  });
}
