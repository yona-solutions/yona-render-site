import {
  endOfMonth,
  endOfQuarter,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subQuarters,
} from "date-fns";

export type BalanceSheetPeriodPreset =
  | "month"
  | "month_to_date"
  | "quarter_to_date"
  | "year_to_date"
  | "last_month"
  | "last_quarter"
  | "custom";

export interface BalanceSheetFilters {
  periodPreset: BalanceSheetPeriodPreset;
  month: number;
  year: number;
  customDate?: string;
  basis: "accrual" | "cash";
  currency: string;
}

export interface BalanceSheetRow {
  id: string;
  label: string;
  amount: number | null;
  depth: number;
  rowType: "section" | "account" | "subtotal" | "total";
  section?: "Assets" | "Liabilities & Equity" | "Summary";
  parentLabel?: string;
}

export interface BalanceSheetStatementData {
  rows: BalanceSheetRow[];
  options: {
    years: number[];
  };
  periodLabel: string;
  asOfDate: string;
  source: "mock" | "quickbooks";
}

export interface ResolvedBalanceSheetRange {
  from: Date;
  to: Date;
  label: string;
}

export function resolveBalanceSheetRange(filters: BalanceSheetFilters): ResolvedBalanceSheetRange {
  const today = new Date();

  switch (filters.periodPreset) {
    case "month": {
      const start = startOfMonth(new Date(filters.year, filters.month, 1));
      const end = endOfMonth(start);
      return {
        from: start,
        to: end,
        label: format(end, "MMMM d, yyyy"),
      };
    }
    case "month_to_date":
      return {
        from: startOfMonth(today),
        to: today,
        label: format(today, "MMMM d, yyyy"),
      };
    case "quarter_to_date":
      return {
        from: startOfQuarter(today),
        to: today,
        label: format(today, "MMMM d, yyyy"),
      };
    case "year_to_date":
      return {
        from: startOfYear(today),
        to: today,
        label: format(today, "MMMM d, yyyy"),
      };
    case "last_month": {
      const lastMonth = subMonths(today, 1);
      const end = endOfMonth(lastMonth);
      return {
        from: startOfMonth(lastMonth),
        to: end,
        label: format(end, "MMMM d, yyyy"),
      };
    }
    case "last_quarter": {
      const lastQuarter = subQuarters(today, 1);
      const end = endOfQuarter(lastQuarter);
      return {
        from: startOfQuarter(lastQuarter),
        to: end,
        label: format(end, "MMMM d, yyyy"),
      };
    }
    case "custom": {
      const selectedDate = filters.customDate ? new Date(`${filters.customDate}T00:00:00`) : today;
      return {
        from: selectedDate,
        to: selectedDate,
        label: format(selectedDate, "MMMM d, yyyy"),
      };
    }
    default:
      return {
        from: startOfMonth(today),
        to: today,
        label: format(today, "MMMM d, yyyy"),
      };
  }
}
