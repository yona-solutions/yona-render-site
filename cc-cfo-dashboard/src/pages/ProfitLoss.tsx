import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
import { AlertTriangle, Download, FileBarChart, RefreshCw } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useProfitLossMatrix } from "@/hooks/useProfitLossMatrix";
import { useQuickBooksConnectionStatus } from "@/hooks/useQuickBooksConnectionStatus";
import { useQuickBooksProfitLoss } from "@/hooks/useQuickBooksProfitLoss";
import { useQuickBooksProfitLossMatrix } from "@/hooks/useQuickBooksProfitLossMatrix";
import {
  ProfitLossFilters,
  ProfitLossPeriodPreset,
  useProfitLossStatement,
} from "@/hooks/useProfitLossStatement";
import { type ProfitLossSummaryTreeRow, type ProfitLossDetailRow } from "@/lib/quickbooks";
import { buildMonthlyMatrixRanges, type ProfitLossMatrixData, type ProfitLossMatrixRow } from "@/lib/profitLossMatrix";
import { convertCurrency, getMockState } from "@/mock/mockFinance";
import { exportToCSV, exportToExcel, exportToPDF, formatCurrencyForExport } from "@/lib/exportUtils";
import { getExpandableRowIds, getVisibleTreeRows } from "@/lib/statementTree";
import { cn } from "@/lib/utils";

type ViewMode = "summary" | "detail";
type SummaryComparisonMode = "none" | "mom";

interface ReportRange {
  from: Date;
  to: Date;
}

interface ProfitLossDrilldownTransaction extends ProfitLossDetailRow {
  path: string[];
}

const defaultCompanyName = "Cure Company";

const periodOptions: { value: ProfitLossPeriodPreset; label: string }[] = [
  { value: "month", label: "Specific Month" },
  { value: "month_to_date", label: "Month to Date" },
  { value: "quarter_to_date", label: "Quarter to Date" },
  { value: "year_to_date", label: "Year to Date" },
  { value: "last_month", label: "Last Month" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "trailing_twelve_months", label: "Past 12 Months" },
  { value: "custom", label: "Custom Range" },
];

const comparisonOptions = [
  { value: "none", label: "No Comparison" },
  { value: "previous_period", label: "Previous Period" },
];
const currencyOptions = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];
const monthOptions = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatStatementAmount(amount: number | null | undefined, currency: string) {
  if (amount === null || amount === undefined) {
    return "";
  }

  const absolute = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(absolute);

  return amount < 0 ? `(${formatted})` : formatted;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  return `${value.toFixed(1)}%`;
}

function formatVariancePercent(value: number | null) {
  if (value === null) {
    return "";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatHeaderLabel(value: string) {
  return value.replace(/_/g, " ");
}

function normalizeDrilldownLabel(label: string) {
  return label.replace(/^Total for\s+/i, "").trim();
}

function pathStartsWith(path: string[], prefix: string[]) {
  return prefix.every((segment, index) => path[index] === segment);
}

function buildSummaryRowPathMap(rows: ProfitLossMatrixRow[]) {
  const pathById = new Map<string, string[]>();
  const stack: string[] = [];

  rows.forEach((row) => {
    const depth = row.depth ?? 0;
    stack.length = depth;

    const normalizedLabel = normalizeDrilldownLabel(row.label);
    const path = [...stack.slice(0, depth), normalizedLabel];
    pathById.set(row.id, path);

    if (row.rowType !== "total") {
      stack[depth] = normalizedLabel;
    }
  });

  return pathById;
}

function buildDetailTransactionIndex(rows: ProfitLossDetailRow[]): ProfitLossDrilldownTransaction[] {
  const stack: string[] = [];
  const transactions: ProfitLossDrilldownTransaction[] = [];

  rows.forEach((row) => {
    const depth = row.depth ?? 0;

    if (row.rowType === "section") {
      stack.length = 1;
      stack[0] = normalizeDrilldownLabel(row.label);
      return;
    }

    if (row.rowType === "group") {
      stack.length = depth;
      stack[depth] = normalizeDrilldownLabel(row.label);
      return;
    }

    stack.length = depth;
    transactions.push({
      ...row,
      path: stack.slice(0, depth),
    });
  });

  return transactions;
}

function getSummaryTotalSections(row: ProfitLossMatrixRow) {
  if (row.section !== "Summary") {
    return null;
  }

  const normalizedLabel = normalizeDrilldownLabel(row.label).toLowerCase();

  if (normalizedLabel === "gross profit") {
    return new Set<ProfitLossDetailRow["section"]>(["Revenue", "Cost of Goods Sold"]);
  }

  if (normalizedLabel === "operating income" || normalizedLabel === "net operating income") {
    return new Set<ProfitLossDetailRow["section"]>(["Revenue", "Cost of Goods Sold", "Operating Expenses"]);
  }

  if (normalizedLabel === "net other income") {
    return new Set<ProfitLossDetailRow["section"]>(["Other Income", "Other Expenses"]);
  }

  if (normalizedLabel === "net income") {
    return new Set<ProfitLossDetailRow["section"]>([
      "Revenue",
      "Cost of Goods Sold",
      "Operating Expenses",
      "Other Income",
      "Other Expenses",
    ]);
  }

  return null;
}

function getSectionDisplayName(section: string) {
  if (section === "Revenue") {
    return "Income";
  }
  return section;
}

function isCogsCategory(category: string) {
  const lower = category.toLowerCase();
  return lower.includes("cost of sales") || lower.includes("cost of goods") || lower.includes("materials");
}

function resolveReportRange(filters: ProfitLossFilters): ReportRange {
  const today = new Date();

  switch (filters.periodPreset) {
    case "month": {
      const start = startOfMonth(new Date(filters.year, filters.month, 1));
      return { from: start, to: endOfMonth(start) };
    }
    case "month_to_date":
      return { from: startOfMonth(today), to: today };
    case "quarter_to_date":
      return { from: startOfQuarter(today), to: today };
    case "year_to_date":
      return { from: startOfYear(today), to: today };
    case "last_month": {
      const lastMonth = subMonths(today, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
    case "last_quarter": {
      const lastQuarter = subQuarters(today, 1);
      return { from: startOfQuarter(lastQuarter), to: endOfQuarter(lastQuarter) };
    }
    case "trailing_twelve_months":
      return { from: startOfMonth(subMonths(today, 11)), to: today };
    case "custom":
      return {
        from: filters.customFrom ? new Date(`${filters.customFrom}T00:00:00`) : startOfMonth(today),
        to: filters.customTo ? new Date(`${filters.customTo}T00:00:00`) : today,
      };
    default:
      return { from: startOfMonth(today), to: endOfMonth(today) };
  }
}

function isDateWithinRange(value: string, range: ReportRange) {
  const date = new Date(`${value}T00:00:00`);
  return date >= range.from && date <= range.to;
}

function formatDocumentNumber(id: string) {
  const match = id.match(/\d+/);
  return match?.[0] || id.slice(-4).toUpperCase();
}

function matchesInvoiceFilters(filters: ProfitLossFilters, invoice: ReturnType<typeof getMockState>["invoices"][number]) {
  if (invoice.status === "Cancelled") {
    return false;
  }
  if (!filters.includeDrafts && invoice.status === "Draft") {
    return false;
  }
  if (filters.region && invoice.region !== filters.region) {
    return false;
  }
  if (filters.product && invoice.product_id !== filters.product) {
    return false;
  }
  if (filters.channel && invoice.channel !== filters.channel) {
    return false;
  }
  return true;
}

function matchesExpenseFilters(filters: ProfitLossFilters, expense: ReturnType<typeof getMockState>["expenses"][number]) {
  if (filters.department && expense.department !== filters.department) {
    return false;
  }
  if (filters.expenseCategory && expense.category !== filters.expenseCategory) {
    return false;
  }
  return true;
}

function buildDetailRows(filters: ProfitLossFilters): ProfitLossDetailRow[] {
  const state = getMockState();
  const range = resolveReportRange(filters);
  const customerById = new Map(state.customers.map((customer) => [customer.id, customer]));
  const invoiceById = new Map(state.invoices.map((invoice) => [invoice.id, invoice]));

  const revenueGroups = new Map<string, ProfitLossDetailRow[]>();
  const cogsGroups = new Map<string, ProfitLossDetailRow[]>();
  const operatingGroups = new Map<string, ProfitLossDetailRow[]>();

  const addToGroup = (target: Map<string, ProfitLossDetailRow[]>, key: string, row: ProfitLossDetailRow) => {
    const group = target.get(key) || [];
    group.push(row);
    target.set(key, group);
  };

  if (filters.basis === "cash") {
    state.payments.forEach((payment) => {
      const invoice = invoiceById.get(payment.invoice_id);
      const customer = invoice ? customerById.get(invoice.customer_id) : undefined;
      if (!invoice || !matchesInvoiceFilters(filters, invoice) || !isDateWithinRange(payment.date, range)) {
        return;
      }

      const amount = convertCurrency(payment.amount, "USD", filters.currency, payment.date, state);
      const groupKey = invoice.product_id || invoice.channel || customer?.name || "Revenue";

      addToGroup(revenueGroups, groupKey, {
        id: `payment-${payment.id}`,
        rowType: "detail",
        section: "Revenue",
        label: groupKey,
        depth: 2,
        sortDate: payment.date,
        date: format(new Date(`${payment.date}T00:00:00`), "MM/dd/yyyy"),
        transactionType: "Payment",
        num: formatDocumentNumber(payment.id),
        name: customer?.name || "Customer",
        department: "",
        description: `${invoice.channel || "Direct"}${invoice.region ? ` • ${invoice.region}` : ""}`,
        splitAccount: "Undeposited Funds",
        amount,
      });
    });
  } else {
    state.invoices.forEach((invoice) => {
      const customer = customerById.get(invoice.customer_id);
      if (!matchesInvoiceFilters(filters, invoice) || !isDateWithinRange(invoice.issue_date, range)) {
        return;
      }

      const amount = convertCurrency(invoice.amount_total_base, "USD", filters.currency, invoice.issue_date, state);
      const groupKey = invoice.product_id || invoice.channel || customer?.name || "Revenue";

      addToGroup(revenueGroups, groupKey, {
        id: `invoice-${invoice.id}`,
        rowType: "detail",
        section: "Revenue",
        label: groupKey,
        depth: 2,
        sortDate: invoice.issue_date,
        date: format(new Date(`${invoice.issue_date}T00:00:00`), "MM/dd/yyyy"),
        transactionType: "Invoice",
        num: formatDocumentNumber(invoice.id),
        name: customer?.name || "Customer",
        department: "",
        description: `${invoice.channel || "Direct"}${invoice.region ? ` • ${invoice.region}` : ""}`,
        splitAccount: "Accounts Receivable (A/R)",
        amount,
      });
    });
  }

  state.expenses.forEach((expense) => {
    if (!matchesExpenseFilters(filters, expense) || !isDateWithinRange(expense.date, range)) {
      return;
    }

    const amount = convertCurrency(expense.amount, "USD", filters.currency, expense.date, state);
    const target = isCogsCategory(expense.category) ? cogsGroups : operatingGroups;

    addToGroup(target, expense.category, {
      id: `expense-${expense.id}`,
      rowType: "detail",
      section: isCogsCategory(expense.category) ? "Cost of Goods Sold" : "Operating Expenses",
      label: expense.category,
      depth: 2,
      sortDate: expense.date,
      date: format(new Date(`${expense.date}T00:00:00`), "MM/dd/yyyy"),
      transactionType: "Expense",
      num: formatDocumentNumber(expense.id),
      name: expense.vendor,
      department: expense.department || "",
      description: expense.project_id || expense.category,
      splitAccount: expense.category,
      amount,
    });
  });

  const buildSectionRows = (section: ProfitLossDetailRow["section"], groups: Map<string, ProfitLossDetailRow[]>) => {
    if (groups.size === 0) {
      return [] as ProfitLossDetailRow[];
    }

    const sectionRows: ProfitLossDetailRow[] = [
      {
        id: `${section}-section`,
        rowType: "section",
        section,
        label: section,
        depth: 0,
      },
    ];

    Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([groupName, items]) => {
        sectionRows.push({
          id: `${section}-${groupName}-group`,
          rowType: "group",
          section,
          label: groupName,
          depth: 1,
        });

        items
          .sort((left, right) => {
            if ((left.sortDate || "") !== (right.sortDate || "")) {
              return (left.sortDate || "").localeCompare(right.sortDate || "");
            }
            return (left.name || "").localeCompare(right.name || "");
          })
          .forEach((item) => sectionRows.push(item));
      });

    return sectionRows;
  };

  return [
    ...buildSectionRows("Revenue", revenueGroups),
    ...buildSectionRows("Cost of Goods Sold", cogsGroups),
    ...buildSectionRows("Operating Expenses", operatingGroups),
  ];
}

export default function ProfitLoss() {
  const today = new Date();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("detail");
  const [separateByMonth, setSeparateByMonth] = useState(false);
  const [summaryComparisonMode, setSummaryComparisonMode] = useState<SummaryComparisonMode>("none");
  const [summaryDrilldownRowId, setSummaryDrilldownRowId] = useState<string | null>(null);
  const [summaryDrilldownOpen, setSummaryDrilldownOpen] = useState(false);
  const [collapsedSummaryRowIds, setCollapsedSummaryRowIds] = useState<Set<string>>(new Set());
  const [collapsedDetailRowIds, setCollapsedDetailRowIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ProfitLossFilters>({
    periodPreset: "month",
    month: today.getMonth(),
    year: today.getFullYear(),
    basis: "accrual",
    currency: "USD",
    comparison: "previous_period",
    includeDrafts: false,
  });
  const monthlyRanges = useMemo(() => buildMonthlyMatrixRanges(filters), [filters]);
  const summaryRangeMonthCount = monthlyRanges.length;
  const canSeparateByMonth = summaryRangeMonthCount > 1;
  const shouldSeparateByMonth = viewMode === "summary" && separateByMonth && canSeparateByMonth;

  const { data: mockData, isLoading: isMockLoading } = useProfitLossStatement(filters);
  const { data: mockMatrixData, isLoading: isMockMatrixLoading } = useProfitLossMatrix(filters, false, shouldSeparateByMonth);
  const { data: quickBooksStatus } = useQuickBooksConnectionStatus();
  const { data: livePayload, isLoading: isLiveLoading } = useQuickBooksProfitLoss(
    filters,
    viewMode === "detail" || !shouldSeparateByMonth || summaryDrilldownOpen,
  );
  const { data: liveMatrixPayload, isLoading: isLiveMatrixLoading } = useQuickBooksProfitLossMatrix(
    filters,
    false,
    shouldSeparateByMonth,
  );
  const liveConnected = Boolean(livePayload?.connection.connected && livePayload.statement);
  const data = liveConnected ? livePayload?.statement ?? null : mockData ?? null;
  const summaryUsesLiveMatrix = Boolean(liveMatrixPayload?.connection.connected && liveMatrixPayload.matrix);
  const isLoading =
    isMockLoading ||
    ((viewMode === "detail" || !shouldSeparateByMonth) ? isLiveLoading : false) ||
    (shouldSeparateByMonth ? isMockMatrixLoading || isLiveMatrixLoading : false);
  const detailRows = useMemo(() => {
    if (liveConnected) {
      return livePayload?.detailRows || [];
    }
    return buildDetailRows(filters);
  }, [filters, liveConnected, livePayload?.detailRows]);
  const summaryTreeRows = useMemo<ProfitLossSummaryTreeRow[]>(() => {
    if (liveConnected && livePayload?.summaryRows?.length) {
      return livePayload.summaryRows;
    }

    if (!data) {
      return [];
    }

    return data.rows
      .filter((row) => row.rowType !== "section")
      .map((row) => {
        if (row.rowType === "detail") {
          return {
            id: row.id,
            label: row.label,
            amount: row.amount,
            depth: 1,
            rowType: "account" as const,
            section: row.section,
          };
        }

        if (row.rowType === "subtotal") {
          return {
            id: row.id,
            label: `Total for ${getSectionDisplayName(row.section)}`,
            amount: row.amount,
            depth: 1,
            rowType: "subtotal" as const,
            section: row.section,
          };
        }

        return {
          id: row.id,
          label: row.label,
          amount: row.amount,
          depth: 0,
          rowType: "total" as const,
          section: row.section,
        };
      })
      .reduce<ProfitLossSummaryTreeRow[]>((accumulator, row, index, rows) => {
        if (row.rowType === "account") {
          const previous = rows[index - 1];
          if (!previous || previous.rowType === "subtotal" || previous.rowType === "total") {
            const sourceRow = data.rows.find((candidate) => candidate.id === row.id);
            const sectionName = sourceRow ? getSectionDisplayName(sourceRow.section) : "Account";
            accumulator.push({
              id: `${row.id}-section`,
              label: sectionName,
              amount: null,
              depth: 0,
              rowType: "section",
              section: sourceRow?.section,
            });
          }
        }

        accumulator.push(row);
        return accumulator;
      }, []);
  }, [data, liveConnected, livePayload?.summaryRows]);
  const fallbackSummaryMatrix = useMemo<ProfitLossMatrixData>(() => ({
    columns: [{ id: "total", label: "Total", isTotal: true }],
    rows: summaryTreeRows.map((row) => ({
      id: row.id,
      label: row.label,
      depth: row.depth,
      rowType: row.rowType,
      section: row.section,
      parentLabel: row.parentLabel,
      cells: [
        {
          amount: row.amount,
          compareAmount: null,
          variancePercent: null,
        },
      ],
    })),
    periodLabel: data?.periodLabel || "",
    source: liveConnected ? "quickbooks" : "mock",
  }), [data?.periodLabel, liveConnected, summaryTreeRows]);
  const baseSummaryMatrix = shouldSeparateByMonth
    ? summaryUsesLiveMatrix
      ? liveMatrixPayload?.matrix || fallbackSummaryMatrix
      : mockMatrixData || fallbackSummaryMatrix
    : fallbackSummaryMatrix;
  const activeSummaryMatrix = useMemo<ProfitLossMatrixData>(() => {
    if (summaryComparisonMode !== "mom" || !shouldSeparateByMonth || summaryRangeMonthCount < 2) {
      return baseSummaryMatrix;
    }

    return {
      ...baseSummaryMatrix,
      columns: baseSummaryMatrix.columns.map((column, index) => ({
        ...column,
        compareLabel:
          !column.isTotal && index > 0
            ? baseSummaryMatrix.columns[index - 1]?.label
            : undefined,
      })),
      rows: baseSummaryMatrix.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell, index) => {
          const column = baseSummaryMatrix.columns[index];
          if (index === 0 || column?.isTotal) {
            return {
              ...cell,
              compareAmount: null,
              variancePercent: null,
            };
          }

          const compareAmount = row.cells[index - 1]?.amount ?? null;
          return {
            ...cell,
            compareAmount,
            variancePercent:
              cell.amount === null || compareAmount === null || compareAmount === 0
                ? null
                : ((cell.amount - compareAmount) / Math.abs(compareAmount)) * 100,
          };
        }),
      })),
    };
  }, [baseSummaryMatrix, shouldSeparateByMonth, summaryComparisonMode, summaryRangeMonthCount]);
  const summaryDisplayRows = activeSummaryMatrix.rows;
  const summaryRowPathById = useMemo(() => buildSummaryRowPathMap(activeSummaryMatrix.rows), [activeSummaryMatrix.rows]);
  const detailTransactionIndex = useMemo(() => buildDetailTransactionIndex(detailRows), [detailRows]);
  const expandableSummaryRowIds = useMemo(() => getExpandableRowIds(summaryDisplayRows), [summaryDisplayRows]);
  const visibleSummaryRows = useMemo(
    () => getVisibleTreeRows(summaryDisplayRows, collapsedSummaryRowIds),
    [collapsedSummaryRowIds, summaryDisplayRows],
  );
  const expandableDetailRowIds = useMemo(() => getExpandableRowIds(detailRows), [detailRows]);
  const visibleDetailRows = useMemo(
    () => getVisibleTreeRows(detailRows, collapsedDetailRowIds),
    [collapsedDetailRowIds, detailRows],
  );
  const isLiveSummaryData = activeSummaryMatrix.source === "quickbooks";
  const isShowingLiveData = viewMode === "summary" ? isLiveSummaryData : liveConnected;
  const displayCurrency = isShowingLiveData ? "USD" : filters.currency;
  const quickBooksConnection =
    viewMode === "summary"
      ? liveMatrixPayload?.connection || quickBooksStatus?.connection || livePayload?.connection
      : livePayload?.connection || quickBooksStatus?.connection;
  const companyName = liveConnected
    ? quickBooksConnection?.displayName || quickBooksConnection?.companyName || livePayload?.companyName || defaultCompanyName
    : summaryUsesLiveMatrix
      ? quickBooksConnection?.displayName || quickBooksConnection?.companyName || liveMatrixPayload?.companyName || defaultCompanyName
      : quickBooksConnection?.connected
        ? quickBooksConnection.displayName || quickBooksConnection.companyName || defaultCompanyName
      : defaultCompanyName;
  const hasLiveConnectionWarning = Boolean(quickBooksConnection && !quickBooksConnection.connected);
  const hasLiveFilterLimits = Boolean(quickBooksConnection?.connected) || liveConnected || summaryUsesLiveMatrix;
  const selectedSummaryDrilldownRow = useMemo(
    () => activeSummaryMatrix.rows.find((row) => row.id === summaryDrilldownRowId) || null,
    [activeSummaryMatrix.rows, summaryDrilldownRowId],
  );
  const summaryDrilldownNeedsLiveDetail = shouldSeparateByMonth && summaryUsesLiveMatrix;
  const summaryDrilldownLoading = summaryDrilldownOpen && summaryDrilldownNeedsLiveDetail && isLiveLoading && !liveConnected;
  const summaryDrilldownTransactions = useMemo(() => {
    if (!selectedSummaryDrilldownRow || (summaryDrilldownNeedsLiveDetail && !liveConnected)) {
      return [] as ProfitLossDrilldownTransaction[];
    }

    const scopedSections = getSummaryTotalSections(selectedSummaryDrilldownRow);
    if (scopedSections) {
      return detailTransactionIndex.filter((transaction) => scopedSections.has(transaction.section));
    }

    const targetPath = summaryRowPathById.get(selectedSummaryDrilldownRow.id) || [normalizeDrilldownLabel(selectedSummaryDrilldownRow.label)];
    return detailTransactionIndex.filter(
      (transaction) =>
        transaction.section === selectedSummaryDrilldownRow.section &&
        pathStartsWith(transaction.path, targetPath),
    );
  }, [
    detailTransactionIndex,
    liveConnected,
    selectedSummaryDrilldownRow,
    summaryDrilldownNeedsLiveDetail,
    summaryRowPathById,
  ]);
  const summaryDrilldownTotal = useMemo(
    () => summaryDrilldownTransactions.reduce((sum, transaction) => sum + (transaction.amount || 0), 0),
    [summaryDrilldownTransactions],
  );
  const selectedSummaryAmount =
    selectedSummaryDrilldownRow?.cells[activeSummaryMatrix.columns[activeSummaryMatrix.columns.length - 1]?.isTotal ? activeSummaryMatrix.columns.length - 1 : 0]?.amount ??
    null;

  const setFilter = <K extends keyof ProfitLossFilters>(key: K, value: ProfitLossFilters[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resetFilters = () => {
    setFilters({
      periodPreset: "month",
      month: today.getMonth(),
      year: today.getFullYear(),
      basis: "accrual",
      currency: "USD",
      comparison: "previous_period",
      includeDrafts: false,
    });
    setViewMode("detail");
    setSeparateByMonth(false);
    setSummaryComparisonMode("none");
    setSummaryDrilldownRowId(null);
    setSummaryDrilldownOpen(false);
    setCollapsedSummaryRowIds(new Set());
    setCollapsedDetailRowIds(new Set());
  };

  const toggleSummaryRow = (rowId: string) => {
    setCollapsedSummaryRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const toggleDetailRow = (rowId: string) => {
    setCollapsedDetailRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const openSummaryDrilldown = (row: ProfitLossMatrixRow) => {
    setSummaryDrilldownRowId(row.id);
    setSummaryDrilldownOpen(true);
  };

  const exportRows = useMemo(() => {
    if (!data) {
      return [];
    }

    if (viewMode === "detail") {
      return detailRows.map((row) => {
        if (row.rowType === "detail") {
          return {
            Section: row.section,
            "Transaction date": row.date || "",
            "Transaction type": row.transactionType || "",
            Num: row.num || "",
            Name: row.name || "",
            Department: row.department || "",
            Description: row.description || "",
            "Split account": row.splitAccount || "",
            Amount: formatCurrencyForExport(row.amount || 0, displayCurrency),
          };
        }

        return {
          Section: row.section,
          "Transaction date": row.label,
          "Transaction type": "",
          Num: "",
          Name: "",
          Department: "",
          Description: "",
          "Split account": "",
          Amount: "",
        };
      });
    }

    return activeSummaryMatrix.rows.map((row) => {
      const exportRow: Record<string, string> = {
        "Parent Account":
          row.rowType === "account" || row.rowType === "subtotal"
            ? row.parentLabel || getSectionDisplayName(row.section || "")
            : "",
        Account: row.label,
      };

      activeSummaryMatrix.columns.forEach((column, index) => {
        const cell = row.cells[index];
        exportRow[column.label] = cell?.amount === null || cell?.amount === undefined ? "" : formatCurrencyForExport(cell.amount, displayCurrency);
        if (summaryComparisonMode === "mom" && shouldSeparateByMonth) {
          exportRow[`${column.label} MoM %`] =
            cell?.variancePercent === null || cell?.variancePercent === undefined
              ? ""
              : `${cell.variancePercent.toFixed(1)}%`;
        }
      });

      return exportRow;
    });
  }, [activeSummaryMatrix, data, detailRows, displayCurrency, shouldSeparateByMonth, summaryComparisonMode, viewMode]);

  const handleExport = (formatType: "csv" | "excel" | "pdf") => {
    if (!data || exportRows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Adjust your filters to generate a report first.",
        variant: "destructive",
      });
      return;
    }

    const filename = `profit-loss-${viewMode}-${data.periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    try {
      if (formatType === "csv") {
        exportToCSV(exportRows, filename);
      } else if (formatType === "excel") {
        exportToExcel(exportRows, filename, viewMode === "detail" ? "P&L Detail" : "P&L Statement");
      } else {
        const headers = Object.keys(exportRows[0]);
        const tableData = exportRows.map((row) => headers.map((header) => row[header as keyof typeof row]));
        exportToPDF(
          `${viewMode === "detail" ? "Profit and Loss Detail" : "Profit and Loss Statement"} (${data.periodLabel})`,
          headers,
          tableData,
          filename,
        );
      }

      toast({
        title: "Export complete",
        description: `Your ${formatType.toUpperCase()} file is ready.`,
      });
    } catch {
      toast({
        title: "Export failed",
        description: "There was a problem exporting this report.",
        variant: "destructive",
      });
    }
  };

  const reportMeta = data
    ? [
        viewMode === "summary" ? activeSummaryMatrix.periodLabel || data.periodLabel : data.periodLabel,
        `Basis: ${filters.basis === "cash" ? "Cash" : "Accrual"}`,
        `Currency: ${displayCurrency}`,
        viewMode === "detail" && filters.comparison !== "none" && data.comparisonLabel ? `Compare: ${data.comparisonLabel}` : null,
        shouldSeparateByMonth ? "View: Separate by Month" : null,
        shouldSeparateByMonth && summaryComparisonMode === "mom" ? "Compare: Month over Month" : null,
        isShowingLiveData ? "Source: QuickBooks Sandbox" : "Source: Mock Data",
        filters.region ? `Region: ${filters.region}` : null,
        filters.product ? `Product: ${filters.product}` : null,
        filters.channel ? `Channel: ${filters.channel}` : null,
        filters.department ? `Department: ${filters.department}` : null,
        filters.expenseCategory ? `Expense: ${filters.expenseCategory}` : null,
      ].filter(Boolean)
    : [];

  const renderSummaryTable = () => {
    if (!data) {
      return null;
    }

    return (
      <div className="overflow-x-auto">
        <Table className="mx-auto w-max min-w-full text-[10px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky left-0 z-10 h-8 w-[240px] min-w-[240px] bg-white px-2 text-left font-semibold text-foreground underline decoration-[1px] underline-offset-4">
                Account
              </TableHead>
              {activeSummaryMatrix.columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "h-8 min-w-[108px] px-2 text-right font-semibold text-foreground underline decoration-[1px] underline-offset-4",
                    column.isTotal && "bg-muted/20",
                  )}
                >
                  <div className="flex flex-col items-end">
                    <span>{column.label}</span>
                    {shouldSeparateByMonth && summaryComparisonMode === "mom" && column.compareLabel ? (
                      <span className="text-[9px] font-normal text-muted-foreground">vs {column.compareLabel}</span>
                    ) : null}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleSummaryRows.map((row) => {
              const isExpandable = expandableSummaryRowIds.has(row.id);
              const isCollapsed = collapsedSummaryRowIds.has(row.id);

              return (
                <TableRow
                  key={row.id}
                  onClick={() => openSummaryDrilldown(row)}
                  className={cn(
                    "cursor-pointer hover:bg-muted/15",
                    row.rowType === "section" && "bg-muted/25",
                    row.rowType === "subtotal" && "border-t border-border/70 font-medium",
                    row.rowType === "total" && "border-t border-border font-semibold",
                  )}
                >
                  <TableCell
                    className={cn(
                      "sticky left-0 z-10 bg-white px-2 py-1 text-left",
                      row.rowType === "section" && "font-medium bg-muted/25",
                      row.rowType === "subtotal" && "font-medium",
                      row.rowType === "total" && "font-semibold",
                    )}
                    style={{
                      paddingLeft:
                        row.rowType === "section"
                          ? "0.5rem"
                          : `${Math.max(0.5, row.depth * 1.1 + (row.rowType === "subtotal" ? 0.9 : 0.65))}rem`,
                    }}
                  >
                    {isExpandable ? (
                      <div className="flex items-center gap-1.5 text-left">
                        <button
                          type="button"
                          className="rounded-sm p-0.5 hover:bg-muted"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSummaryRow(row.id);
                          }}
                        >
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                        <span>{row.label}</span>
                      </div>
                    ) : (
                      row.label
                    )}
                  </TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell
                      key={`${row.id}-${activeSummaryMatrix.columns[index]?.id || index}`}
                      className={cn(
                        "px-2 py-1 text-right align-top",
                        activeSummaryMatrix.columns[index]?.isTotal && "bg-muted/20",
                      )}
                    >
                      <div>{formatStatementAmount(cell.amount, displayCurrency)}</div>
                      {shouldSeparateByMonth && summaryComparisonMode === "mom" && cell.variancePercent !== null ? (
                        <div
                          className={cn(
                            "text-[9px]",
                            cell.variancePercent > 0 ? "text-emerald-600" : cell.variancePercent < 0 ? "text-rose-600" : "text-muted-foreground",
                          )}
                        >
                          {cell.variancePercent > 0 ? "+" : ""}
                          {cell.variancePercent.toFixed(1)}%
                        </div>
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  const renderDetailTable = () => {
    return (
      <Table className="text-[10px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Transaction date</TableHead>
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Transaction type</TableHead>
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Num</TableHead>
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Name</TableHead>
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Department</TableHead>
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Description</TableHead>
            <TableHead className="h-8 px-2.5 font-semibold text-foreground">Split account</TableHead>
            <TableHead className="h-8 px-2.5 text-right font-semibold text-foreground">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleDetailRows.map((row) => {
            const isExpandable = expandableDetailRowIds.has(row.id);
            const isCollapsed = collapsedDetailRowIds.has(row.id);

            if (row.rowType === "section") {
              return (
                <TableRow key={row.id} className="hover:bg-transparent">
                  <TableCell className="px-2.5 py-1.5 font-bold uppercase tracking-[0.16em] underline underline-offset-4">
                    {isExpandable ? (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left"
                        onClick={() => toggleDetailRow(row.id)}
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <span>{row.label}</span>
                      </button>
                    ) : (
                      row.label
                    )}
                  </TableCell>
                  <TableCell colSpan={7} className="px-0 py-0"></TableCell>
                </TableRow>
              );
            }

            if (row.rowType === "group") {
              return (
                <TableRow key={row.id} className="hover:bg-transparent">
                  <TableCell
                    className="px-2.5 py-1 font-medium"
                    style={{ paddingLeft: `${Math.max(0.9, (row.depth || 1) * 0.95 + 0.75)}rem` }}
                  >
                    {isExpandable ? (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left"
                        onClick={() => toggleDetailRow(row.id)}
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <span>{row.label}</span>
                      </button>
                    ) : (
                      row.label
                    )}
                  </TableCell>
                  <TableCell colSpan={7} className="px-0 py-0"></TableCell>
                </TableRow>
              );
            }

            return (
              <TableRow key={row.id} className="hover:bg-transparent">
                <TableCell
                  className="px-2.5 py-1"
                  style={{ paddingLeft: `${Math.max(1.25, (row.depth || 2) * 0.95 + 0.95)}rem` }}
                >
                  {row.date}
                </TableCell>
                <TableCell className="px-2.5 py-1">{row.transactionType}</TableCell>
                <TableCell className="px-2.5 py-1">{row.num}</TableCell>
                <TableCell className="px-2.5 py-1">{row.name}</TableCell>
                <TableCell className="px-2.5 py-1">{row.department}</TableCell>
                <TableCell className="px-2.5 py-1">{row.description}</TableCell>
                <TableCell className="px-2.5 py-1">{row.splitAccount}</TableCell>
                <TableCell className="px-2.5 py-1 text-right">{formatStatementAmount(row.amount, displayCurrency)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  const renderDetailMobile = () => {
    return (
      <div className="space-y-2 sm:hidden">
        {visibleDetailRows.map((row) => {
          const isExpandable = expandableDetailRowIds.has(row.id);
          const isCollapsed = collapsedDetailRowIds.has(row.id);
          const marginLeft =
            row.rowType === "section"
              ? "0rem"
              : `${Math.max(0.2, (row.depth || 1) * 0.7)}rem`;

          if (row.rowType === "section" || row.rowType === "group") {
            return (
              <div
                key={row.id}
                className={cn(
                  "rounded-lg border border-border/70 bg-white px-3 py-2",
                  row.rowType === "section" && "bg-muted/25",
                )}
                style={{ marginLeft }}
              >
                {isExpandable ? (
                  <button
                    type="button"
                    className={cn(
                      "flex items-start gap-1.5 text-left text-xs",
                      row.rowType === "section" && "font-semibold uppercase tracking-[0.14em]",
                      row.rowType === "group" && "font-medium",
                    )}
                    onClick={() => toggleDetailRow(row.id)}
                  >
                    {isCollapsed ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span>{row.label}</span>
                  </button>
                ) : (
                  <div
                    className={cn(
                      "text-xs",
                      row.rowType === "section" && "font-semibold uppercase tracking-[0.14em]",
                      row.rowType === "group" && "font-medium",
                    )}
                  >
                    {row.label}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={row.id}
              className="rounded-lg border border-border/70 bg-white px-3 py-3"
              style={{ marginLeft }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{row.name || row.transactionType || row.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {[row.date, row.transactionType, row.num].filter(Boolean).join(" • ")}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs font-medium">{formatStatementAmount(row.amount, displayCurrency)}</div>
              </div>

              {(row.description || row.department || row.splitAccount) ? (
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  {row.description ? <div>{row.description}</div> : null}
                  <div className="grid grid-cols-1 gap-1">
                    {row.department ? <div><span className="font-medium text-foreground">Department:</span> {row.department}</div> : null}
                    {row.splitAccount ? <div><span className="font-medium text-foreground">Split account:</span> {row.splitAccount}</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Period</Label>
            <Select value={filters.periodPreset} onValueChange={(value) => setFilter("periodPreset", value as ProfitLossPeriodPreset)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filters.periodPreset === "month" && (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Month</Label>
                <Select value={String(filters.month)} onValueChange={(value) => setFilter("month", Number(value))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((month, index) => (
                      <SelectItem key={month} value={String(index)}>
                        {month}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Year</Label>
                <Select value={String(filters.year)} onValueChange={(value) => setFilter("year", Number(value))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.options.years || [today.getFullYear()]).map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {filters.periodPreset === "custom" && (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">From</Label>
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={filters.customFrom || ""}
                  onChange={(event) => setFilter("customFrom", event.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">To</Label>
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={filters.customTo || ""}
                  onChange={(event) => setFilter("customTo", event.target.value)}
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Basis</Label>
            <Select value={filters.basis} onValueChange={(value) => setFilter("basis", value as ProfitLossFilters["basis"])}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accrual">Accrual</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {viewMode === "detail" ? (
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Comparison</Label>
              <Select value={filters.comparison} onValueChange={(value) => setFilter("comparison", value as ProfitLossFilters["comparison"])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {comparisonOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Currency</Label>
            <Select disabled={liveConnected} value={filters.currency} onValueChange={(value) => setFilter("currency", value)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencyOptions.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Region</Label>
            <Select
              disabled={hasLiveFilterLimits}
              value={filters.region || "all"}
              onValueChange={(value) => setFilter("region", value === "all" ? undefined : value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Regions</SelectItem>
                {(data?.options.regions || []).map((region) => (
                  <SelectItem key={region} value={region}>
                    {region}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Product</Label>
            <Select
              disabled={hasLiveFilterLimits}
              value={filters.product || "all"}
              onValueChange={(value) => setFilter("product", value === "all" ? undefined : value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {(data?.options.products || []).map((product) => (
                  <SelectItem key={product} value={product}>
                    {product}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Channel</Label>
            <Select
              disabled={hasLiveFilterLimits}
              value={filters.channel || "all"}
              onValueChange={(value) => setFilter("channel", value === "all" ? undefined : value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                {(data?.options.channels || []).map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {channel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Department</Label>
            <Select
              disabled={hasLiveFilterLimits}
              value={filters.department || "all"}
              onValueChange={(value) => setFilter("department", value === "all" ? undefined : value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {(data?.options.departments || []).map((department) => (
                  <SelectItem key={department} value={department}>
                    {department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Expense Category</Label>
            <Select
              disabled={hasLiveFilterLimits}
              value={filters.expenseCategory || "all"}
              onValueChange={(value) => setFilter("expenseCategory", value === "all" ? undefined : value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {(data?.options.expenseCategories || []).map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:gap-3">
            <div className="flex h-8 flex-1 items-center gap-2 rounded-md border px-3">
              <Switch
                checked={filters.includeDrafts}
                disabled={hasLiveFilterLimits}
                onCheckedChange={(checked) => setFilter("includeDrafts", checked)}
                id="include-drafts"
              />
              <Label htmlFor="include-drafts" className="text-xs font-normal">
                Include drafts
              </Label>
            </div>
            <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 w-full px-3 text-xs sm:w-auto">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {hasLiveConnectionWarning && quickBooksConnection ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>QuickBooks live data is not connected yet</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              {quickBooksConnection.message || "The page is using mock data until QuickBooks finishes authorizing."}
              {quickBooksConnection.lastError ? ` ${quickBooksConnection.lastError}` : ""}
            </span>
            {quickBooksConnection.authorizationUrl ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => window.open(quickBooksConnection.authorizationUrl, "_blank", "noopener,noreferrer")}>
                  Reauthorize QuickBooks
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {isShowingLiveData ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>QuickBooks sandbox report is live</AlertTitle>
          <AlertDescription>
            Profit & Loss data is coming from QuickBooks. Currency stays in the QuickBooks home currency, and the custom app filters for region, product, channel, department, expense category, and drafts are disabled in live mode.
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <>
          <Skeleton className="h-20" />
          <Skeleton className="h-[560px]" />
        </>
      ) : data ? (
        <Card className="overflow-hidden bg-[#fafafa]">
          <div className="border-b bg-white px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex h-11 w-full items-center gap-1 rounded-md border bg-background p-1 sm:w-fit">
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-8 min-w-0 flex-1 px-3 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-w-[82px] sm:flex-none",
                    viewMode === "detail" && "bg-muted shadow-none hover:bg-muted",
                  )}
                  onClick={() => setViewMode("detail")}
                >
                  Detail
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-8 min-w-0 flex-1 px-3 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-w-[82px] sm:flex-none",
                    viewMode === "summary" && "bg-muted shadow-none hover:bg-muted",
                  )}
                  onClick={() => setViewMode("summary")}
                >
                  Summary
                </Button>
              </div>

              {viewMode === "summary" && canSeparateByMonth ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    size="sm"
                    variant={shouldSeparateByMonth ? "default" : "outline"}
                    className="h-8 px-3 text-xs"
                    onClick={() => setSeparateByMonth((current) => !current)}
                  >
                    Separate by Month
                  </Button>
                  <Button
                    size="sm"
                    variant={summaryComparisonMode === "mom" ? "default" : "outline"}
                    className="h-8 px-3 text-xs"
                    disabled={!shouldSeparateByMonth || summaryRangeMonthCount < 2}
                    onClick={() =>
                      setSummaryComparisonMode((current) => (current === "mom" ? "none" : "mom"))
                    }
                  >
                    MoM
                  </Button>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => handleExport("csv")}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => handleExport("excel")}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Excel
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => handleExport("pdf")}>
                  <FileBarChart className="mr-1.5 h-3.5 w-3.5" />
                  PDF
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-white px-3 py-4 sm:px-4">
            <div className={cn("mx-auto", viewMode === "summary" ? "max-w-[1040px]" : "max-w-[1180px]")}>
              <div className="text-center">
                <div className="text-[15px] font-bold tracking-tight">{companyName}</div>
                <div className="mt-0.5 text-[14px] font-bold">
                  {viewMode === "detail" ? "Profit and Loss Detail" : "Profit and Loss Statement"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {viewMode === "summary" ? activeSummaryMatrix.periodLabel || data.periodLabel : data.periodLabel}
                </div>
                {reportMeta.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap items-center justify-center gap-y-1 text-[11px] text-muted-foreground">
                    {reportMeta.slice(1).map((item, index) => (
                      <span key={String(item)}>
                        {index > 0 ? <span className="mx-2 text-muted-foreground/60">|</span> : null}
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="my-3 border-t" />

              {viewMode === "detail" ? renderDetailMobile() : null}

              {viewMode === "summary" ? (
                renderSummaryTable()
              ) : (
                <div className="hidden overflow-x-auto sm:block">
                  <div className="min-w-[1120px] bg-white">
                    {renderDetailTable()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <Dialog
        open={summaryDrilldownOpen}
        onOpenChange={(open) => {
          setSummaryDrilldownOpen(open);
          if (!open) {
            setSummaryDrilldownRowId(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden p-0">
          <div className="flex h-full flex-col">
            <DialogHeader className="border-b px-5 py-4">
              <DialogTitle className="text-base">
                {selectedSummaryDrilldownRow?.label || "Transaction Details"}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>{viewMode === "summary" ? activeSummaryMatrix.periodLabel || data?.periodLabel : data?.periodLabel}</span>
                {selectedSummaryDrilldownRow ? (
                  <span>
                    {summaryDrilldownTransactions.length} transaction{summaryDrilldownTransactions.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                <span>
                  Total: {formatStatementAmount(selectedSummaryAmount ?? summaryDrilldownTotal, displayCurrency)}
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-auto px-5 py-4">
              {summaryDrilldownLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-56 w-full" />
                </div>
              ) : summaryDrilldownTransactions.length === 0 ? (
                <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  No transactions were found for this line item.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="hidden overflow-x-auto md:block">
                    <Table className="text-[11px]">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="px-2 py-2">Date</TableHead>
                          <TableHead className="px-2 py-2">Type</TableHead>
                          <TableHead className="px-2 py-2">Num</TableHead>
                          <TableHead className="px-2 py-2">Name</TableHead>
                          <TableHead className="px-2 py-2">Description</TableHead>
                          <TableHead className="px-2 py-2">Department</TableHead>
                          <TableHead className="px-2 py-2">Account</TableHead>
                          <TableHead className="px-2 py-2 text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaryDrilldownTransactions.map((transaction) => (
                          <TableRow key={transaction.id} className="hover:bg-transparent">
                            <TableCell className="px-2 py-2">{transaction.date || ""}</TableCell>
                            <TableCell className="px-2 py-2">{transaction.transactionType || ""}</TableCell>
                            <TableCell className="px-2 py-2">{transaction.num || ""}</TableCell>
                            <TableCell className="px-2 py-2">{transaction.name || ""}</TableCell>
                            <TableCell className="px-2 py-2">{transaction.description || ""}</TableCell>
                            <TableCell className="px-2 py-2">{transaction.department || ""}</TableCell>
                            <TableCell className="px-2 py-2">{transaction.splitAccount || ""}</TableCell>
                            <TableCell className="px-2 py-2 text-right">
                              {formatStatementAmount(transaction.amount, displayCurrency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-2 md:hidden">
                    {summaryDrilldownTransactions.map((transaction) => (
                      <div key={transaction.id} className="rounded-lg border bg-white px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">{transaction.name || transaction.transactionType || "Transaction"}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {[transaction.date, transaction.transactionType, transaction.num].filter(Boolean).join(" • ")}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-xs font-medium">
                            {formatStatementAmount(transaction.amount, displayCurrency)}
                          </div>
                        </div>

                        {(transaction.description || transaction.department || transaction.splitAccount) ? (
                          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                            {transaction.description ? <div>{transaction.description}</div> : null}
                            {transaction.department ? <div><span className="font-medium text-foreground">Department:</span> {transaction.department}</div> : null}
                            {transaction.splitAccount ? <div><span className="font-medium text-foreground">Account:</span> {transaction.splitAccount}</div> : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
