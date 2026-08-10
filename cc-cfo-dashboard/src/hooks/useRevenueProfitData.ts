import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { filterByDate, getFactsExpensesDaily, getMockState } from "@/mock/mockFinance";

export interface RevenueProfitData {
  period: string;
  dateKey: string;
  revenue: number;
  profit: number;
}

export function useRevenueProfitData(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["revenue-profit-data", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const invoices = filterByDate(state.invoices, (invoice) => invoice.issue_date, dateRange);
      const expenses = filterByDate(getFactsExpensesDaily(state), (expense) => expense.date, dateRange);

      if (invoices.length === 0 && expenses.length === 0) {
        return [] as RevenueProfitData[];
      }

      const useDailyGranularity = Boolean(dateRange?.from && dateRange?.to &&
        Math.abs(dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24) <= 30);

      const revenueMap = new Map<string, { dateKey: string; amount: number }>();
      for (const invoice of invoices) {
        const date = new Date(`${invoice.issue_date}T00:00:00`);
        const period = useDailyGranularity ? format(date, "MMM dd") : format(date, "MMM yyyy");
        const dateKey = useDailyGranularity ? format(date, "yyyy-MM-dd") : format(date, "yyyy-MM");
        const current = revenueMap.get(period) || { dateKey, amount: 0 };
        current.amount += invoice.amount_total_base;
        revenueMap.set(period, current);
      }

      const expenseMap = new Map<string, number>();
      for (const expense of expenses) {
        const date = new Date(`${expense.date}T00:00:00`);
        const period = useDailyGranularity ? format(date, "MMM dd") : format(date, "MMM yyyy");
        expenseMap.set(period, (expenseMap.get(period) || 0) + expense.amount);
      }

      const allPeriods = Array.from(new Set([...revenueMap.keys(), ...expenseMap.keys()]));
      return allPeriods
        .map((period) => {
          const revenue = revenueMap.get(period);
          const expensesForPeriod = expenseMap.get(period) || 0;
          return {
            period,
            dateKey: revenue?.dateKey || "",
            revenue: revenue?.amount || 0,
            profit: (revenue?.amount || 0) - expensesForPeriod,
          };
        })
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
    },
  });
}
