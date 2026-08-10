import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { filterByDate, getMockState } from "@/mock/mockFinance";

export interface CashFlowDrillDownData {
  period: string;
  dateKey: string;
  data: {
    date: string;
    dateKey: string;
    description: string;
    amount: number;
    type: "inflow" | "outflow";
    category?: string;
  }[];
}

export function useCashFlowDrillDown() {
  const [drillDownRequest, setDrillDownRequest] = useState<{ period: string; dateKey: string } | null>(null);

  const { data: drillDownData, isLoading } = useQuery({
    queryKey: ["cashflow-drill-down", drillDownRequest],
    queryFn: async (): Promise<CashFlowDrillDownData | null> => {
      if (!drillDownRequest) {
        return null;
      }

      const isMonthly = drillDownRequest.dateKey.split("-").length === 2;
      const baseDate = new Date(isMonthly ? `${drillDownRequest.dateKey}-01T00:00:00` : `${drillDownRequest.dateKey}T00:00:00`);
      const range = isMonthly
        ? { from: startOfMonth(baseDate), to: endOfMonth(baseDate) }
        : { from: baseDate, to: baseDate };

      const transactions = filterByDate(getMockState().bankTransactions, (item) => item.date, range)
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((item) => ({
          date: format(new Date(`${item.date}T00:00:00`), "MMM dd, yyyy"),
          dateKey: item.date,
          description: item.counterparty || item.category || "Transaction",
          amount: Math.abs(item.amount),
          type: item.type,
          category: item.category,
        }));

      return {
        period: drillDownRequest.period,
        dateKey: drillDownRequest.dateKey,
        data: transactions,
      };
    },
    enabled: !!drillDownRequest,
  });

  return {
    drillDownData: drillDownRequest ? drillDownData : null,
    isLoading,
    handlePeriodClick: (period: string, dateKey: string) => setDrillDownRequest({ period, dateKey }),
    clearDrillDown: () => setDrillDownRequest(null),
  };
}
