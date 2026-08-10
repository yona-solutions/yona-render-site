import { useQuery } from "@tanstack/react-query";
import { isAfter, startOfYear } from "date-fns";
import { type BalanceSheetFilters, type BalanceSheetRow, type BalanceSheetStatementData, resolveBalanceSheetRange } from "@/lib/balanceSheet";
import { convertCurrency, getMockState } from "@/mock/mockFinance";

function addRow(
  rows: BalanceSheetRow[],
  row: BalanceSheetRow,
) {
  rows.push(row);
}

function calculateMockEarnings(asOfDate: Date, basis: BalanceSheetFilters["basis"]) {
  const state = getMockState();
  const asOf = asOfDate.getTime();
  const currentYearStart = startOfYear(asOfDate).getTime();
  const invoiceById = new Map(state.invoices.map((invoice) => [invoice.id, invoice]));

  let currentYearRevenue = 0;
  let retainedRevenue = 0;

  if (basis === "cash") {
    state.payments.forEach((payment) => {
      const paymentDate = new Date(`${payment.date}T00:00:00`).getTime();
      if (paymentDate > asOf) {
        return;
      }

      if (paymentDate >= currentYearStart) {
        currentYearRevenue += payment.amount;
      } else {
        retainedRevenue += payment.amount;
      }
    });
  } else {
    state.invoices.forEach((invoice) => {
      if (invoice.status === "Cancelled" || invoice.status === "Draft") {
        return;
      }

      const issueDate = new Date(`${invoice.issue_date}T00:00:00`).getTime();
      if (issueDate > asOf) {
        return;
      }

      if (issueDate >= currentYearStart) {
        currentYearRevenue += invoice.amount_total_base;
      } else {
        retainedRevenue += invoice.amount_total_base;
      }
    });
  }

  let currentYearExpenses = 0;
  let retainedExpenses = 0;
  state.expenses.forEach((expense) => {
    const expenseDate = new Date(`${expense.date}T00:00:00`).getTime();
    if (expenseDate > asOf) {
      return;
    }

    if (expenseDate >= currentYearStart) {
      currentYearExpenses += expense.amount;
    } else {
      retainedExpenses += expense.amount;
    }
  });

  return {
    currentPeriodEarnings: currentYearRevenue - currentYearExpenses,
    retainedEarnings: retainedRevenue - retainedExpenses,
  };
}

function buildMockRows(filters: BalanceSheetFilters) {
  const state = getMockState();
  const range = resolveBalanceSheetRange(filters);
  const asOfDate = range.to;
  const asOfTime = asOfDate.getTime();

  const years = Array.from(
    new Set([
      asOfDate.getFullYear(),
      ...state.invoices.map((invoice) => new Date(`${invoice.issue_date}T00:00:00`).getFullYear()),
      ...state.expenses.map((expense) => new Date(`${expense.date}T00:00:00`).getFullYear()),
      ...state.vendorBills.map((bill) => new Date(`${bill.issue_date}T00:00:00`).getFullYear()),
    ]),
  ).sort((left, right) => right - left);

  const cashAccounts = state.accounts.filter((account) => account.balance >= 0);
  const creditAccounts = state.accounts.filter((account) => account.balance < 0);

  const cashRows = cashAccounts
    .map((account) => {
      const activityAfterDate = state.bankTransactions
        .filter((transaction) => transaction.account_name === account.account_name)
        .filter((transaction) => isAfter(new Date(`${transaction.date}T00:00:00`), asOfDate))
        .reduce((sum, transaction) => {
          return sum + (transaction.type === "inflow" ? transaction.amount : -transaction.amount);
        }, 0);

      const historicalBalance = account.balance - activityAfterDate;
      const converted = convertCurrency(historicalBalance, account.currency, filters.currency, range.to.toISOString().slice(0, 10), state);
      return {
        label: account.account_name,
        amount: converted,
      };
    })
    .filter((row) => Math.abs(row.amount) > 0.005);

  const receivableRows =
    filters.basis === "cash"
      ? []
      : state.invoices
          .filter((invoice) => invoice.status !== "Cancelled" && invoice.status !== "Draft")
          .filter((invoice) => new Date(`${invoice.issue_date}T00:00:00`).getTime() <= asOfTime)
          .filter((invoice) => invoice.open_amount > 0)
          .map((invoice) => {
            const customer = state.customers.find((entry) => entry.id === invoice.customer_id);
            return {
              label: customer?.name || invoice.id,
              amount: convertCurrency(invoice.open_amount, "USD", filters.currency, invoice.issue_date, state),
            };
          })
          .filter((row) => Math.abs(row.amount) > 0.005);

  const accountsPayableRows =
    filters.basis === "cash"
      ? []
      : state.vendorBills
          .filter((bill) => new Date(`${bill.issue_date}T00:00:00`).getTime() <= asOfTime)
          .filter((bill) => bill.open_amount > 0)
          .map((bill) => ({
            label: bill.vendor_name,
            amount: convertCurrency(bill.open_amount, bill.original_currency, filters.currency, bill.issue_date, state),
          }))
          .filter((row) => Math.abs(row.amount) > 0.005);

  const creditCardRows = creditAccounts.map((account) => ({
    label: account.account_name,
    amount: Math.abs(convertCurrency(account.balance, account.currency, filters.currency, range.to.toISOString().slice(0, 10), state)),
  }));

  const totalCash = cashRows.reduce((sum, row) => sum + row.amount, 0);
  const totalReceivables = receivableRows.reduce((sum, row) => sum + row.amount, 0);
  const totalAssets = totalCash + totalReceivables;
  const totalAccountsPayable = accountsPayableRows.reduce((sum, row) => sum + row.amount, 0);
  const totalCreditCards = creditCardRows.reduce((sum, row) => sum + row.amount, 0);
  const totalLiabilities = totalAccountsPayable + totalCreditCards;

  const earnings = calculateMockEarnings(asOfDate, filters.basis);
  const currentPeriodEarnings = convertCurrency(
    earnings.currentPeriodEarnings,
    "USD",
    filters.currency,
    range.to.toISOString().slice(0, 10),
    state,
  );
  const retainedEarnings = totalAssets - totalLiabilities - currentPeriodEarnings;
  const totalEquity = retainedEarnings + currentPeriodEarnings;

  const rows: BalanceSheetRow[] = [];

  addRow(rows, {
    id: "assets-section",
    label: "Assets",
    amount: null,
    depth: 0,
    rowType: "section",
    section: "Assets",
  });
  addRow(rows, {
    id: "assets-current-assets",
    label: "Current Assets",
    amount: totalAssets,
    depth: 1,
    rowType: "account",
    section: "Assets",
    parentLabel: "Assets",
  });
  addRow(rows, {
    id: "assets-cash",
    label: "Cash & Cash Equivalents",
    amount: totalCash,
    depth: 2,
    rowType: "account",
    section: "Assets",
    parentLabel: "Current Assets",
  });
  cashRows.forEach((row, index) =>
    addRow(rows, {
      id: `assets-cash-${index + 1}`,
      label: row.label,
      amount: row.amount,
      depth: 3,
      rowType: "account",
      section: "Assets",
      parentLabel: "Cash & Cash Equivalents",
    }),
  );
  addRow(rows, {
    id: "assets-cash-total",
    label: "Total for Cash & Cash Equivalents",
    amount: totalCash,
    depth: 2,
    rowType: "subtotal",
    section: "Assets",
    parentLabel: "Current Assets",
  });

  if (receivableRows.length) {
    addRow(rows, {
      id: "assets-ar",
      label: "Accounts Receivable",
      amount: totalReceivables,
      depth: 2,
      rowType: "account",
      section: "Assets",
      parentLabel: "Current Assets",
    });
    receivableRows.forEach((row, index) =>
      addRow(rows, {
        id: `assets-ar-${index + 1}`,
        label: row.label,
        amount: row.amount,
        depth: 3,
        rowType: "account",
        section: "Assets",
        parentLabel: "Accounts Receivable",
      }),
    );
    addRow(rows, {
      id: "assets-ar-total",
      label: "Total for Accounts Receivable",
      amount: totalReceivables,
      depth: 2,
      rowType: "subtotal",
      section: "Assets",
      parentLabel: "Current Assets",
    });
  }

  addRow(rows, {
    id: "assets-current-total",
    label: "Total for Current Assets",
    amount: totalAssets,
    depth: 1,
    rowType: "subtotal",
    section: "Assets",
    parentLabel: "Assets",
  });
  addRow(rows, {
    id: "assets-total",
    label: "Total Assets",
    amount: totalAssets,
    depth: 0,
    rowType: "total",
    section: "Summary",
  });

  addRow(rows, {
    id: "liabilities-equity-section",
    label: "Liabilities & Equity",
    amount: null,
    depth: 0,
    rowType: "section",
    section: "Liabilities & Equity",
  });
  addRow(rows, {
    id: "liabilities-group",
    label: "Liabilities",
    amount: totalLiabilities,
    depth: 1,
    rowType: "account",
    section: "Liabilities & Equity",
    parentLabel: "Liabilities & Equity",
  });
  addRow(rows, {
    id: "liabilities-current",
    label: "Current Liabilities",
    amount: totalLiabilities,
    depth: 2,
    rowType: "account",
    section: "Liabilities & Equity",
    parentLabel: "Liabilities",
  });

  if (accountsPayableRows.length) {
    addRow(rows, {
      id: "liabilities-ap",
      label: "Accounts Payable",
      amount: totalAccountsPayable,
      depth: 3,
      rowType: "account",
      section: "Liabilities & Equity",
      parentLabel: "Current Liabilities",
    });
    accountsPayableRows.forEach((row, index) =>
      addRow(rows, {
        id: `liabilities-ap-${index + 1}`,
        label: row.label,
        amount: row.amount,
        depth: 4,
        rowType: "account",
        section: "Liabilities & Equity",
        parentLabel: "Accounts Payable",
      }),
    );
    addRow(rows, {
      id: "liabilities-ap-total",
      label: "Total for Accounts Payable",
      amount: totalAccountsPayable,
      depth: 3,
      rowType: "subtotal",
      section: "Liabilities & Equity",
      parentLabel: "Current Liabilities",
    });
  }

  if (creditCardRows.length) {
    addRow(rows, {
      id: "liabilities-credit-cards",
      label: "Credit Cards",
      amount: totalCreditCards,
      depth: 3,
      rowType: "account",
      section: "Liabilities & Equity",
      parentLabel: "Current Liabilities",
    });
    creditCardRows.forEach((row, index) =>
      addRow(rows, {
        id: `liabilities-credit-card-${index + 1}`,
        label: row.label,
        amount: row.amount,
        depth: 4,
        rowType: "account",
        section: "Liabilities & Equity",
        parentLabel: "Credit Cards",
      }),
    );
    addRow(rows, {
      id: "liabilities-credit-cards-total",
      label: "Total for Credit Cards",
      amount: totalCreditCards,
      depth: 3,
      rowType: "subtotal",
      section: "Liabilities & Equity",
      parentLabel: "Current Liabilities",
    });
  }

  addRow(rows, {
    id: "liabilities-current-total",
    label: "Total for Current Liabilities",
    amount: totalLiabilities,
    depth: 2,
    rowType: "subtotal",
    section: "Liabilities & Equity",
    parentLabel: "Liabilities",
  });
  addRow(rows, {
    id: "liabilities-total",
    label: "Total Liabilities",
    amount: totalLiabilities,
    depth: 1,
    rowType: "subtotal",
    section: "Liabilities & Equity",
    parentLabel: "Liabilities & Equity",
  });

  addRow(rows, {
    id: "equity-group",
    label: "Equity",
    amount: totalEquity,
    depth: 1,
    rowType: "account",
    section: "Liabilities & Equity",
    parentLabel: "Liabilities & Equity",
  });
  addRow(rows, {
    id: "equity-retained",
    label: "Retained Earnings",
    amount: retainedEarnings,
    depth: 2,
    rowType: "account",
    section: "Liabilities & Equity",
    parentLabel: "Equity",
  });
  addRow(rows, {
    id: "equity-current",
    label: "Current Period Earnings",
    amount: currentPeriodEarnings,
    depth: 2,
    rowType: "account",
    section: "Liabilities & Equity",
    parentLabel: "Equity",
  });
  addRow(rows, {
    id: "equity-total",
    label: "Total Equity",
    amount: totalEquity,
    depth: 1,
    rowType: "subtotal",
    section: "Liabilities & Equity",
    parentLabel: "Liabilities & Equity",
  });
  addRow(rows, {
    id: "liabilities-equity-total",
    label: "Total Liabilities & Equity",
    amount: totalLiabilities + totalEquity,
    depth: 0,
    rowType: "total",
    section: "Summary",
  });

  return {
    rows,
    options: { years },
    periodLabel: range.label,
    asOfDate: range.to.toISOString().slice(0, 10),
    source: "mock" as const,
  };
}

export function useBalanceSheetStatement(filters: BalanceSheetFilters) {
  return useQuery({
    queryKey: [
      "balance-sheet-statement",
      filters.periodPreset,
      filters.month,
      filters.year,
      filters.customDate,
      filters.basis,
      filters.currency,
    ],
    queryFn: async (): Promise<BalanceSheetStatementData> => buildMockRows(filters),
  });
}
