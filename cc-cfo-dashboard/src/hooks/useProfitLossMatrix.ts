import { useQuery } from "@tanstack/react-query";
import { buildRows, buildOptions, buildStatementGroups } from "@/hooks/useProfitLossStatement";
import { type ProfitLossFilters } from "@/lib/profitLoss";
import {
  buildMatrixCell,
  buildMonthlyMatrixRanges,
  buildProfitLossMatrixKey,
  type ProfitLossMatrixData,
  type ProfitLossMatrixRow,
} from "@/lib/profitLossMatrix";

export function useProfitLossMatrix(
  filters: ProfitLossFilters,
  showYearOverYear: boolean,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      "profit-loss-matrix",
      filters.periodPreset,
      filters.month,
      filters.year,
      filters.customFrom,
      filters.customTo,
      filters.basis,
      filters.currency,
      filters.region,
      filters.product,
      filters.channel,
      filters.department,
      filters.expenseCategory,
      filters.includeDrafts,
      showYearOverYear,
    ],
    enabled,
    queryFn: async (): Promise<ProfitLossMatrixData> => {
      const ranges = buildMonthlyMatrixRanges(filters);
      const rowMap = new Map<string, ProfitLossMatrixRow>();
      const rowOrder: string[] = [];

      ranges.forEach((range, columnIndex) => {
        const current = buildStatementGroups(filters, range);
        const comparison = showYearOverYear
          ? buildStatementGroups(filters, {
              from: range.compareFrom,
              to: range.compareTo,
              label: range.compareLabel,
            })
          : null;

        buildRows(current, null).forEach((row) => {
          const key = buildProfitLossMatrixKey({
            label: row.label,
            depth: row.rowType === "detail" ? 1 : 0,
            rowType:
              row.rowType === "detail"
                ? "account"
                : row.rowType,
            section: row.section,
          });

          if (!rowMap.has(key)) {
            rowMap.set(key, {
              id: key,
              label: row.label,
              depth: row.rowType === "detail" ? 1 : 0,
              rowType: row.rowType === "detail" ? "account" : row.rowType,
              section: row.section,
              parentLabel:
                row.rowType === "detail" || row.rowType === "subtotal"
                  ? row.section === "Revenue"
                    ? "Income"
                    : row.section || undefined
                  : undefined,
              cells: Array.from({ length: ranges.length + 1 }, () => buildMatrixCell(null, null)),
            });
            rowOrder.push(key);
          }

          const compareRow = comparison?.summary
            ? buildRows(comparison, null).find((candidate) => candidate.id === row.id)
            : null;
          const matrixRow = rowMap.get(key);
          if (!matrixRow) {
            return;
          }

          matrixRow.cells[columnIndex] = buildMatrixCell(row.amount, compareRow?.amount ?? null);
        });
      });

      rowOrder.forEach((key) => {
        const row = rowMap.get(key);
        if (!row) {
          return;
        }

        const totalAmount = row.cells.reduce((sum, cell) => sum + (cell.amount || 0), 0);
        const totalCompareAmount = showYearOverYear
          ? row.cells.reduce((sum, cell) => sum + (cell.compareAmount || 0), 0)
          : null;
        row.cells[ranges.length] = buildMatrixCell(totalAmount, totalCompareAmount);
      });

      return {
        columns: [
          ...ranges.map((range, index) => ({
            id: `month-${index + 1}`,
            label: range.label,
            compareLabel: showYearOverYear ? range.compareLabel : undefined,
          })),
          {
            id: "total",
            label: "Total",
            compareLabel: showYearOverYear ? "Prior Year Total" : undefined,
            isTotal: true,
          },
        ],
        rows: rowOrder.map((key) => rowMap.get(key)).filter(Boolean) as ProfitLossMatrixRow[],
        periodLabel: ranges.map((range) => range.label).join(" • "),
        source: "mock",
      };
    },
  });
}
