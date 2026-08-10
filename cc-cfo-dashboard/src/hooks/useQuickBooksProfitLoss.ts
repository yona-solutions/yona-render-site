import { useQuery } from "@tanstack/react-query";
import { buildComparisonRange, type ProfitLossFilters, resolvePeriodRange } from "@/lib/profitLoss";
import type { QuickBooksProfitLossPayload } from "@/lib/quickbooks";

function buildSearchParams(filters: ProfitLossFilters) {
  const currentRange = resolvePeriodRange(filters);
  const comparisonRange = filters.comparison === "previous_period" ? buildComparisonRange(currentRange) : null;
  const params = new URLSearchParams({
    startDate: currentRange.from.toISOString().slice(0, 10),
    endDate: currentRange.to.toISOString().slice(0, 10),
    basis: filters.basis,
    periodLabel: currentRange.label,
    currency: filters.currency,
  });

  if (comparisonRange) {
    params.set("compareStartDate", comparisonRange.from.toISOString().slice(0, 10));
    params.set("compareEndDate", comparisonRange.to.toISOString().slice(0, 10));
    params.set("comparisonLabel", comparisonRange.label);
  }

  return params;
}

export function useQuickBooksProfitLoss(filters: ProfitLossFilters, enabled = true) {
  return useQuery({
    queryKey: [
      "quickbooks-profit-loss",
      filters.periodPreset,
      filters.month,
      filters.year,
      filters.customFrom,
      filters.customTo,
      filters.basis,
      filters.currency,
      filters.comparison,
      filters.region,
      filters.product,
      filters.channel,
      filters.department,
      filters.expenseCategory,
      filters.includeDrafts,
    ],
    enabled,
    retry: false,
    queryFn: async (): Promise<QuickBooksProfitLossPayload | null> => {
      const response = await fetch(`/api/quickbooks/profit-loss?${buildSearchParams(filters).toString()}`);

      if (response.status === 404) {
        return null;
      }

      let payload: QuickBooksProfitLossPayload | null = null;
      try {
        payload = (await response.json()) as QuickBooksProfitLossPayload;
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
