import {
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
} from "date-fns";

export type ProfitLossPeriodPreset =
  | "month"
  | "month_to_date"
  | "quarter_to_date"
  | "year_to_date"
  | "last_month"
  | "last_quarter"
  | "trailing_twelve_months"
  | "custom";

export type ProfitLossComparison = "none" | "previous_period";

export interface ProfitLossFilters {
  periodPreset: ProfitLossPeriodPreset;
  month: number;
  year: number;
  customFrom?: string;
  customTo?: string;
  basis: "accrual" | "cash";
  currency: string;
  comparison: ProfitLossComparison;
  region?: string;
  product?: string;
  channel?: string;
  department?: string;
  expenseCategory?: string;
  includeDrafts: boolean;
}

export interface ProfitLossRow {
  id: string;
  section: "Revenue" | "Cost of Goods Sold" | "Operating Expenses" | "Other Expenses" | "Other Income" | "Summary";
  label: string;
  rowType: "section" | "detail" | "subtotal" | "total";
  amount: number | null;
  compareAmount: number | null;
  varianceAmount: number | null;
  variancePercent: number | null;
  percentOfRevenue: number | null;
}

export interface ProfitLossSummary {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  grossMargin: number;
  netMargin: number;
}

export interface StatementOptions {
  years: number[];
  regions: string[];
  products: string[];
  channels: string[];
  departments: string[];
  expenseCategories: string[];
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
}

export interface ProfitLossStatementData {
  rows: ProfitLossRow[];
  summary: ProfitLossSummary;
  comparisonSummary: ProfitLossSummary | null;
  options: StatementOptions;
  periodLabel: string;
  comparisonLabel: string | null;
  source: "mock" | "quickbooks";
}

export function formatRangeLabel(from: Date, to: Date) {
  return `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
}

export function resolvePeriodRange(filters: ProfitLossFilters): ResolvedRange {
  const today = new Date();

  switch (filters.periodPreset) {
    case "month": {
      const start = startOfMonth(new Date(filters.year, filters.month, 1));
      return {
        from: start,
        to: endOfMonth(start),
        label: format(start, "MMMM yyyy"),
      };
    }
    case "month_to_date":
      return {
        from: startOfMonth(today),
        to: today,
        label: `Month to Date (${formatRangeLabel(startOfMonth(today), today)})`,
      };
    case "quarter_to_date":
      return {
        from: startOfQuarter(today),
        to: today,
        label: `Quarter to Date (${formatRangeLabel(startOfQuarter(today), today)})`,
      };
    case "year_to_date":
      return {
        from: startOfYear(today),
        to: today,
        label: `Year to Date (${formatRangeLabel(startOfYear(today), today)})`,
      };
    case "last_month": {
      const lastMonth = subMonths(today, 1);
      return {
        from: startOfMonth(lastMonth),
        to: endOfMonth(lastMonth),
        label: format(lastMonth, "MMMM yyyy"),
      };
    }
    case "last_quarter": {
      const lastQuarter = subQuarters(today, 1);
      return {
        from: startOfQuarter(lastQuarter),
        to: endOfQuarter(lastQuarter),
        label: `Last Quarter (${format(startOfQuarter(lastQuarter), "MMM d")} - ${format(endOfQuarter(lastQuarter), "MMM d, yyyy")})`,
      };
    }
    case "trailing_twelve_months": {
      const start = startOfMonth(subMonths(today, 11));
      const end = today;
      return {
        from: start,
        to: end,
        label: `Past 12 Months (${formatRangeLabel(start, end)})`,
      };
    }
    case "custom": {
      const from = filters.customFrom ? new Date(`${filters.customFrom}T00:00:00`) : startOfMonth(today);
      const to = filters.customTo ? new Date(`${filters.customTo}T00:00:00`) : today;
      return {
        from,
        to,
        label: `Custom (${formatRangeLabel(from, to)})`,
      };
    }
    default:
      return {
        from: startOfMonth(today),
        to: endOfMonth(today),
        label: format(today, "MMMM yyyy"),
      };
  }
}

export function buildComparisonRange(range: ResolvedRange): ResolvedRange {
  const daysInRange = differenceInCalendarDays(range.to, range.from);
  const compareTo = subDays(range.from, 1);
  const compareFrom = subDays(compareTo, daysInRange);
  return {
    from: compareFrom,
    to: compareTo,
    label: `Previous Period (${formatRangeLabel(compareFrom, compareTo)})`,
  };
}

export function calculateVariancePercent(amount: number, compareAmount: number | null) {
  if (compareAmount === null || compareAmount === 0) {
    return null;
  }
  return ((amount - compareAmount) / Math.abs(compareAmount)) * 100;
}

export function buildSummaryFromRows(rows: ProfitLossRow[]): ProfitLossSummary {
  const findAmount = (id: string) => rows.find((row) => row.id === id)?.amount || 0;

  const revenue = findAmount("revenue-total");
  const cogs = findAmount("cogs-total");
  const grossProfit = findAmount("gross-profit-total");
  const operatingExpenses = findAmount("opex-total");
  const operatingIncome = findAmount("operating-income-total");
  const netIncome = findAmount("net-income-total");

  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    operatingIncome,
    netIncome,
    grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    netMargin: revenue > 0 ? (netIncome / revenue) * 100 : 0,
  };
}
