import { useQuery } from "@tanstack/react-query";
import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subQuarters,
  subYears,
} from "date-fns";
import { filterByDate, getFactsCashflowDaily, getFactsExpensesDaily, getFactsRevenueDaily, getMockState } from "@/mock/mockFinance";

export type TimePeriod = "month" | "quarter" | "year";

interface PeriodData {
  revenue: number;
  expenses: number;
  profit: number;
  cashFlow: number;
}

interface PeriodComparison {
  current: PeriodData;
  previous: PeriodData;
  growth: {
    revenue: number;
    expenses: number;
    profit: number;
    cashFlow: number;
  };
}

function calculateGrowth(current: number, previous: number) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function usePeriodComparison(period: TimePeriod) {
  return useQuery({
    queryKey: ["period-comparison", period],
    queryFn: async (): Promise<PeriodComparison> => {
      const now = new Date();
      let currentStart: Date;
      let currentEnd: Date;
      let previousStart: Date;
      let previousEnd: Date;

      switch (period) {
        case "month":
          currentStart = startOfMonth(now);
          currentEnd = endOfMonth(now);
          previousStart = startOfMonth(subMonths(now, 1));
          previousEnd = endOfMonth(subMonths(now, 1));
          break;
        case "quarter":
          currentStart = startOfQuarter(now);
          currentEnd = endOfQuarter(now);
          previousStart = startOfQuarter(subQuarters(now, 1));
          previousEnd = endOfQuarter(subQuarters(now, 1));
          break;
        case "year":
        default:
          currentStart = startOfYear(now);
          currentEnd = endOfYear(now);
          previousStart = startOfYear(subYears(now, 1));
          previousEnd = endOfYear(subYears(now, 1));
          break;
      }

      const state = getMockState();
      const currentRange = { from: currentStart, to: currentEnd };
      const previousRange = { from: previousStart, to: previousEnd };

      const currentRevenue = filterByDate(getFactsRevenueDaily(state), (row) => row.date, currentRange).reduce((sum, row) => sum + row.amount_accrual, 0);
      const currentExpenses = filterByDate(getFactsExpensesDaily(state), (row) => row.date, currentRange).reduce((sum, row) => sum + row.amount, 0);
      const currentCashFlow = filterByDate(getFactsCashflowDaily(state), (row) => row.date, currentRange).reduce((sum, row) => sum + row.inflow - row.outflow, 0);

      const previousRevenue = filterByDate(getFactsRevenueDaily(state), (row) => row.date, previousRange).reduce((sum, row) => sum + row.amount_accrual, 0);
      const previousExpenses = filterByDate(getFactsExpensesDaily(state), (row) => row.date, previousRange).reduce((sum, row) => sum + row.amount, 0);
      const previousCashFlow = filterByDate(getFactsCashflowDaily(state), (row) => row.date, previousRange).reduce((sum, row) => sum + row.inflow - row.outflow, 0);

      const currentProfit = currentRevenue - currentExpenses;
      const previousProfit = previousRevenue - previousExpenses;

      return {
        current: {
          revenue: currentRevenue,
          expenses: currentExpenses,
          profit: currentProfit,
          cashFlow: currentCashFlow,
        },
        previous: {
          revenue: previousRevenue,
          expenses: previousExpenses,
          profit: previousProfit,
          cashFlow: previousCashFlow,
        },
        growth: {
          revenue: calculateGrowth(currentRevenue, previousRevenue),
          expenses: calculateGrowth(currentExpenses, previousExpenses),
          profit: calculateGrowth(currentProfit, previousProfit),
          cashFlow: calculateGrowth(currentCashFlow, previousCashFlow),
        },
      };
    },
  });
}
