import { useQuery } from "@tanstack/react-query";
import { type ProfitLossFilters } from "@/lib/profitLoss";
import { buildMonthlyMatrixRanges } from "@/lib/profitLossMatrix";
import type { QuickBooksProfitLossMatrixPayload } from "@/lib/quickbooks";

function buildSearchParams(filters: ProfitLossFilters, showYearOverYear: boolean) {
  const ranges = buildMonthlyMatrixRanges(filters);
  const firstRange = ranges[0];
  const lastRange = ranges[ranges.length - 1];
  const params = new URLSearchParams({
    startDate: firstRange.from.toISOString().slice(0, 10),
    endDate: lastRange.to.toISOString().slice(0, 10),
    basis: filters.basis,
    periodLabel: ranges.map((range) => range.label).join(" • "),
  });

  if (showYearOverYear) {
    params.set("compareStartDate", firstRange.compareFrom.toISOString().slice(0, 10));
    params.set("compareEndDate", lastRange.compareTo.toISOString().slice(0, 10));
  }

  return params;
}

export function useQuickBooksProfitLossMatrix(
  filters: ProfitLossFilters,
  showYearOverYear: boolean,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      "quickbooks-profit-loss-matrix",
      filters.periodPreset,
      filters.month,
      filters.year,
      filters.customFrom,
      filters.customTo,
      filters.basis,
      filters.currency,
      showYearOverYear,
    ],
    enabled,
    retry: false,
    queryFn: async (): Promise<QuickBooksProfitLossMatrixPayload | null> => {
      const response = await fetch(`/api/quickbooks/profit-loss-matrix?${buildSearchParams(filters, showYearOverYear).toString()}`);

      if (response.status === 404) {
        return null;
      }

      let payload: QuickBooksProfitLossMatrixPayload | null = null;
      try {
        payload = (await response.json()) as QuickBooksProfitLossMatrixPayload;
      } catch {
        payload = null;
      }

      if (!response.ok && !payload) {
        throw new Error(`QuickBooks matrix request failed with status ${response.status}`);
      }

      return payload;
    },
  });
}
