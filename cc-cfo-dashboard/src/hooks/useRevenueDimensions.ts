import { useQuery } from "@tanstack/react-query";
import { filterByDate, getFactsRevenueDaily, getMockState } from "@/mock/mockFinance";

interface DimensionData {
  dimension: string;
  amount: number;
  percentage: number;
}

interface RevenueDimensionsResult {
  productData: DimensionData[];
  regionData: DimensionData[];
  channelData: DimensionData[];
}

function toDimensionArray(values: Map<string, number>, total: number) {
  return Array.from(values.entries())
    .map(([dimension, amount]) => ({
      dimension,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((left, right) => right.amount - left.amount);
}

export function useRevenueDimensions(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["revenue-dimensions", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async (): Promise<RevenueDimensionsResult> => {
      const state = getMockState();
      const rows = filterByDate(getFactsRevenueDaily(state), (row) => row.date, dateRange).filter((row) => row.amount_accrual > 0);
      if (rows.length === 0) {
        return { productData: [], regionData: [], channelData: [] };
      }

      const totalRevenue = rows.reduce((sum, row) => sum + row.amount_accrual, 0);
      const productMap = new Map<string, number>();
      const regionMap = new Map<string, number>();
      const channelMap = new Map<string, number>();

      rows.forEach((row) => {
        productMap.set(row.product_id || "Unspecified", (productMap.get(row.product_id || "Unspecified") || 0) + row.amount_accrual);
        regionMap.set(row.region || "Unspecified", (regionMap.get(row.region || "Unspecified") || 0) + row.amount_accrual);
        channelMap.set(row.channel || "Unspecified", (channelMap.get(row.channel || "Unspecified") || 0) + row.amount_accrual);
      });

      return {
        productData: toDimensionArray(productMap, totalRevenue),
        regionData: toDimensionArray(regionMap, totalRevenue),
        channelData: toDimensionArray(channelMap, totalRevenue),
      };
    },
  });
}
