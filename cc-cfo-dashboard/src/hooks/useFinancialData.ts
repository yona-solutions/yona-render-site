import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { useAccountingSettings } from "./useAccountingSettings";
import {
  convertCurrency,
  filterByDate,
  getFactsCashflowDaily,
  getFactsExpensesDaily,
  getFactsRevenueDaily,
  getMockState,
} from "@/mock/mockFinance";

export interface FinancialMetric {
  id: string;
  metric_type: string;
  amount: number;
  period_start: string;
  period_end: string;
  period_type: string;
}

export interface RevenueSource {
  id: string;
  name: string;
  category: string;
  amount: number;
  percentage: number;
  growth_rate: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  category: string;
  amount: number;
  percentage: number;
  growth_rate: number;
  budget_amount: number;
}

export interface RegionalRevenue {
  id: string;
  region: string;
  amount: number;
  percentage: number;
  growth_rate: number;
}

export interface Client {
  id: string;
  name: string;
  revenue: number;
  growth_rate: number;
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  amount: number;
}

export interface KPI {
  id: string;
  kpi_name: string;
  value: number;
  unit: string;
  growth_rate: number;
}

export interface RevenueTrendData {
  period: string;
  dateKey: string;
  accrual: number;
  cash: number;
}

function getDefaultRange(dateRange?: { from?: Date; to?: Date }) {
  const today = new Date();
  return {
    from: dateRange?.from || startOfMonth(subMonths(today, 12)),
    to: dateRange?.to || endOfMonth(today),
  };
}

function slugExpenseCategory(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("payroll") || lower.includes("salary")) return "salaries";
  if (lower.includes("marketing")) return "marketing";
  if (lower.includes("software")) return "technology";
  if (lower.includes("cost of sales") || lower.includes("materials") || lower.includes("cost of goods")) return "cogs";
  return "operations";
}

function aggregateByPeriod<T extends { date: string }>(
  items: T[],
  mapValue: (item: T) => Record<string, number>,
  useDailyGranularity: boolean
) {
  const aggregated = items.reduce<Record<string, any>>((accumulator, item) => {
    const dateObject = new Date(`${item.date}T00:00:00`);
    const period = useDailyGranularity ? format(dateObject, "MMM dd") : format(dateObject, "MMM yyyy");
    const dateKey = useDailyGranularity ? format(dateObject, "yyyy-MM-dd") : format(dateObject, "yyyy-MM");
    if (!accumulator[period]) {
      accumulator[period] = { period, dateKey };
    }
    const mappedValues = mapValue(item);
    for (const [key, value] of Object.entries(mappedValues)) {
      accumulator[period][key] = (accumulator[period][key] || 0) + value;
    }
    return accumulator;
  }, {});

  return Object.values(aggregated).sort((left: any, right: any) => left.dateKey.localeCompare(right.dateKey));
}

export function useFinancialMetrics(dateRange?: { from?: Date; to?: Date }) {
  const { data: settings } = useAccountingSettings();
  const basis = settings?.basis || "accrual";

  return useQuery({
    queryKey: ["financial-metrics", basis, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const range = getDefaultRange(dateRange);
      const revenueFacts = filterByDate(getFactsRevenueDaily(state), (row) => row.date, range);
      const expenseFacts = filterByDate(getFactsExpensesDaily(state), (row) => row.date, range);
      const cashflowFacts = filterByDate(getFactsCashflowDaily(state), (row) => row.date, range);

      const totalAccrualRevenue = revenueFacts.reduce((sum, row) => sum + row.amount_accrual, 0);
      const totalCashRevenue = revenueFacts.reduce((sum, row) => sum + row.amount_cash, 0);
      const totalRevenue = basis === "cash" && totalCashRevenue > 0 ? totalCashRevenue : totalAccrualRevenue;
      const totalExpenses = expenseFacts.reduce((sum, row) => sum + row.amount, 0);
      const inflow = cashflowFacts.reduce((sum, row) => sum + row.inflow, 0);
      const outflow = cashflowFacts.reduce((sum, row) => sum + row.outflow, 0);
      const profit = totalRevenue - totalExpenses;

      const recentMonthlyRevenue = aggregateByPeriod(
        revenueFacts.filter((row) => row.amount_accrual > 0),
        (row) => ({ accrual: row.amount_accrual }),
        false
      );
      const lastRevenuePeriod = recentMonthlyRevenue[recentMonthlyRevenue.length - 1] as { accrual?: number } | undefined;
      const mrr = Number(lastRevenuePeriod?.accrual || 0);

      const start = format(range.from, "yyyy-MM-dd");
      const end = format(range.to, "yyyy-MM-dd");

      return [
        { id: "metric-revenue", metric_type: "revenue", amount: totalRevenue, period_start: start, period_end: end, period_type: basis },
        { id: "metric-expenses", metric_type: "expenses", amount: totalExpenses, period_start: start, period_end: end, period_type: "accrual" },
        { id: "metric-profit", metric_type: "profit", amount: profit, period_start: start, period_end: end, period_type: basis },
        { id: "metric-cashflow", metric_type: "cash_flow", amount: inflow - outflow, period_start: start, period_end: end, period_type: "cash" },
        { id: "metric-mrr", metric_type: "mrr", amount: mrr, period_start: start, period_end: end, period_type: basis },
        { id: "metric-arr", metric_type: "arr", amount: mrr * 12, period_start: start, period_end: end, period_type: basis },
      ] as FinancialMetric[];
    },
  });
}

export function useRevenueSources(dateRange?: { from?: Date; to?: Date }, currency: string = "USD") {
  const { data: settings } = useAccountingSettings();
  const basis = settings?.basis || "accrual";

  return useQuery({
    queryKey: ["revenue-data", basis, currency, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const range = getDefaultRange(dateRange);
      const rows = filterByDate(getFactsRevenueDaily(state), (row) => row.date, range);

      const grouped = rows.reduce<Record<string, RevenueSource>>((accumulator, row) => {
        const key = row.channel || row.product_id || "Other";
        const rawAmount = basis === "cash" && rows.some((item) => item.amount_cash > 0) ? row.amount_cash : row.amount_accrual;
        const converted = convertCurrency(rawAmount, "USD", currency, row.date, state);

        if (!accumulator[key]) {
          accumulator[key] = {
            id: `rev-${key}`,
            name: key,
            category: "Revenue",
            amount: 0,
            percentage: 0,
            growth_rate: 0,
          };
        }
        accumulator[key].amount += converted;
        return accumulator;
      }, {});

      const result = Object.values(grouped).filter((item) => item.amount > 0);
      const total = result.reduce((sum, item) => sum + item.amount, 0);
      result.forEach((item) => {
        item.percentage = total > 0 ? (item.amount / total) * 100 : 0;
      });

      return result.sort((left, right) => right.amount - left.amount);
    },
  });
}

export function useExpenseCategories(dateRange?: { from?: Date; to?: Date }, currency: string = "USD") {
  return useQuery({
    queryKey: ["expense-data", currency, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const range = getDefaultRange(dateRange);
      const rows = filterByDate(state.expenses, (row) => row.date, range);

      const grouped = rows.reduce<Record<string, ExpenseCategory>>((accumulator, row) => {
        const key = row.category || "Other";
        const converted = convertCurrency(row.amount, "USD", currency, row.date, state);
        if (!accumulator[key]) {
          accumulator[key] = {
            id: `exp-${key}`,
            name: key,
            category: slugExpenseCategory(key),
            amount: 0,
            percentage: 0,
            growth_rate: 0,
            budget_amount: 0,
          };
        }
        accumulator[key].amount += converted;
        accumulator[key].budget_amount += converted * 1.08;
        return accumulator;
      }, {});

      const result = Object.values(grouped);
      const total = result.reduce((sum, item) => sum + item.amount, 0);
      result.forEach((item) => {
        item.percentage = total > 0 ? (item.amount / total) * 100 : 0;
      });
      return result.sort((left, right) => right.amount - left.amount);
    },
  });
}

export function useExpenseTrends(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["expense-trends", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const range = getDefaultRange(dateRange);
      const rows = filterByDate(getFactsExpensesDaily(state), (row) => row.date, range);
      const dateRangeDays = Math.abs(range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24);
      const useDailyGranularity = dateRangeDays <= 30;

      return aggregateByPeriod(
        rows,
        (row) => ({
          expenses: row.amount,
          cogs: slugExpenseCategory(row.category) === "cogs" ? row.amount : 0,
          opex: slugExpenseCategory(row.category) === "cogs" ? 0 : row.amount,
        }),
        useDailyGranularity
      );
    },
  });
}

export function useRegionalRevenue() {
  return useQuery({
    queryKey: ["regional-revenue"],
    queryFn: async () => {
      const state = getMockState();
      const rows = getFactsRevenueDaily(state).filter((row) => row.amount_accrual > 0);
      const total = rows.reduce((sum, row) => sum + row.amount_accrual, 0);
      const grouped = rows.reduce<Record<string, RegionalRevenue>>((accumulator, row) => {
        const key = row.region || "Unspecified";
        if (!accumulator[key]) {
          accumulator[key] = {
            id: `region-${key}`,
            region: key,
            amount: 0,
            percentage: 0,
            growth_rate: 0,
          };
        }
        accumulator[key].amount += row.amount_accrual;
        return accumulator;
      }, {});

      return Object.values(grouped)
        .map((item) => ({ ...item, percentage: total > 0 ? (item.amount / total) * 100 : 0 }))
        .sort((left, right) => right.amount - left.amount);
    },
  });
}

export function useTopClients() {
  return useQuery({
    queryKey: ["top-clients"],
    queryFn: async () => {
      const state = getMockState();
      const grouped = state.invoices.reduce<Record<string, Client>>((accumulator, invoice) => {
        const name = state.customers.find((customer) => customer.id === invoice.customer_id)?.name || "Unknown";
        if (!accumulator[invoice.customer_id]) {
          accumulator[invoice.customer_id] = {
            id: invoice.customer_id,
            name,
            revenue: 0,
            growth_rate: 0,
          };
        }
        accumulator[invoice.customer_id].revenue += invoice.amount_total_base;
        return accumulator;
      }, {});

      return Object.values(grouped)
        .sort((left, right) => right.revenue - left.revenue)
        .slice(0, 10);
    },
  });
}

export function useVendors(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["vendors", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const range = getDefaultRange(dateRange);
      const rows = filterByDate(state.expenses, (row) => row.date, range);
      const grouped = rows.reduce<Record<string, Vendor>>((accumulator, row) => {
        if (!accumulator[row.vendor]) {
          accumulator[row.vendor] = {
            id: `vendor-${row.vendor}`,
            name: row.vendor,
            category: row.category,
            amount: 0,
          };
        }
        accumulator[row.vendor].amount += row.amount;
        return accumulator;
      }, {});
      return Object.values(grouped).sort((left, right) => right.amount - left.amount);
    },
  });
}

export function useKPIs() {
  return useQuery({
    queryKey: ["kpis"],
    queryFn: async () => {
      const state = getMockState();
      const activeCustomers = new Set(
        state.invoices
          .filter((invoice) => invoice.issue_date >= format(subMonths(new Date(), 3), "yyyy-MM-dd"))
          .map((invoice) => invoice.customer_id)
      ).size;

      const totalOrders = state.invoices.length;
      const totalPaid = state.invoices.filter((invoice) => invoice.status === "Paid").length;
      const conversionRate = totalOrders > 0 ? (totalPaid / totalOrders) * 100 : 0;

      return [
        { id: "kpi-active-customers", kpi_name: "Active Customers", value: activeCustomers, unit: "count", growth_rate: 8.4 },
        { id: "kpi-total-orders", kpi_name: "Total Orders", value: totalOrders, unit: "count", growth_rate: 5.1 },
        { id: "kpi-conversion-rate", kpi_name: "Conversion Rate", value: conversionRate, unit: "%", growth_rate: 1.9 },
      ] as KPI[];
    },
  });
}

export function useRevenueTrends(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["revenue-trends", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const range = getDefaultRange(dateRange);
      const rows = filterByDate(getFactsRevenueDaily(state), (row) => row.date, range);
      if (rows.length === 0) {
        return [] as RevenueTrendData[];
      }

      const dateRangeDays = Math.abs(range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24);
      const useDailyGranularity = dateRangeDays <= 30;

      return aggregateByPeriod(rows, (row) => ({
        accrual: row.amount_accrual,
        cash: row.amount_cash,
      }), useDailyGranularity) as RevenueTrendData[];
    },
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}
