import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AlertTriangle, Download, FileBarChart, RefreshCw } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBalanceSheetStatement } from "@/hooks/useBalanceSheetStatement";
import { useQuickBooksBalanceSheet } from "@/hooks/useQuickBooksBalanceSheet";
import { type BalanceSheetFilters, type BalanceSheetPeriodPreset, type BalanceSheetRow } from "@/lib/balanceSheet";
import { exportToCSV, exportToExcel, exportToPDF, formatCurrencyForExport } from "@/lib/exportUtils";
import { getExpandableRowIds, getVisibleTreeRows } from "@/lib/statementTree";
import { cn } from "@/lib/utils";

const defaultCompanyName = "Cure Company";

const periodOptions: { value: BalanceSheetPeriodPreset; label: string }[] = [
  { value: "month", label: "Specific Month End" },
  { value: "month_to_date", label: "Month to Date" },
  { value: "quarter_to_date", label: "Quarter to Date" },
  { value: "year_to_date", label: "Year to Date" },
  { value: "last_month", label: "Last Month End" },
  { value: "last_quarter", label: "Last Quarter End" },
  { value: "custom", label: "Custom Date" },
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

export default function BalanceSheet() {
  const today = new Date();
  const { toast } = useToast();
  const [filters, setFilters] = useState<BalanceSheetFilters>({
    periodPreset: "month",
    month: today.getMonth(),
    year: today.getFullYear(),
    basis: "accrual",
    currency: "USD",
  });
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());

  const { data: mockData, isLoading: isMockLoading } = useBalanceSheetStatement(filters);
  const { data: livePayload, isLoading: isLiveLoading } = useQuickBooksBalanceSheet(filters);

  const liveConnected = Boolean(livePayload?.connection.connected && livePayload.statement);
  const data = liveConnected ? livePayload?.statement ?? null : mockData ?? null;
  const rows = liveConnected ? livePayload?.rows || [] : data?.rows || [];
  const isLoading = isMockLoading || isLiveLoading;
  const displayCurrency = liveConnected ? "USD" : filters.currency;
  const quickBooksConnection = livePayload?.connection;
  const companyName = liveConnected
    ? quickBooksConnection?.displayName || quickBooksConnection?.companyName || livePayload?.companyName || defaultCompanyName
    : defaultCompanyName;
  const hasLiveConnectionWarning = Boolean(quickBooksConnection && !quickBooksConnection.connected);

  const expandableRowIds = useMemo(() => getExpandableRowIds(rows), [rows]);
  const visibleRows = useMemo(() => getVisibleTreeRows(rows, collapsedRowIds), [collapsedRowIds, rows]);

  const setFilter = <K extends keyof BalanceSheetFilters>(key: K, value: BalanceSheetFilters[K]) => {
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
    });
    setCollapsedRowIds(new Set());
  };

  const toggleRow = (rowId: string) => {
    setCollapsedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const exportRows = useMemo(() => {
    if (!data) {
      return [];
    }

    return rows.map((row) => ({
      "Parent Account":
        row.rowType === "account" || row.rowType === "subtotal"
          ? row.parentLabel || row.section || ""
          : "",
      Account: row.label,
      Total: row.amount === null ? "" : formatCurrencyForExport(row.amount, displayCurrency),
    }));
  }, [data, displayCurrency, rows]);

  const handleExport = (formatType: "csv" | "excel" | "pdf") => {
    if (!data || exportRows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Adjust your filters to generate a report first.",
        variant: "destructive",
      });
      return;
    }

    const filename = `balance-sheet-${data.periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    try {
      if (formatType === "csv") {
        exportToCSV(exportRows, filename);
      } else if (formatType === "excel") {
        exportToExcel(exportRows, filename, "Balance Sheet");
      } else {
        const headers = Object.keys(exportRows[0]);
        const tableData = exportRows.map((row) => headers.map((header) => row[header as keyof typeof row]));
        exportToPDF(`Balance Sheet (${data.periodLabel})`, headers, tableData, filename);
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

  const renderMobileRows = () => {
    return (
      <div className="space-y-2 sm:hidden">
        {visibleRows.map((row) => {
          const isExpandable = expandableRowIds.has(row.id);
          const isCollapsed = collapsedRowIds.has(row.id);
          const marginLeft =
            row.rowType === "section"
              ? "0rem"
              : `${Math.max(0.15, row.depth * 0.7 + (row.rowType === "subtotal" ? 0.4 : 0.25))}rem`;

          return (
            <div
              key={row.id}
              className={cn(
                "rounded-lg border border-border/70 bg-white px-3 py-2",
                row.rowType === "section" && "bg-muted/25",
                row.rowType === "subtotal" && "font-medium",
                row.rowType === "total" && "border-border font-semibold",
              )}
              style={{ marginLeft }}
            >
              <div className="flex items-start justify-between gap-3">
                {isExpandable ? (
                  <button
                    type="button"
                    className="flex min-w-0 items-start gap-1.5 text-left"
                    onClick={() => toggleRow(row.id)}
                  >
                    {isCollapsed ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span className={cn("text-xs", row.rowType === "section" && "font-medium")}>{row.label}</span>
                  </button>
                ) : (
                  <div className={cn("min-w-0 text-xs", row.rowType === "section" && "font-medium")}>{row.label}</div>
                )}
                <div className="shrink-0 text-right text-xs">{formatStatementAmount(row.amount, displayCurrency)}</div>
              </div>
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
            <Select value={filters.periodPreset} onValueChange={(value) => setFilter("periodPreset", value as BalanceSheetPeriodPreset)}>
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

          {filters.periodPreset === "month" ? (
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
          ) : null}

          {filters.periodPreset === "custom" ? (
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">As of</Label>
              <Input
                className="h-8 text-xs"
                type="date"
                value={filters.customDate || ""}
                onChange={(event) => setFilter("customDate", event.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Basis</Label>
            <Select value={filters.basis} onValueChange={(value) => setFilter("basis", value as BalanceSheetFilters["basis"])}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accrual">Accrual</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

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

          <div className="flex items-end">
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

      {liveConnected ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>QuickBooks sandbox report is live</AlertTitle>
          <AlertDescription>
            Balance Sheet data is coming from QuickBooks. Currency stays in the QuickBooks home currency while the sandbox connection is active.
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
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
            <div className="mx-auto max-w-[1040px]">
              <div className="text-center">
                <div className="text-[15px] font-bold tracking-tight">{companyName}</div>
                <div className="mt-0.5 text-[14px] font-bold">Balance Sheet</div>
                <div className="mt-1 text-[11px] text-muted-foreground">As of {data.periodLabel}</div>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-y-1 text-[11px] text-muted-foreground">
                  <span>Basis: {filters.basis === "cash" ? "Cash" : "Accrual"}</span>
                  <span className="mx-2 text-muted-foreground/60">|</span>
                  <span>Currency: {displayCurrency}</span>
                  <span className="mx-2 text-muted-foreground/60">|</span>
                  <span>Source: {liveConnected ? "QuickBooks Sandbox" : "Mock Data"}</span>
                </div>
              </div>

              <div className="my-3 border-t" />

              {renderMobileRows()}

              <div className="hidden overflow-x-auto sm:block">
                <div className="min-w-[840px] bg-white">
                  <Table className="mx-auto w-full table-fixed text-[10px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-8 w-[74%] px-2 text-left font-semibold text-foreground underline decoration-[1px] underline-offset-4">
                          Account
                        </TableHead>
                        <TableHead className="h-8 w-[26%] px-2 text-right font-semibold text-foreground underline decoration-[1px] underline-offset-4">
                          Total
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map((row) => {
                        const isExpandable = expandableRowIds.has(row.id);
                        const isCollapsed = collapsedRowIds.has(row.id);
                        const paddingLeft =
                          row.rowType === "section"
                            ? "0.5rem"
                            : `${Math.max(0.55, row.depth * 1.1 + (row.rowType === "subtotal" ? 0.85 : 0.7))}rem`;

                        return (
                          <TableRow
                            key={row.id}
                            className={cn(
                              "hover:bg-transparent",
                              row.rowType === "section" && "bg-muted/25",
                              row.rowType === "subtotal" && "border-t border-border/70 font-medium",
                              row.rowType === "total" && "border-t border-border font-semibold",
                            )}
                          >
                            <TableCell
                              className={cn(
                                "px-2 py-0.5 text-left",
                                row.rowType === "section" && "font-medium",
                              )}
                              style={{ paddingLeft }}
                            >
                              {isExpandable ? (
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 text-left"
                                  onClick={() => toggleRow(row.id)}
                                >
                                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  <span>{row.label}</span>
                                </button>
                              ) : (
                                <span>{row.label}</span>
                              )}
                            </TableCell>
                            <TableCell className="px-2 py-0.5 text-right">{formatStatementAmount(row.amount, displayCurrency)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
