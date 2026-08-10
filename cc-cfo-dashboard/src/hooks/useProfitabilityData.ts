import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useExpenseCategories, useFinancialMetrics, useRevenueSources } from "./useFinancialData";
import { filterByDate, getFactsExpensesDaily, getFactsRevenueDaily, getMockState } from "@/mock/mockFinance";

export interface ProfitabilityMetrics {
  totalRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  netProfit: number;
  operatingProfit: number;
  ebitda: number;
  grossMargin: number;
  netMargin: number;
  operatingMargin: number;
  ebitdaMargin: number;
  revenueGrowth: number;
  profitGrowth: number;
}

export interface ProfitBreakdown {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  ebitda: number;
}

export interface MarginTrend {
  name: string;
  current: number;
  change: number;
  changeType: "positive" | "negative" | "neutral";
  icon: "up" | "down" | "neutral";
}

export interface MarginTrendTimeSeries {
  period: string;
  dateKey: string;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
}

function isCogsCategory(category: string) {
  const lower = category.toLowerCase();
  return lower.includes("cost of sales") || lower.includes("cost of goods") || lower.includes("materials");
}

export function useProfitabilityData(filters?: {
  dateRange?: { from?: Date; to?: Date };
  project?: string;
  department?: string;
  product?: string;
  region?: string;
  currency?: string;
}) {
  const currency = filters?.currency || "USD";
  const { data: revenueSources } = useRevenueSources(filters?.dateRange, currency);
  const { data: expenseCategories } = useExpenseCategories(filters?.dateRange, currency);
  const { data: financialMetrics } = useFinancialMetrics(filters?.dateRange);

  return useQuery({
    queryKey: ["profitability-data", currency, filters?.dateRange?.from?.toISOString(), filters?.dateRange?.to?.toISOString(), revenueSources, expenseCategories, financialMetrics],
    queryFn: (): ProfitabilityMetrics => {
      const totalRevenue = Array.isArray(revenueSources)
        ? revenueSources.reduce((sum, source) => sum + (Number(source.amount) || 0), 0)
        : 0;

      const totalExpenses = Array.isArray(expenseCategories)
        ? expenseCategories.reduce((sum, category) => sum + (Number(category.amount) || 0), 0)
        : 0;

      const cogs = Array.isArray(expenseCategories)
        ? expenseCategories.filter((category) => isCogsCategory(category.name)).reduce((sum, category) => sum + category.amount, 0)
        : 0;

      const operatingExpenses = Math.max(totalExpenses - cogs, 0);
      const grossProfit = totalRevenue - cogs;
      const operatingProfit = grossProfit - operatingExpenses;
      const netProfit = operatingProfit;
      const ebitda = operatingProfit;

      const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
      const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      const operatingMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;
      const ebitdaMargin = totalRevenue > 0 ? (ebitda / totalRevenue) * 100 : 0;

      const revenueMetric = financialMetrics?.find((metric) => metric.metric_type === "revenue")?.amount || totalRevenue;
      const profitMetric = financialMetrics?.find((metric) => metric.metric_type === "profit")?.amount || netProfit;
      const revenueGrowth = revenueMetric > 0 ? 7.2 : 0;
      const profitGrowth = profitMetric > 0 ? 5.4 : 0;

      return {
        totalRevenue,
        totalExpenses,
        grossProfit,
        netProfit,
        operatingProfit,
        ebitda,
        grossMargin,
        netMargin,
        operatingMargin,
        ebitdaMargin,
        revenueGrowth,
        profitGrowth,
      };
    },
    enabled: true,
    placeholderData: (previousData) => previousData,
  });
}

export function useProfitBreakdown(filters?: {
  dateRange?: { from?: Date; to?: Date };
  project?: string;
  department?: string;
  product?: string;
  region?: string;
  currency?: string;
}): ProfitBreakdown {
  const { data: profitabilityData } = useProfitabilityData(filters);

  if (!profitabilityData) {
    return { revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, netProfit: 0, ebitda: 0 };
  }

  const cogs = profitabilityData.totalRevenue - profitabilityData.grossProfit;
  const operatingExpenses = profitabilityData.grossProfit - profitabilityData.operatingProfit;

  return {
    revenue: profitabilityData.totalRevenue,
    cogs,
    grossProfit: profitabilityData.grossProfit,
    operatingExpenses,
    netProfit: profitabilityData.netProfit,
    ebitda: profitabilityData.ebitda,
  };
}

export function useMarginTrends(filters?: {
  dateRange?: { from?: Date; to?: Date };
  project?: string;
  department?: string;
  product?: string;
  region?: string;
  currency?: string;
}): MarginTrend[] {
  const { data: profitabilityData } = useProfitabilityData(filters);

  if (!profitabilityData) {
    return [];
  }

  return [
    { name: "Gross Margin", current: profitabilityData.grossMargin, change: 0.8, changeType: "positive", icon: "up" },
    { name: "Operating Margin", current: profitabilityData.operatingMargin, change: 0.3, changeType: "positive", icon: "up" },
    { name: "Net Margin", current: profitabilityData.netMargin, change: -0.2, changeType: "neutral", icon: "neutral" },
  ];
}

export function formatProfitCurrency(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

export function formatMarginPercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}

export function formatChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

export function useMarginTrendsTimeSeries(filters?: {
  dateRange?: { from?: Date; to?: Date };
  product?: string;
  region?: string;
  currency?: string;
}) {
  return useQuery({
    queryKey: ["margin-trends-timeseries", filters?.dateRange?.from?.toISOString(), filters?.dateRange?.to?.toISOString(), filters?.product, filters?.region],
    queryFn: async () => {
      const state = getMockState();
      const revenueFacts = filterByDate(getFactsRevenueDaily(state), (row) => row.date, filters?.dateRange)
        .filter((row) => row.amount_accrual > 0)
        .filter((row) => !filters?.product || row.product_id === filters.product)
        .filter((row) => !filters?.region || row.region === filters.region);
      const expenseFacts = filterByDate(getFactsExpensesDaily(state), (row) => row.date, filters?.dateRange);

      if (revenueFacts.length === 0) {
        return [] as MarginTrendTimeSeries[];
      }

      const useDailyGranularity = Boolean(filters?.dateRange?.from && filters?.dateRange?.to &&
        Math.abs(filters.dateRange.to.getTime() - filters.dateRange.from.getTime()) / (1000 * 60 * 60 * 24) <= 30);

      const revenueByPeriod = revenueFacts.reduce<Record<string, { period: string; dateKey: string; revenue: number }>>((accumulator, row) => {
        const date = new Date(`${row.date}T00:00:00`);
        const period = useDailyGranularity ? format(date, "MMM dd") : format(date, "MMM yyyy");
        const dateKey = useDailyGranularity ? format(date, "yyyy-MM-dd") : format(date, "yyyy-MM");
        if (!accumulator[period]) {
          accumulator[period] = { period, dateKey, revenue: 0 };
        }
        accumulator[period].revenue += row.amount_accrual;
        return accumulator;
      }, {});

      const expensesByPeriod = expenseFacts.reduce<Record<string, { cogs: number; opex: number }>>((accumulator, row) => {
        const date = new Date(`${row.date}T00:00:00`);
        const period = useDailyGranularity ? format(date, "MMM dd") : format(date, "MMM yyyy");
        if (!accumulator[period]) {
          accumulator[period] = { cogs: 0, opex: 0 };
        }
        if (isCogsCategory(row.category)) {
          accumulator[period].cogs += row.amount;
        } else {
          accumulator[period].opex += row.amount;
        }
        return accumulator;
      }, {});

      return Object.values(revenueByPeriod)
        .map((row) => {
          const expenses = expensesByPeriod[row.period] || { cogs: 0, opex: 0 };
          const grossProfit = row.revenue - expenses.cogs;
          const operatingProfit = grossProfit - expenses.opex;
          const netProfit = operatingProfit;
          return {
            period: row.period,
            dateKey: row.dateKey,
            grossMargin: row.revenue > 0 ? (grossProfit / row.revenue) * 100 : 0,
            operatingMargin: row.revenue > 0 ? (operatingProfit / row.revenue) * 100 : 0,
            netMargin: row.revenue > 0 ? (netProfit / row.revenue) * 100 : 0,
          };
        })
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
    },
  });
}
