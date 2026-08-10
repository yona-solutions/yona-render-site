import { addDays, differenceInDays, format, parseISO, startOfMonth, subMonths } from "date-fns";

export const MOCK_COMPANY_ID = "mock-company-001";
const STORAGE_KEY = "financeflow-mock-state-v1";

export type AccountingBasis = "accrual" | "cash";

export interface MockAccountingSettings {
  id: string;
  company_id: string;
  basis: AccountingBasis;
  base_currency: string;
  timezone: string;
  allow_future_dates: boolean;
}

export interface MockCustomer {
  id: string;
  name: string;
  email?: string;
  country?: string;
  region?: string;
}

export interface MockContact {
  id: string;
  company_id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  avatar_color: string;
  created_at: string;
  updated_at: string;
}

export interface MockInvoice {
  id: string;
  company_id: string;
  customer_id: string;
  issue_date: string;
  due_date: string;
  amount_total: number;
  open_amount: number;
  amount_total_base: number;
  original_amount: number;
  original_currency: string;
  status: "Draft" | "Open" | "Paid" | "Overdue" | "Cancelled" | "Partial" | "Partially Paid";
  channel?: string | null;
  product_id?: string | null;
  region?: string | null;
}

export interface MockPayment {
  id: string;
  company_id: string;
  invoice_id: string;
  customer_id: string;
  date: string;
  amount: number;
  original_amount: number;
  original_currency: string;
  status: "Completed" | "Pending";
}

export interface MockExpense {
  id: string;
  company_id: string;
  date: string;
  amount: number;
  category: string;
  vendor: string;
  project_id?: string;
  department?: string;
  original_currency: string;
  original_amount: number;
}

export interface MockVendorBill {
  id: string;
  company_id: string;
  vendor_name: string;
  issue_date: string;
  due_date: string;
  amount_total: number;
  open_amount: number;
  original_currency: string;
  status: "Open" | "Pending" | "Overdue" | "Partial" | "Partially Paid" | "Paid";
  category?: string;
}

export interface MockAccount {
  id: string;
  company_id: string;
  account_name: string;
  balance: number;
  currency: string;
}

export interface MockBankTransaction {
  id: string;
  company_id: string;
  date: string;
  account_name: string;
  amount: number;
  type: "inflow" | "outflow";
  counterparty: string;
  category: string;
  original_currency: string;
  original_amount: number;
}

export interface MockFxRate {
  id: string;
  date: string;
  currency: string;
  rate_to_base: number;
  is_imputed: boolean;
}

export interface MockFilterSegment {
  id: string;
  company_id: string;
  segment_type: "project" | "department" | "product" | "region";
  segment_value: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MockScheduledReport {
  id: string;
  company_id: string;
  report_type: string;
  report_name: string;
  frequency: string;
  next_run_date: string;
  recipients: string[];
  format: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MockFinanceState {
  accountingSettings: MockAccountingSettings;
  customers: MockCustomer[];
  contacts: MockContact[];
  invoices: MockInvoice[];
  payments: MockPayment[];
  expenses: MockExpense[];
  vendorBills: MockVendorBill[];
  accounts: MockAccount[];
  bankTransactions: MockBankTransaction[];
  fxRates: MockFxRate[];
  filterSegments: MockFilterSegment[];
  scheduledReports: MockScheduledReport[];
}

export interface MockRevenueFact {
  id: string;
  company_id: string;
  date: string;
  amount_accrual: number;
  amount_cash: number;
  channel?: string | null;
  product_id?: string | null;
  region?: string | null;
}

export interface MockExpenseFact {
  id: string;
  company_id: string;
  date: string;
  amount: number;
  category: string;
  vendor: string;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getSeedMonth(monthsAgo: number, day: number) {
  return normalizeDate(addDays(startOfMonth(subMonths(new Date(), monthsAgo)), day - 1));
}

function buildDefaultState(): MockFinanceState {
  const fxRates: MockFxRate[] = [];
  const fxTemplates = [
    { currency: "EUR", rates: [1.08, 1.09, 1.1, 1.08, 1.07, 1.06, 1.08, 1.09] },
    { currency: "GBP", rates: [1.26, 1.27, 1.28, 1.27, 1.25, 1.24, 1.25, 1.26] },
    { currency: "CAD", rates: [0.74, 0.75, 0.75, 0.74, 0.73, 0.73, 0.74, 0.74] },
    { currency: "AUD", rates: [0.66, 0.67, 0.68, 0.67, 0.66, 0.65, 0.66, 0.67] },
    { currency: "JPY", rates: [0.0068, 0.0069, 0.007, 0.0069, 0.0068, 0.0068, 0.0069, 0.007] }
  ];

  for (let index = 7; index >= 0; index -= 1) {
    const date = getSeedMonth(index, 1);
    for (const template of fxTemplates) {
      const rate = template.rates[7 - index] ?? template.rates[template.rates.length - 1];
      fxRates.push({
        id: makeId("fx"),
        date,
        currency: template.currency,
        rate_to_base: rate,
        is_imputed: false
      });
    }
  }

  const customers: MockCustomer[] = [
    { id: "cust-acme", name: "Acme Corporation", email: "ap@acme.co", country: "United States", region: "North America" },
    { id: "cust-techstart", name: "TechStart LLC", email: "billing@techstart.io", country: "United States", region: "North America" },
    { id: "cust-global", name: "Global Partners", email: "finance@globalpartners.eu", country: "Germany", region: "Europe" },
    { id: "cust-enterprise", name: "Enterprise Client", email: "acct@enterpriseclient.com", country: "United States", region: "North America" },
    { id: "cust-consulting", name: "Consulting Services", email: "ops@consultingservices.io", country: "Canada", region: "North America" },
    { id: "cust-major", name: "Major Contract", email: "payables@majorcontract.com", country: "United Kingdom", region: "Europe" },
    { id: "cust-recurring", name: "Recurring Customer", email: "finance@recurringcustomer.com", country: "United States", region: "North America" },
    { id: "cust-newpartner", name: "New Partnership", email: "finance@newpartnership.com", country: "Singapore", region: "Asia Pacific" },
    { id: "cust-bluepeak", name: "BluePeak Ventures", email: "controller@bluepeak.vc", country: "United States", region: "North America" },
    { id: "cust-northern", name: "Northern Retail Group", email: "billing@northernretail.ca", country: "Canada", region: "North America" }
  ];

  const invoiceTemplates = [
    { id: "inv-001", customerId: "cust-acme", monthsAgo: 7, day: 5, amount: 15000, status: "Paid", currency: "USD", channel: "Direct", product: "Product A", region: "North America" },
    { id: "inv-002", customerId: "cust-techstart", monthsAgo: 7, day: 12, amount: 8500, status: "Paid", currency: "USD", channel: "Referral", product: "Services", region: "North America" },
    { id: "inv-003", customerId: "cust-global", monthsAgo: 6, day: 8, amount: 18000, status: "Paid", currency: "EUR", channel: "Partner", product: "Product B", region: "Europe" },
    { id: "inv-004", customerId: "cust-enterprise", monthsAgo: 6, day: 18, amount: 24000, status: "Paid", currency: "USD", channel: "Enterprise", product: "Product A", region: "North America" },
    { id: "inv-005", customerId: "cust-consulting", monthsAgo: 5, day: 4, amount: 9200, status: "Paid", currency: "USD", channel: "Direct", product: "Services", region: "North America" },
    { id: "inv-006", customerId: "cust-major", monthsAgo: 5, day: 22, amount: 21000, status: "Paid", currency: "GBP", channel: "Partner", product: "Product C", region: "Europe" },
    { id: "inv-007", customerId: "cust-recurring", monthsAgo: 4, day: 10, amount: 11200, status: "Paid", currency: "USD", channel: "Online", product: "Product B", region: "North America" },
    { id: "inv-008", customerId: "cust-newpartner", monthsAgo: 4, day: 21, amount: 16800, status: "Paid", currency: "USD", channel: "Partner", product: "Services", region: "Asia Pacific" },
    { id: "inv-009", customerId: "cust-bluepeak", monthsAgo: 3, day: 6, amount: 13400, status: "Paid", currency: "USD", channel: "Direct", product: "Product A", region: "North America" },
    { id: "inv-010", customerId: "cust-global", monthsAgo: 3, day: 19, amount: 12600, status: "Paid", currency: "EUR", channel: "Partner", product: "Product B", region: "Europe" },
    { id: "inv-011", customerId: "cust-northern", monthsAgo: 2, day: 7, amount: 14750, status: "Partially Paid", currency: "CAD", channel: "Wholesale", product: "Product C", region: "North America" },
    { id: "inv-012", customerId: "cust-enterprise", monthsAgo: 2, day: 23, amount: 26500, status: "Open", currency: "USD", channel: "Enterprise", product: "Product A", region: "North America" },
    { id: "inv-013", customerId: "cust-acme", monthsAgo: 1, day: 5, amount: 9800, status: "Paid", currency: "USD", channel: "Direct", product: "Services", region: "North America" },
    { id: "inv-014", customerId: "cust-techstart", monthsAgo: 1, day: 17, amount: 11800, status: "Overdue", currency: "USD", channel: "Referral", product: "Product B", region: "North America" },
    { id: "inv-015", customerId: "cust-major", monthsAgo: 0, day: 4, amount: 19100, status: "Open", currency: "GBP", channel: "Partner", product: "Product C", region: "Europe" },
    { id: "inv-016", customerId: "cust-bluepeak", monthsAgo: 0, day: 8, amount: 15400, status: "Draft", currency: "USD", channel: "Direct", product: "Product A", region: "North America" }
  ] as const;

  const invoices: MockInvoice[] = [];
  const payments: MockPayment[] = [];

  for (const template of invoiceTemplates) {
    const issueDate = getSeedMonth(template.monthsAgo, template.day);
    const dueDate = normalizeDate(addDays(parseISO(issueDate), 30));
    const amountBase = convertAmountWithRates(template.amount, template.currency, "USD", issueDate, fxRates);
    const openAmount =
      template.status === "Paid" ? 0 :
      template.status === "Partially Paid" ? Number((amountBase * 0.42).toFixed(2)) :
      amountBase;

    invoices.push({
      id: template.id,
      company_id: MOCK_COMPANY_ID,
      customer_id: template.customerId,
      issue_date: issueDate,
      due_date: dueDate,
      amount_total: template.amount,
      open_amount: openAmount,
      amount_total_base: Number(amountBase.toFixed(2)),
      original_amount: template.amount,
      original_currency: template.currency,
      status: template.status,
      channel: template.channel,
      product_id: template.product,
      region: template.region
    });

    if (template.status === "Paid" || template.status === "Partially Paid") {
      const paidBase = template.status === "Paid" ? amountBase : amountBase - openAmount;
      const paidOriginal = template.status === "Paid" ? template.amount : template.amount - (template.amount * 0.42);
      payments.push({
        id: makeId("pay"),
        company_id: MOCK_COMPANY_ID,
        invoice_id: template.id,
        customer_id: template.customerId,
        date: normalizeDate(addDays(parseISO(issueDate), 18)),
        amount: Number(paidBase.toFixed(2)),
        original_amount: Number(paidOriginal.toFixed(2)),
        original_currency: template.currency,
        status: "Completed"
      });
    }
  }

  const expenseTemplates = [
    { id: "exp-001", monthsAgo: 7, day: 7, amount: 2200, currency: "USD", category: "Office Supplies", vendor: "Staples Business", project: "Project Alpha", department: "Operations" },
    { id: "exp-002", monthsAgo: 7, day: 11, amount: 5200, currency: "USD", category: "Marketing & Advertising", vendor: "Google Ads", project: "Project Beta", department: "Marketing" },
    { id: "exp-003", monthsAgo: 7, day: 15, amount: 8600, currency: "USD", category: "Payroll", vendor: "Gusto Payroll", department: "Operations" },
    { id: "exp-004", monthsAgo: 7, day: 22, amount: 4100, currency: "USD", category: "Cost of Sales", vendor: "Manufacturing Supply Co", project: "Project Alpha", department: "Operations" },
    { id: "exp-005", monthsAgo: 6, day: 5, amount: 3100, currency: "USD", category: "Software & Subscriptions", vendor: "Microsoft 365", department: "Operations" },
    { id: "exp-006", monthsAgo: 6, day: 12, amount: 9100, currency: "USD", category: "Rent & Facilities", vendor: "Downtown Properties LLC", department: "Operations" },
    { id: "exp-007", monthsAgo: 6, day: 17, amount: 2900, currency: "USD", category: "Professional Services", vendor: "Accounting Solutions Inc", department: "Finance" },
    { id: "exp-008", monthsAgo: 6, day: 25, amount: 3800, currency: "USD", category: "Cost of Sales", vendor: "Materials Depot", project: "Project Gamma", department: "Operations" },
    { id: "exp-009", monthsAgo: 5, day: 8, amount: 1900, currency: "USD", category: "Travel & Entertainment", vendor: "Delta Airlines", department: "Sales" },
    { id: "exp-010", monthsAgo: 5, day: 15, amount: 8400, currency: "USD", category: "Payroll", vendor: "Gusto Payroll", department: "Operations" },
    { id: "exp-011", monthsAgo: 5, day: 19, amount: 2600, currency: "USD", category: "Utilities", vendor: "Pacific Gas & Electric", department: "Operations" },
    { id: "exp-012", monthsAgo: 5, day: 27, amount: 4400, currency: "USD", category: "Cost of Sales", vendor: "Freight & Logistics Co", department: "Operations" },
    { id: "exp-013", monthsAgo: 4, day: 6, amount: 2300, currency: "USD", category: "Insurance", vendor: "State Farm Insurance", department: "Operations" },
    { id: "exp-014", monthsAgo: 4, day: 14, amount: 6200, currency: "USD", category: "Marketing & Advertising", vendor: "LinkedIn Ads", department: "Marketing" },
    { id: "exp-015", monthsAgo: 4, day: 21, amount: 7800, currency: "USD", category: "Payroll", vendor: "Gusto Payroll", department: "Operations" },
    { id: "exp-016", monthsAgo: 4, day: 25, amount: 3500, currency: "USD", category: "Cost of Sales", vendor: "Contract Packaging Inc", department: "Operations" },
    { id: "exp-017", monthsAgo: 3, day: 4, amount: 2800, currency: "USD", category: "Software & Subscriptions", vendor: "Slack Technologies", department: "Operations" },
    { id: "exp-018", monthsAgo: 3, day: 13, amount: 9300, currency: "USD", category: "Rent & Facilities", vendor: "Downtown Properties LLC", department: "Operations" },
    { id: "exp-019", monthsAgo: 3, day: 20, amount: 4700, currency: "USD", category: "Cost of Sales", vendor: "Manufacturing Supply Co", department: "Operations" },
    { id: "exp-020", monthsAgo: 2, day: 9, amount: 2400, currency: "USD", category: "Office Supplies", vendor: "Amazon Business", project: "Project Beta", department: "Operations" },
    { id: "exp-021", monthsAgo: 2, day: 16, amount: 8500, currency: "USD", category: "Payroll", vendor: "Gusto Payroll", department: "Operations" },
    { id: "exp-022", monthsAgo: 2, day: 24, amount: 5600, currency: "USD", category: "Cost of Sales", vendor: "Materials Depot", project: "Project Delta", department: "Operations" },
    { id: "exp-023", monthsAgo: 1, day: 7, amount: 2100, currency: "USD", category: "Professional Services", vendor: "Legal Associates LLC", department: "Finance" },
    { id: "exp-024", monthsAgo: 1, day: 18, amount: 4800, currency: "USD", category: "Marketing & Advertising", vendor: "Meta Ads", department: "Marketing" },
    { id: "exp-025", monthsAgo: 1, day: 22, amount: 7900, currency: "USD", category: "Payroll", vendor: "Gusto Payroll", department: "Operations" },
    { id: "exp-026", monthsAgo: 1, day: 26, amount: 3400, currency: "USD", category: "Cost of Sales", vendor: "Freight & Logistics Co", department: "Operations" },
    { id: "exp-027", monthsAgo: 0, day: 5, amount: 2600, currency: "USD", category: "Software & Subscriptions", vendor: "Adobe Systems", department: "Operations" },
    { id: "exp-028", monthsAgo: 0, day: 8, amount: 8200, currency: "USD", category: "Rent & Facilities", vendor: "Downtown Properties LLC", department: "Operations" }
  ] as const;

  const expenses: MockExpense[] = expenseTemplates.map((template) => ({
    id: template.id,
    company_id: MOCK_COMPANY_ID,
    date: getSeedMonth(template.monthsAgo, template.day),
    amount: template.amount,
    category: template.category,
    vendor: template.vendor,
    project_id: template.project,
    department: template.department,
    original_currency: template.currency,
    original_amount: template.amount
  }));

  const vendorBills: MockVendorBill[] = [
    { id: "bill-001", company_id: MOCK_COMPANY_ID, vendor_name: "Downtown Properties LLC", issue_date: getSeedMonth(0, 1), due_date: getSeedMonth(0, 12), amount_total: 8200, open_amount: 8200, original_currency: "USD", status: "Open", category: "Rent & Facilities" },
    { id: "bill-002", company_id: MOCK_COMPANY_ID, vendor_name: "Adobe Systems", issue_date: getSeedMonth(0, 3), due_date: getSeedMonth(0, 15), amount_total: 2600, open_amount: 2600, original_currency: "USD", status: "Pending", category: "Software & Subscriptions" },
    { id: "bill-003", company_id: MOCK_COMPANY_ID, vendor_name: "Freight & Logistics Co", issue_date: getSeedMonth(1, 24), due_date: getSeedMonth(0, 2), amount_total: 3400, open_amount: 3400, original_currency: "USD", status: "Overdue", category: "Cost of Sales" },
    { id: "bill-004", company_id: MOCK_COMPANY_ID, vendor_name: "Meta Ads", issue_date: getSeedMonth(1, 18), due_date: getSeedMonth(0, 5), amount_total: 4800, open_amount: 1800, original_currency: "USD", status: "Partial", category: "Marketing & Advertising" },
    { id: "bill-005", company_id: MOCK_COMPANY_ID, vendor_name: "Legal Associates LLC", issue_date: getSeedMonth(1, 7), due_date: getSeedMonth(0, 8), amount_total: 2100, open_amount: 2100, original_currency: "USD", status: "Open", category: "Professional Services" }
  ];

  const accounts: MockAccount[] = [
    { id: "acct-001", company_id: MOCK_COMPANY_ID, account_name: "Main Operating Account", balance: 126500, currency: "USD" },
    { id: "acct-002", company_id: MOCK_COMPANY_ID, account_name: "Savings Account", balance: 28400, currency: "USD" },
    { id: "acct-003", company_id: MOCK_COMPANY_ID, account_name: "Euro Account", balance: 18000, currency: "EUR" },
    { id: "acct-004", company_id: MOCK_COMPANY_ID, account_name: "Business Checking", balance: 64250, currency: "USD" },
    { id: "acct-005", company_id: MOCK_COMPANY_ID, account_name: "Corporate Credit Card", balance: -6400, currency: "USD" }
  ];

  const bankTransactions: MockBankTransaction[] = [
    ...payments.map((payment, index) => ({
      id: `txn-in-${index + 1}`,
      company_id: MOCK_COMPANY_ID,
      date: payment.date,
      account_name: "Main Operating Account",
      amount: payment.amount,
      type: "inflow" as const,
      counterparty: customers.find((customer) => customer.id === payment.customer_id)?.name || "Customer",
      category: "Revenue",
      original_currency: payment.original_currency,
      original_amount: payment.original_amount
    })),
    ...expenses.map((expense, index) => ({
      id: `txn-out-${index + 1}`,
      company_id: MOCK_COMPANY_ID,
      date: expense.date,
      account_name: "Main Operating Account",
      amount: expense.amount,
      type: "outflow" as const,
      counterparty: expense.vendor,
      category: expense.category,
      original_currency: expense.original_currency,
      original_amount: expense.original_amount
    }))
  ].sort((a, b) => a.date.localeCompare(b.date));

  const now = new Date().toISOString();
  const contacts: MockContact[] = [
    { id: "contact-001", company_id: MOCK_COMPANY_ID, name: "Mia Chen", email: "mia@acme.co", phone: "(415) 555-0181", address: "San Francisco, CA", notes: "Primary finance contact", avatar_color: "#2563eb", created_at: now, updated_at: now },
    { id: "contact-002", company_id: MOCK_COMPANY_ID, name: "Owen Patel", email: "owen@globalpartners.eu", phone: "(415) 555-0192", address: "Berlin, Germany", notes: "Quarterly review stakeholder", avatar_color: "#16a34a", created_at: now, updated_at: now },
    { id: "contact-003", company_id: MOCK_COMPANY_ID, name: "Sofia Ramirez", email: "sofia@majorcontract.com", phone: "(415) 555-0158", address: "London, UK", notes: "Large contract billing owner", avatar_color: "#dc2626", created_at: now, updated_at: now }
  ];

  const filterSegments: MockFilterSegment[] = [
    { id: "seg-001", company_id: MOCK_COMPANY_ID, segment_type: "project", segment_value: "Project Alpha", is_active: true, created_at: now, updated_at: now },
    { id: "seg-002", company_id: MOCK_COMPANY_ID, segment_type: "project", segment_value: "Project Beta", is_active: true, created_at: now, updated_at: now },
    { id: "seg-003", company_id: MOCK_COMPANY_ID, segment_type: "department", segment_value: "Sales", is_active: true, created_at: now, updated_at: now },
    { id: "seg-004", company_id: MOCK_COMPANY_ID, segment_type: "department", segment_value: "Marketing", is_active: true, created_at: now, updated_at: now },
    { id: "seg-005", company_id: MOCK_COMPANY_ID, segment_type: "department", segment_value: "Operations", is_active: true, created_at: now, updated_at: now },
    { id: "seg-006", company_id: MOCK_COMPANY_ID, segment_type: "product", segment_value: "Product A", is_active: true, created_at: now, updated_at: now },
    { id: "seg-007", company_id: MOCK_COMPANY_ID, segment_type: "product", segment_value: "Product B", is_active: true, created_at: now, updated_at: now },
    { id: "seg-008", company_id: MOCK_COMPANY_ID, segment_type: "product", segment_value: "Product C", is_active: true, created_at: now, updated_at: now },
    { id: "seg-009", company_id: MOCK_COMPANY_ID, segment_type: "region", segment_value: "North America", is_active: true, created_at: now, updated_at: now },
    { id: "seg-010", company_id: MOCK_COMPANY_ID, segment_type: "region", segment_value: "Europe", is_active: true, created_at: now, updated_at: now },
    { id: "seg-011", company_id: MOCK_COMPANY_ID, segment_type: "region", segment_value: "Asia Pacific", is_active: true, created_at: now, updated_at: now }
  ];

  const scheduledReports: MockScheduledReport[] = [
    { id: "sched-001", company_id: MOCK_COMPANY_ID, report_type: "profit-loss", report_name: "Monthly P&L", frequency: "monthly", next_run_date: normalizeDate(addDays(new Date(), 5)), recipients: ["finance@company.com"], format: "pdf", is_active: true, created_at: now, updated_at: now },
    { id: "sched-002", company_id: MOCK_COMPANY_ID, report_type: "cash-flow", report_name: "Weekly Cash Summary", frequency: "weekly", next_run_date: normalizeDate(addDays(new Date(), 2)), recipients: ["cfo@company.com", "ops@company.com"], format: "excel", is_active: true, created_at: now, updated_at: now }
  ];

  return {
    accountingSettings: {
      id: "acct-settings-001",
      company_id: MOCK_COMPANY_ID,
      basis: "accrual",
      base_currency: "USD",
      timezone: "America/Los_Angeles",
      allow_future_dates: false
    },
    customers,
    contacts,
    invoices,
    payments,
    expenses,
    vendorBills,
    accounts,
    bankTransactions,
    fxRates,
    filterSegments,
    scheduledReports
  };
}

function convertAmountWithRates(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: string,
  fxRates: MockFxRate[]
) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const fromRate = getRateForDate(fxRates, fromCurrency, date);
  const toRate = getRateForDate(fxRates, toCurrency, date);
  const amountInBase = fromCurrency === "USD" ? amount : amount * fromRate;
  return toCurrency === "USD" ? amountInBase : amountInBase / toRate;
}

function getRateForDate(fxRates: MockFxRate[], currency: string, date: string) {
  if (currency === "USD") {
    return 1;
  }

  const matchingRates = fxRates
    .filter((rate) => rate.currency === currency && rate.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date));
  return matchingRates[0]?.rate_to_base ?? 1;
}

function ensureStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function getMockState(): MockFinanceState {
  const storage = ensureStorage();
  if (!storage) {
    return buildDefaultState();
  }

  const existing = storage.getItem(STORAGE_KEY);
  if (!existing) {
    const seeded = buildDefaultState();
    storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return deepClone(seeded);
  }

  try {
    return JSON.parse(existing) as MockFinanceState;
  } catch {
    const seeded = buildDefaultState();
    storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return deepClone(seeded);
  }
}

export function saveMockState(state: MockFinanceState) {
  const storage = ensureStorage();
  if (!storage) {
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetMockState() {
  const seeded = buildDefaultState();
  saveMockState(seeded);
  return seeded;
}

export function getFxRateLookup(state = getMockState()) {
  const byDate: Record<string, Record<string, number>> = {};
  const latest: Record<string, number> = {};
  const latestDate: Record<string, string> = {};

  for (const rate of state.fxRates) {
    if (!byDate[rate.currency]) {
      byDate[rate.currency] = {};
    }
    if (!byDate[rate.currency][rate.date]) {
      byDate[rate.currency][rate.date] = rate.rate_to_base;
    }
    if (!latestDate[rate.currency] || rate.date >= latestDate[rate.currency]) {
      latestDate[rate.currency] = rate.date;
      latest[rate.currency] = rate.rate_to_base;
    }
  }

  return { byDate, latest };
}

export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date?: string,
  state = getMockState()
) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const lookup = getFxRateLookup(state);
  const fromRate = fromCurrency === "USD"
    ? 1
    : getClosestRate(lookup.byDate[fromCurrency] || {}, lookup.latest[fromCurrency] || 1, date);
  const toRate = toCurrency === "USD"
    ? 1
    : getClosestRate(lookup.byDate[toCurrency] || {}, lookup.latest[toCurrency] || 1, date);

  const amountInBase = fromCurrency === "USD" ? amount : amount * fromRate;
  return toCurrency === "USD" ? amountInBase : amountInBase / toRate;
}

function getClosestRate(byDate: Record<string, number>, fallback: number, date?: string) {
  if (!date) {
    return fallback || 1;
  }

  if (byDate[date]) {
    return byDate[date];
  }

  const priorDate = Object.keys(byDate).sort().reverse().find((key) => key <= date);
  return priorDate ? byDate[priorDate] : fallback || 1;
}

export function filterByDate<T>(items: T[], getDate: (item: T) => string, range?: { from?: Date; to?: Date }) {
  const from = range?.from ? normalizeDate(range.from) : undefined;
  const to = range?.to ? normalizeDate(range.to) : undefined;

  return items.filter((item) => {
    const value = getDate(item);
    if (from && value < from) {
      return false;
    }
    if (to && value > to) {
      return false;
    }
    return true;
  });
}

export function getFactsRevenueDaily(state = getMockState()): MockRevenueFact[] {
  const invoiceRows = state.invoices.map((invoice) => ({
    id: `${invoice.id}-accrual`,
    company_id: invoice.company_id,
    date: invoice.issue_date,
    amount_accrual: invoice.amount_total_base,
    amount_cash: 0,
    channel: invoice.channel,
    product_id: invoice.product_id,
    region: invoice.region
  }));

  const paymentRows = state.payments.map((payment) => {
    const invoice = state.invoices.find((item) => item.id === payment.invoice_id);
    return {
      id: `${payment.id}-cash`,
      company_id: payment.company_id,
      date: payment.date,
      amount_accrual: 0,
      amount_cash: payment.amount,
      channel: invoice?.channel,
      product_id: invoice?.product_id,
      region: invoice?.region
    };
  });

  return [...invoiceRows, ...paymentRows].sort((a, b) => a.date.localeCompare(b.date));
}

export function getFactsExpensesDaily(state = getMockState()): MockExpenseFact[] {
  return state.expenses
    .map((expense) => ({
      id: expense.id,
      company_id: expense.company_id,
      date: expense.date,
      amount: expense.amount,
      category: expense.category,
      vendor: expense.vendor
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getFactsCashflowDaily(state = getMockState()) {
  const byDate = new Map<string, { date: string; inflow: number; outflow: number }>();

  for (const transaction of state.bankTransactions) {
    const current = byDate.get(transaction.date) || { date: transaction.date, inflow: 0, outflow: 0 };
    if (transaction.type === "inflow") {
      current.inflow += Math.abs(transaction.amount);
    } else {
      current.outflow += Math.abs(transaction.amount);
    }
    byDate.set(transaction.date, current);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function getCustomersWithDetails(state = getMockState()) {
  return state.customers.map((customer) => ({
    ...customer,
    invoices: state.invoices.filter((invoice) => invoice.customer_id === customer.id)
  }));
}

export function createInvoice(input: {
  customer_id: string;
  issue_date: string;
  due_date: string;
  amount_total: number;
  original_currency: string;
  status: MockInvoice["status"];
  channel?: string;
  product_id?: string;
  region?: string;
}) {
  const state = getMockState();
  const amountTotal = Number(input.amount_total);
  const amountBase = convertCurrency(amountTotal, input.original_currency || "USD", "USD", input.issue_date, state);

  const invoice: MockInvoice = {
    id: makeId("inv"),
    company_id: MOCK_COMPANY_ID,
    customer_id: input.customer_id,
    issue_date: input.issue_date,
    due_date: input.due_date,
    amount_total: amountTotal,
    open_amount: input.status === "Paid" ? 0 : amountBase,
    amount_total_base: amountBase,
    original_amount: amountTotal,
    original_currency: input.original_currency || "USD",
    status: input.status,
    channel: input.channel || null,
    product_id: input.product_id || null,
    region: input.region || null
  };

  state.invoices.unshift(invoice);

  if (input.status === "Paid") {
    const payment: MockPayment = {
      id: makeId("pay"),
      company_id: MOCK_COMPANY_ID,
      invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      date: input.issue_date,
      amount: amountBase,
      original_amount: amountTotal,
      original_currency: input.original_currency || "USD",
      status: "Completed"
    };
    state.payments.unshift(payment);
    state.bankTransactions.unshift({
      id: makeId("txn"),
      company_id: MOCK_COMPANY_ID,
      date: input.issue_date,
      account_name: "Main Operating Account",
      amount: amountBase,
      type: "inflow",
      counterparty: state.customers.find((customer) => customer.id === input.customer_id)?.name || "Customer",
      category: "Revenue",
      original_currency: input.original_currency || "USD",
      original_amount: amountTotal
    });
  }

  saveMockState(state);
  return invoice;
}

export function upsertContact(input: Partial<MockContact> & { name: string; id?: string }) {
  const state = getMockState();
  const timestamp = new Date().toISOString();

  if (input.id) {
    state.contacts = state.contacts.map((contact) =>
      contact.id === input.id
        ? {
            ...contact,
            ...input,
            updated_at: timestamp
          }
        : contact
    );
    saveMockState(state);
    return state.contacts.find((contact) => contact.id === input.id)!;
  }

  const contact: MockContact = {
    id: makeId("contact"),
    company_id: MOCK_COMPANY_ID,
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    notes: input.notes,
    avatar_color: input.avatar_color || "#2563eb",
    created_at: timestamp,
    updated_at: timestamp
  };
  state.contacts.unshift(contact);
  saveMockState(state);
  return contact;
}

export function deleteContact(id: string) {
  const state = getMockState();
  state.contacts = state.contacts.filter((contact) => contact.id !== id);
  saveMockState(state);
}

export function updateAccountingBasis(basis: AccountingBasis) {
  const state = getMockState();
  state.accountingSettings.basis = basis;
  saveMockState(state);
  return state.accountingSettings;
}

export function upsertSegment(input: Partial<MockFilterSegment> & { segment_type: MockFilterSegment["segment_type"]; segment_value: string; id?: string }) {
  const state = getMockState();
  const timestamp = new Date().toISOString();

  if (input.id) {
    state.filterSegments = state.filterSegments.map((segment) =>
      segment.id === input.id
        ? { ...segment, ...input, updated_at: timestamp }
        : segment
    );
    saveMockState(state);
    return state.filterSegments.find((segment) => segment.id === input.id)!;
  }

  const segment: MockFilterSegment = {
    id: makeId("segment"),
    company_id: MOCK_COMPANY_ID,
    segment_type: input.segment_type,
    segment_value: input.segment_value,
    is_active: input.is_active ?? true,
    created_at: timestamp,
    updated_at: timestamp
  };
  state.filterSegments.push(segment);
  saveMockState(state);
  return segment;
}

export function deleteSegment(id: string) {
  const state = getMockState();
  state.filterSegments = state.filterSegments.filter((segment) => segment.id !== id);
  saveMockState(state);
}

export function upsertScheduledReport(input: Partial<MockScheduledReport> & {
  report_type: string;
  report_name: string;
  frequency: string;
  next_run_date: string;
  recipients: string[];
  format: string;
  id?: string;
}) {
  const state = getMockState();
  const timestamp = new Date().toISOString();

  if (input.id) {
    state.scheduledReports = state.scheduledReports.map((report) =>
      report.id === input.id
        ? { ...report, ...input, updated_at: timestamp }
        : report
    );
    saveMockState(state);
    return state.scheduledReports.find((report) => report.id === input.id)!;
  }

  const report: MockScheduledReport = {
    id: makeId("schedule"),
    company_id: MOCK_COMPANY_ID,
    report_type: input.report_type,
    report_name: input.report_name,
    frequency: input.frequency,
    next_run_date: input.next_run_date,
    recipients: input.recipients,
    format: input.format,
    is_active: input.is_active ?? true,
    created_at: timestamp,
    updated_at: timestamp
  };
  state.scheduledReports.unshift(report);
  saveMockState(state);
  return report;
}

export function deleteScheduledReport(id: string) {
  const state = getMockState();
  state.scheduledReports = state.scheduledReports.filter((report) => report.id !== id);
  saveMockState(state);
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === "\"") {
        inQuotes = !inQuotes;
        continue;
      }
      if (character === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
        continue;
      }
      current += character;
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = values[index] || "";
      return record;
    }, {});
  });
}

export function importMockCsv(
  dataType: "invoices" | "expenses" | "bank_transactions" | "fx_rates" | "vendor_bills" | "accounts",
  text: string
) {
  const rows = parseCsv(text);
  const state = getMockState();
  let processed = 0;

  if (dataType === "accounts") {
    for (const row of rows) {
      if (!row.account_name || !row.balance) continue;
      state.accounts.push({
        id: makeId("acct"),
        company_id: MOCK_COMPANY_ID,
        account_name: row.account_name,
        balance: Number(row.balance),
        currency: row.currency || "USD"
      });
      processed += 1;
    }
  }

  if (dataType === "bank_transactions") {
    for (const row of rows) {
      if (!row.date || !row.amount) continue;
      const rawAmount = Number(row.amount);
      state.bankTransactions.push({
        id: makeId("txn"),
        company_id: MOCK_COMPANY_ID,
        date: row.date,
        account_name: row.account_name || "Main Operating Account",
        amount: Math.abs(rawAmount),
        type: row.type?.toLowerCase() === "out" || rawAmount < 0 ? "outflow" : "inflow",
        counterparty: row.counterparty || "Imported Transaction",
        category: row.category || "Imported",
        original_currency: row.original_currency || "USD",
        original_amount: Math.abs(Number(row.original_amount || rawAmount))
      });
      processed += 1;
    }
  }

  if (dataType === "expenses") {
    for (const row of rows) {
      if (!row.date || !row.amount || !row.category) continue;
      state.expenses.push({
        id: makeId("exp"),
        company_id: MOCK_COMPANY_ID,
        date: row.date,
        amount: Number(row.amount),
        category: row.category,
        vendor: row.vendor || "Imported Vendor",
        project_id: row.project_id || undefined,
        original_currency: row.original_currency || "USD",
        original_amount: Number(row.original_amount || row.amount)
      });
      processed += 1;
    }
  }

  if (dataType === "fx_rates") {
    for (const row of rows) {
      if (!row.date || !row.currency || !row.rate_to_base) continue;
      state.fxRates.push({
        id: makeId("fx"),
        date: row.date,
        currency: row.currency,
        rate_to_base: Number(row.rate_to_base),
        is_imputed: row.is_imputed === "true"
      });
      processed += 1;
    }
  }

  if (dataType === "vendor_bills") {
    for (const row of rows) {
      if (!row.vendor_name || !row.issue_date || !row.due_date || !row.amount_total) continue;
      const amount = Number(row.amount_total);
      state.vendorBills.push({
        id: makeId("bill"),
        company_id: MOCK_COMPANY_ID,
        vendor_name: row.vendor_name,
        issue_date: row.issue_date,
        due_date: row.due_date,
        amount_total: amount,
        open_amount: amount,
        original_currency: row.original_currency || "USD",
        status: (row.status || "Open") as MockVendorBill["status"],
        category: row.category || "Imported"
      });
      processed += 1;
    }
  }

  if (dataType === "invoices") {
    for (const row of rows) {
      if (!row.customer_name || !row.issue_date || !row.due_date || !row.amount_total) continue;
      let customer = state.customers.find((item) => item.name.toLowerCase() === row.customer_name.toLowerCase());
      if (!customer) {
        customer = {
          id: makeId("cust"),
          name: row.customer_name,
          email: undefined,
          country: "United States",
          region: "North America"
        };
        state.customers.push(customer);
      }

      const amount = Number(row.amount_total);
      const currency = row.original_currency || "USD";
      const amountBase = convertCurrency(amount, currency, "USD", row.issue_date, state);
      state.invoices.push({
        id: makeId("inv"),
        company_id: MOCK_COMPANY_ID,
        customer_id: customer.id,
        issue_date: row.issue_date,
        due_date: row.due_date,
        amount_total: amount,
        open_amount: row.status === "Paid" ? 0 : amountBase,
        amount_total_base: amountBase,
        original_amount: amount,
        original_currency: currency,
        status: (row.status || "Open") as MockInvoice["status"],
        channel: row.channel || "Direct",
        product_id: row.product_id || "Services",
        region: row.region || customer.region || "North America"
      });
      processed += 1;
    }
  }

  saveMockState(state);
  return { processed, rejected: Math.max(0, rows.length - processed) };
}

export function getCustomerName(state: MockFinanceState, customerId: string) {
  return state.customers.find((customer) => customer.id === customerId)?.name || "Unknown Customer";
}

export function getCustomer(state: MockFinanceState, customerId: string) {
  return state.customers.find((customer) => customer.id === customerId);
}

export function getRecentActivityData(state = getMockState()) {
  const invoiceActivity = state.invoices.map((invoice) => ({
    id: invoice.id,
    type: "invoice" as const,
    date: invoice.issue_date,
    amount: invoice.original_amount,
    currency: invoice.original_currency,
    status: invoice.status,
    customerName: getCustomerName(state, invoice.customer_id)
  }));

  const paymentActivity = state.payments.map((payment) => ({
    id: payment.id,
    type: "payment" as const,
    date: payment.date,
    amount: payment.original_amount,
    currency: payment.original_currency,
    status: payment.status,
    customerName: getCustomerName(state, payment.customer_id)
  }));

  return [...invoiceActivity, ...paymentActivity]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
}

export function calculateDSOValue(state = getMockState()) {
  const paidInvoices = state.invoices.filter((invoice) => invoice.status === "Paid" || invoice.status === "Partially Paid");
  if (paidInvoices.length === 0) {
    return null;
  }

  const days = paidInvoices.map((invoice) => {
    const payment = state.payments.find((item) => item.invoice_id === invoice.id);
    if (!payment) {
      return differenceInDays(parseISO(invoice.due_date), parseISO(invoice.issue_date));
    }
    return differenceInDays(parseISO(payment.date), parseISO(invoice.issue_date));
  });

  return Math.round(days.reduce((total, value) => total + value, 0) / days.length);
}
