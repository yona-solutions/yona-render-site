import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { DrillDownData } from "@/components/ProfitabilityDataTable";
import { filterByDate, getFactsExpensesDaily, getFactsRevenueDaily, getMockState } from "@/mock/mockFinance";

export function useProfitabilityDrillDown() {
  const [drillDownRequest, setDrillDownRequest] = useState<{
    type: "waterfall" | "margin-trend";
    metric: string;
    period?: string;
    dateKey?: string;
  } | null>(null);

  const { data: drillDownData, isLoading } = useQuery({
    queryKey: ["profitability-drill-down", drillDownRequest],
    queryFn: async (): Promise<DrillDownData | null> => {
      if (!drillDownRequest) {
        return null;
      }

      const state = getMockState();
      let rows: DrillDownData["data"] = [];

      if (drillDownRequest.type === "waterfall") {
        if (drillDownRequest.metric === "Revenue") {
          rows = getFactsRevenueDaily(state)
            .filter((row) => row.amount_accrual > 0)
            .sort((left, right) => right.date.localeCompare(left.date))
            .slice(0, 50)
            .map((row) => ({
              date: format(new Date(`${row.date}T00:00:00`), "MMM dd, yyyy"),
              dateKey: row.date,
              description: row.channel || row.region || "Revenue",
              amount: row.amount_accrual,
              category: row.product_id || row.channel || undefined,
            }));
        } else {
          const expenseRows = getFactsExpensesDaily(state)
            .filter((row) =>
              drillDownRequest.metric === "COGS"
                ? row.category.toLowerCase().includes("cost")
                : !row.category.toLowerCase().includes("cost")
            )
            .sort((left, right) => right.date.localeCompare(left.date))
            .slice(0, 50);

          rows = expenseRows.map((row) => ({
            date: format(new Date(`${row.date}T00:00:00`), "MMM dd, yyyy"),
            dateKey: row.date,
            description: row.vendor || row.category || "Expense",
            amount: row.amount,
            category: row.category,
          }));
        }
      }

      if (drillDownRequest.type === "margin-trend" && drillDownRequest.dateKey) {
        const periodDate = new Date(
          drillDownRequest.dateKey.length === 7
            ? `${drillDownRequest.dateKey}-01T00:00:00`
            : `${drillDownRequest.dateKey}T00:00:00`
        );
        const range = { from: startOfMonth(periodDate), to: endOfMonth(periodDate) };

        const revenueRows = filterByDate(getFactsRevenueDaily(state), (row) => row.date, range)
          .filter((row) => row.amount_accrual > 0)
          .map((row) => ({
            date: format(new Date(`${row.date}T00:00:00`), "MMM dd, yyyy"),
            dateKey: row.date,
            description: `Revenue - ${row.channel || row.product_id || "General"}`,
            amount: row.amount_accrual,
            category: "Revenue",
          }));

        const expenseRows = filterByDate(getFactsExpensesDaily(state), (row) => row.date, range)
          .map((row) => ({
            date: format(new Date(`${row.date}T00:00:00`), "MMM dd, yyyy"),
            dateKey: row.date,
            description: row.vendor || row.category || "Expense",
            amount: -row.amount,
            category: row.category,
          }));

        rows = [...revenueRows, ...expenseRows]
          .sort((left, right) => right.dateKey.localeCompare(left.dateKey))
          .slice(0, 50);
      }

      return {
        type: drillDownRequest.type,
        metric: drillDownRequest.metric,
        period: drillDownRequest.period,
        data: rows,
      };
    },
    enabled: !!drillDownRequest,
  });

  return {
    drillDownData: drillDownRequest ? drillDownData : null,
    isLoading,
    handleWaterfallClick: (metric: string) => setDrillDownRequest({ type: "waterfall", metric }),
    handleMarginClick: (metric: string, period: string, dateKey: string) =>
      setDrillDownRequest({ type: "margin-trend", metric, period, dateKey }),
    clearDrillDown: () => setDrillDownRequest(null),
  };
}
