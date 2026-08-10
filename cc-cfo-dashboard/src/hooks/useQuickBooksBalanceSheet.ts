import { useQuery } from "@tanstack/react-query";
import { resolveBalanceSheetRange, type BalanceSheetFilters } from "@/lib/balanceSheet";
import type { QuickBooksBalanceSheetPayload } from "@/lib/quickbooks";

function buildSearchParams(filters: BalanceSheetFilters) {
  const range = resolveBalanceSheetRange(filters);

  return new URLSearchParams({
    startDate: range.from.toISOString().slice(0, 10),
    endDate: range.to.toISOString().slice(0, 10),
    basis: filters.basis,
    currency: filters.currency,
    periodLabel: range.label,
  });
}

export function useQuickBooksBalanceSheet(filters: BalanceSheetFilters) {
  return useQuery({
    queryKey: [
      "quickbooks-balance-sheet",
      filters.periodPreset,
      filters.month,
      filters.year,
      filters.customDate,
      filters.basis,
      filters.currency,
    ],
    retry: false,
    queryFn: async (): Promise<QuickBooksBalanceSheetPayload | null> => {
      const response = await fetch(`/api/quickbooks/balance-sheet?${buildSearchParams(filters).toString()}`);

      if (response.status === 404) {
        return null;
      }

      let payload: QuickBooksBalanceSheetPayload | null = null;
      try {
        payload = (await response.json()) as QuickBooksBalanceSheetPayload;
      } catch {
        payload = null;
      }

      if (!response.ok && !payload) {
        throw new Error(`QuickBooks request failed with status ${response.status}`);
      }

      return payload;
    },
  });
}
