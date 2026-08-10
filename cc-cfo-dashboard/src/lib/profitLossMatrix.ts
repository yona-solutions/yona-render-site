import { addMonths, differenceInCalendarMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { calculateVariancePercent, resolvePeriodRange, type ProfitLossFilters } from "@/lib/profitLoss";

export interface ProfitLossMatrixColumn {
  id: string;
  label: string;
  compareLabel?: string;
  isTotal?: boolean;
}

export interface ProfitLossMatrixCell {
  amount: number | null;
  compareAmount: number | null;
  variancePercent: number | null;
}

export interface ProfitLossMatrixRow {
  id: string;
  label: string;
  depth: number;
  rowType: "section" | "account" | "subtotal" | "total";
  section?: "Revenue" | "Cost of Goods Sold" | "Operating Expenses" | "Other Expenses" | "Other Income" | "Summary";
  parentLabel?: string;
  cells: ProfitLossMatrixCell[];
}

export interface ProfitLossMatrixData {
  columns: ProfitLossMatrixColumn[];
  rows: ProfitLossMatrixRow[];
  periodLabel: string;
  source: "mock" | "quickbooks";
}

export interface MonthlyMatrixRange {
  from: Date;
  to: Date;
  label: string;
  compareFrom: Date;
  compareTo: Date;
  compareLabel: string;
}

function buildShiftedDate(baseDate: Date, targetMonthDate: Date) {
  const lastDayOfTargetMonth = endOfMonth(targetMonthDate).getDate();
  const day = Math.min(baseDate.getDate(), lastDayOfTargetMonth);
  return new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), day);
}

export function formatMonthlyMatrixLabel(from: Date, to: Date) {
  const fullMonth =
    from.getTime() === startOfMonth(from).getTime() &&
    to.getTime() === endOfMonth(from).getTime();

  if (fullMonth) {
    return format(from, "MMM yyyy");
  }

  return `${format(from, "MMM d")}-${format(to, "d, yyyy")}`;
}

export function buildMonthlyMatrixRanges(filters: ProfitLossFilters): MonthlyMatrixRange[] {
  const resolvedRange = resolvePeriodRange(filters);
  const firstMonth = startOfMonth(resolvedRange.from);
  const lastMonth = startOfMonth(resolvedRange.to);
  const monthCount = differenceInCalendarMonths(lastMonth, firstMonth) + 1;

  return Array.from({ length: monthCount }, (_, index) => {
    const monthDate = addMonths(firstMonth, index);
    const from = index === 0 ? resolvedRange.from : startOfMonth(monthDate);
    const to = index === monthCount - 1 ? resolvedRange.to : endOfMonth(monthDate);
    const compareMonthDate = new Date(monthDate.getFullYear() - 1, monthDate.getMonth(), 1);
    const compareFrom =
      index === 0
        ? buildShiftedDate(from, compareMonthDate)
        : startOfMonth(compareMonthDate);
    const compareTo =
      index === monthCount - 1
        ? buildShiftedDate(to, compareMonthDate)
        : endOfMonth(compareMonthDate);

    return {
      from,
      to,
      label: formatMonthlyMatrixLabel(from, to),
      compareFrom,
      compareTo,
      compareLabel: formatMonthlyMatrixLabel(compareFrom, compareTo),
    };
  });
}

export function buildProfitLossMatrixKey(row: {
  label: string;
  depth: number;
  rowType: "section" | "account" | "subtotal" | "total";
  section?: string;
  parentLabel?: string;
}) {
  return [row.section || "", row.depth, row.rowType, row.parentLabel || "", row.label].join("|");
}

export function buildMatrixCell(amount: number | null, compareAmount: number | null): ProfitLossMatrixCell {
  return {
    amount,
    compareAmount,
    variancePercent:
      amount === null || compareAmount === null
        ? null
        : calculateVariancePercent(amount, compareAmount),
  };
}
