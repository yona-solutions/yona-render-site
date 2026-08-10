import { useQuery } from "@tanstack/react-query";
import { getCustomer, getMockState } from "@/mock/mockFinance";

interface RevenueDrillDownParams {
  startDate: string;
  endDate: string;
  category?: string;
  categoryType?: "product" | "region" | "channel";
}

export function useRevenueDrillDown(params: RevenueDrillDownParams | null) {
  return useQuery({
    queryKey: ["revenue-drill-down", params],
    queryFn: async () => {
      if (!params) {
        return [];
      }

      const state = getMockState();
      return state.invoices
        .filter((invoice) => invoice.issue_date >= params.startDate && invoice.issue_date <= params.endDate)
        .filter((invoice) => {
          if (!params.category || !params.categoryType) {
            return true;
          }
          if (params.categoryType === "product") return invoice.product_id === params.category;
          if (params.categoryType === "region") return invoice.region === params.category;
          if (params.categoryType === "channel") return invoice.channel === params.category;
          return true;
        })
        .sort((left, right) => right.issue_date.localeCompare(left.issue_date))
        .map((invoice) => ({
          ...invoice,
          customers: getCustomer(state, invoice.customer_id),
        }));
    },
    enabled: !!params,
  });
}
