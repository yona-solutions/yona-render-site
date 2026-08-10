import { useQuery } from "@tanstack/react-query";
import {
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
} from "date-fns";
import { convertCurrency, getMockState } from "@/mock/mockFinance";
import {
  buildComparisonRange,
  calculateVariancePercent,
  ProfitLossFilters,
  ProfitLossRow,
  ProfitLossStatementData,
  ProfitLossSummary,
  resolvePeriodRange,
  StatementOptions,
  type ResolvedRange,
} from "@/lib/profitLoss";

export interface StatementGroups {
  revenue: Map<string, number>;
  cogs: Map<string, number>;
  operatingExpenses: Map<string, number>;
  summary: ProfitLossSummary;
}

export function buildOptions(): StatementOptions {
  const state = getMockState();
  const years = Array.from(
    new Set([
      ...state.invoices.map((invoice) => new Date(`${invoice.issue_date}T00:00:00`).getFullYear()),
      ...state.expenses.map((expense) => new Date(`${expense.date}T00:00:00`).getFullYear()),
    ]),
  ).sort((left, right) => right - left);

  return {
    years,
    regions: Array.from(new Set(state.invoices.map((invoice) => invoice.region).filter(Boolean) as string[])).sort(),
    products: Array.from(new Set(state.invoices.map((invoice) => invoice.product_id).filter(Boolean) as string[])).sort(),
    channels: Array.from(new Set(state.invoices.map((invoice) => invoice.channel).filter(Boolean) as string[])).sort(),
    departments: Array.from(new Set(state.expenses.map((expense) => expense.department).filter(Boolean) as string[])).sort(),
    expenseCategories: Array.from(new Set(state.expenses.map((expense) => expense.category).filter(Boolean) as string[])).sort(),
  };
}

function isCogsCategory(category: string) {
  const lower = category.toLowerCase();
  return lower.includes("cost of sales") || lower.includes("cost of goods") || lower.includes("materials");
}

function isDateWithinRange(value: string, range: { from: Date; to: Date }) {
  const date = new Date(`${value}T00:00:00`);
  return date >= range.from && date <= range.to;
}

function addAmount(target: Map<string, number>, key: string, amount: number) {
  target.set(key, (target.get(key) || 0) + amount);
}

export function buildStatementGroups(filters: ProfitLossFilters, range: ResolvedRange): StatementGroups {
  const state = getMockState();
  const invoiceById = new Map(state.invoices.map((invoice) => [invoice.id, invoice]));
  const customerById = new Map(state.customers.map((customer) => [customer.id, customer]));
  const revenue = new Map<string, number>();
  const cogs = new Map<string, number>();
  const operatingExpenses = new Map<string, number>();

  if (filters.basis === "cash") {
    state.payments.forEach((payment) => {
      const invoice = invoiceById.get(payment.invoice_id);
      const customer = invoice ? customerById.get(invoice.customer_id) : undefined;
      if (!invoice) {
        return;
      }
      if (!isDateWithinRange(payment.date, range)) {
        return;
      }
      if (filters.region && invoice.region !== filters.region) {
        return;
      }
      if (filters.product && invoice.product_id !== filters.product) {
        return;
      }
      if (filters.channel && invoice.channel !== filters.channel) {
        return;
      }
      if (invoice.status === "Cancelled") {
        return;
      }

      const label = invoice.product_id || customer?.name || invoice.channel || "Other Revenue";
      const amount = convertCurrency(payment.amount, "USD", filters.currency, payment.date, state);
      addAmount(revenue, label, amount);
    });
  } else {
    state.invoices.forEach((invoice) => {
      const customer = customerById.get(invoice.customer_id);
      if (!isDateWithinRange(invoice.issue_date, range)) {
        return;
      }
      if (invoice.status === "Cancelled") {
        return;
      }
      if (!filters.includeDrafts && invoice.status === "Draft") {
        return;
      }
      if (filters.region && invoice.region !== filters.region) {
        return;
      }
      if (filters.product && invoice.product_id !== filters.product) {
        return;
      }
      if (filters.channel && invoice.channel !== filters.channel) {
        return;
      }

      const label = invoice.product_id || customer?.name || invoice.channel || "Other Revenue";
      const amount = convertCurrency(invoice.amount_total_base, "USD", filters.currency, invoice.issue_date, state);
      addAmount(revenue, label, amount);
    });
  }

  state.expenses.forEach((expense) => {
    if (!isDateWithinRange(expense.date, range)) {
      return;
    }
    if (filters.department && expense.department !== filters.department) {
      return;
    }
    if (filters.expenseCategory && expense.category !== filters.expenseCategory) {
      return;
    }

    const amount = convertCurrency(expense.amount, "USD", filters.currency, expense.date, state);
    if (isCogsCategory(expense.category)) {
      addAmount(cogs, expense.category, amount);
      return;
    }
    addAmount(operatingExpenses, expense.category, amount);
  });

  const totalRevenue = Array.from(revenue.values()).reduce((sum, amount) => sum + amount, 0);
  const totalCogs = Array.from(cogs.values()).reduce((sum, amount) => sum + amount, 0);
  const totalOperatingExpenses = Array.from(operatingExpenses.values()).reduce((sum, amount) => sum + amount, 0);
  const grossProfit = totalRevenue - totalCogs;
  const operatingIncome = grossProfit - totalOperatingExpenses;
  const netIncome = operatingIncome;

  return {
    revenue,
    cogs,
    operatingExpenses,
    summary: {
      revenue: totalRevenue,
      cogs: totalCogs,
      grossProfit,
      operatingExpenses: totalOperatingExpenses,
      operatingIncome,
      netIncome,
      grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      netMargin: totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0,
    },
  };
}

function buildDetailRows(
  section: ProfitLossRow["section"],
  rowLabel: string,
  currentMap: Map<string, number>,
  compareMap: Map<string, number> | null,
  currentRevenue: number,
): ProfitLossRow[] {
  const keys = Array.from(new Set([...currentMap.keys(), ...(compareMap ? Array.from(compareMap.keys()) : [])]));
  return keys
    .map((key) => {
      const amount = currentMap.get(key) || 0;
      const compareAmount = compareMap ? compareMap.get(key) || 0 : null;
      return {
        id: `${section}-${key}`,
        section,
        label: key,
        rowType: "detail" as const,
        amount,
        compareAmount,
        varianceAmount: compareAmount === null ? null : amount - compareAmount,
        variancePercent: calculateVariancePercent(amount, compareAmount),
        percentOfRevenue: currentRevenue > 0 ? (amount / currentRevenue) * 100 : null,
      };
    })
    .sort((left, right) => (right.amount || 0) - (left.amount || 0));
}

export function buildRows(
  current: StatementGroups,
  comparison: StatementGroups | null,
): ProfitLossRow[] {
  const rows: ProfitLossRow[] = [];
  const currentRevenue = current.summary.revenue;

  const addSummaryRow = (
    id: string,
    section: ProfitLossRow["section"],
    label: string,
    rowType: ProfitLossRow["rowType"],
    amount: number,
    compareAmount: number | null,
  ) => {
    rows.push({
      id,
      section,
      label,
      rowType,
      amount,
      compareAmount,
      varianceAmount: compareAmount === null ? null : amount - compareAmount,
      variancePercent: calculateVariancePercent(amount, compareAmount),
      percentOfRevenue: currentRevenue > 0 ? (amount / currentRevenue) * 100 : null,
    });
  };

  rows.push({
    id: "revenue-section",
    section: "Revenue",
    label: "Revenue",
    rowType: "section",
    amount: null,
    compareAmount: null,
    varianceAmount: null,
    variancePercent: null,
    percentOfRevenue: null,
  });
  rows.push(
    ...buildDetailRows("Revenue", "Revenue", current.revenue, comparison?.revenue || null, currentRevenue),
  );
  addSummaryRow(
    "revenue-total",
    "Revenue",
    "Total Revenue",
    "subtotal",
    current.summary.revenue,
    comparison?.summary.revenue ?? null,
  );

  rows.push({
    id: "cogs-section",
    section: "Cost of Goods Sold",
    label: "Cost of Goods Sold",
    rowType: "section",
    amount: null,
    compareAmount: null,
    varianceAmount: null,
    variancePercent: null,
    percentOfRevenue: null,
  });
  rows.push(
    ...buildDetailRows("Cost of Goods Sold", "Cost of Goods Sold", current.cogs, comparison?.cogs || null, currentRevenue),
  );
  addSummaryRow(
    "cogs-total",
    "Cost of Goods Sold",
    "Total Cost of Goods Sold",
    "subtotal",
    current.summary.cogs,
    comparison?.summary.cogs ?? null,
  );
  addSummaryRow(
    "gross-profit-total",
    "Summary",
    "Gross Profit",
    "total",
    current.summary.grossProfit,
    comparison?.summary.grossProfit ?? null,
  );

  rows.push({
    id: "opex-section",
    section: "Operating Expenses",
    label: "Operating Expenses",
    rowType: "section",
    amount: null,
    compareAmount: null,
    varianceAmount: null,
    variancePercent: null,
    percentOfRevenue: null,
  });
  rows.push(
    ...buildDetailRows(
      "Operating Expenses",
      "Operating Expenses",
      current.operatingExpenses,
      comparison?.operatingExpenses || null,
      currentRevenue,
    ),
  );
  addSummaryRow(
    "opex-total",
    "Operating Expenses",
    "Total Operating Expenses",
    "subtotal",
    current.summary.operatingExpenses,
    comparison?.summary.operatingExpenses ?? null,
  );
  addSummaryRow(
    "operating-income-total",
    "Summary",
    "Operating Income",
    "total",
    current.summary.operatingIncome,
    comparison?.summary.operatingIncome ?? null,
  );
  addSummaryRow(
    "net-income-total",
    "Summary",
    "Net Income",
    "total",
    current.summary.netIncome,
    comparison?.summary.netIncome ?? null,
  );

  return rows;
}

export function useProfitLossStatement(filters: ProfitLossFilters, enabled = true) {
  return useQuery({
    queryKey: [
      "profit-loss-statement",
      filters.periodPreset,
      filters.month,
      filters.year,
      filters.customFrom,
      filters.customTo,
      filters.basis,
      filters.currency,
      filters.comparison,
      filters.region,
      filters.product,
      filters.channel,
      filters.department,
      filters.expenseCategory,
      filters.includeDrafts,
    ],
    enabled,
    queryFn: async (): Promise<ProfitLossStatementData> => {
      const currentRange = resolvePeriodRange(filters);
      const current = buildStatementGroups(filters, currentRange);
      const comparisonRange = filters.comparison === "previous_period" ? buildComparisonRange(currentRange) : null;
      const comparison = comparisonRange ? buildStatementGroups(filters, comparisonRange) : null;

      return {
        rows: buildRows(current, comparison),
        summary: current.summary,
        comparisonSummary: comparison?.summary ?? null,
        options: buildOptions(),
        periodLabel: currentRange.label,
        comparisonLabel: comparisonRange?.label ?? null,
        source: "mock",
      };
    },
  });
}
