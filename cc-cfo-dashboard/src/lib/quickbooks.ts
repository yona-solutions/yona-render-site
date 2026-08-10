import type { ProfitLossStatementData } from "@/lib/profitLoss";
import type { ProfitLossMatrixData } from "@/lib/profitLossMatrix";
import type { BalanceSheetStatementData, BalanceSheetRow } from "@/lib/balanceSheet";

export interface ProfitLossDetailRow {
  id: string;
  rowType: "section" | "group" | "detail";
  section: "Revenue" | "Cost of Goods Sold" | "Operating Expenses" | "Other Expenses" | "Other Income";
  label: string;
  depth?: number;
  sortDate?: string;
  date?: string;
  transactionType?: string;
  num?: string;
  name?: string;
  department?: string;
  description?: string;
  splitAccount?: string;
  amount?: number;
}

export interface ProfitLossSummaryTreeRow {
  id: string;
  label: string;
  amount: number | null;
  depth: number;
  rowType: "section" | "account" | "subtotal" | "total";
  section?: "Revenue" | "Cost of Goods Sold" | "Operating Expenses" | "Other Expenses" | "Other Income" | "Summary";
  parentLabel?: string;
}

export interface QuickBooksConnectionState {
  connected: boolean;
  mode: "sandbox";
  companyName?: string;
  displayName?: string;
  realmId?: string;
  needsAuthorization?: boolean;
  message?: string;
  authorizationUrl?: string;
  lastError?: string;
}

export interface QuickBooksProfitLossPayload {
  connection: QuickBooksConnectionState;
  companyName: string;
  statement: ProfitLossStatementData | null;
  detailRows: ProfitLossDetailRow[];
  summaryRows: ProfitLossSummaryTreeRow[];
}

export interface QuickBooksProfitLossMatrixPayload {
  connection: QuickBooksConnectionState;
  companyName: string;
  matrix: ProfitLossMatrixData | null;
}

export interface QuickBooksBalanceSheetPayload {
  connection: QuickBooksConnectionState;
  companyName: string;
  statement: BalanceSheetStatementData | null;
  rows: BalanceSheetRow[];
}
