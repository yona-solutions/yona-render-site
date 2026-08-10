import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { filterByDate, getMockState } from "@/mock/mockFinance";

export interface ExpenseDrillDownData {
  filterType: "category" | "period";
  category?: string;
  periodLabel?: string;
  data: {
    date: string;
    dateKey: string;
    description: string;
    amount: number;
    category?: string;
  }[];
}

type DrillDownRequest =
  | { type: "category"; category: string }
  | { type: "period"; dateKey: string; label: string; granularity: "day" | "month" };

export function useExpenseDrillDown(dateRange?: { from?: Date; to?: Date }) {
  const [drillDownRequest, setDrillDownRequest] = useState<DrillDownRequest | null>(null);

  const { data: drillDownData, isLoading } = useQuery<ExpenseDrillDownData | null>({
    queryKey: ["expense-drill-down", drillDownRequest, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      if (!drillDownRequest) {
        return null;
      }

      const state = getMockState();
      let rows = state.expenses;

      if (drillDownRequest.type === "category") {
        rows = filterByDate(rows, (row) => row.date, dateRange).filter((row) => row.category === drillDownRequest.category);
      } else {
        const monthDate = drillDownRequest.dateKey.length === 7 ? new Date(`${drillDownRequest.dateKey}-01T00:00:00`) : new Date(`${drillDownRequest.dateKey}T00:00:00`);
        const periodRange = drillDownRequest.granularity === "day"
          ? { from: monthDate, to: monthDate }
          : { from: startOfMonth(monthDate), to: endOfMonth(monthDate) };
        rows = filterByDate(rows, (row) => row.date, periodRange);
      }

      const data = rows
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 200)
        .map((row) => ({
          date: format(new Date(`${row.date}T00:00:00`), "MMM dd, yyyy"),
          dateKey: row.date,
          description: row.vendor || row.category || "Expense",
          amount: Number(row.amount || 0),
          category: row.category || undefined,
        }));

      if (drillDownRequest.type === "category") {
        return { filterType: "category", category: drillDownRequest.category, data };
      }

      return { filterType: "period", periodLabel: drillDownRequest.label, data };
    },
    enabled: !!drillDownRequest,
  });

  return {
    drillDownData: drillDownRequest ? drillDownData : null,
    isLoading,
    openCategoryDrillDown: (category: string) => setDrillDownRequest({ type: "category", category }),
    openPeriodDrillDown: (dateKey: string, label: string, granularity: "day" | "month") =>
      setDrillDownRequest({ type: "period", dateKey, label, granularity }),
    clearDrillDown: () => setDrillDownRequest(null),
  };
}
