import { useQuery } from "@tanstack/react-query";
import { differenceInDays } from "date-fns";
import { filterByDate, getCustomerName, getMockState } from "@/mock/mockFinance";
import { formatCurrency } from "./useFinancialData";

export interface ARAgingBucket {
  bucket: string;
  count: number;
  amount: number;
  percentage: number;
}

export function useARData(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["ar-data", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const state = getMockState();
      const invoices = filterByDate(state.invoices, (invoice) => invoice.issue_date, dateRange)
        .filter((invoice) => invoice.status === "Open" || invoice.status === "Overdue" || invoice.status === "Partial" || invoice.status === "Partially Paid");

      const buckets: Record<string, ARAgingBucket> = {
        current: { bucket: "Current (0-30 days)", count: 0, amount: 0, percentage: 0 },
        "30-60": { bucket: "30-60 days", count: 0, amount: 0, percentage: 0 },
        "60+": { bucket: "60+ days overdue", count: 0, amount: 0, percentage: 0 },
      };

      const today = new Date();
      const total = invoices.reduce((sum, invoice) => sum + Number(invoice.open_amount), 0);

      invoices.forEach((invoice) => {
        const daysOutstanding = Math.max(0, differenceInDays(today, new Date(`${invoice.due_date}T00:00:00`)));
        const amount = Number(invoice.open_amount);
        if (daysOutstanding > 60) {
          buckets["60+"].count += 1;
          buckets["60+"].amount += amount;
        } else if (daysOutstanding > 30) {
          buckets["30-60"].count += 1;
          buckets["30-60"].amount += amount;
        } else {
          buckets.current.count += 1;
          buckets.current.amount += amount;
        }
      });

      Object.values(buckets).forEach((bucket) => {
        bucket.percentage = total > 0 ? (bucket.amount / total) * 100 : 0;
      });

      return {
        total,
        buckets: Object.values(buckets),
        averageCollectionPeriod: invoices.length > 0
          ? invoices.reduce((sum, invoice) => sum + Math.max(0, differenceInDays(today, new Date(`${invoice.issue_date}T00:00:00`))), 0) / invoices.length
          : 0,
      };
    },
  });
}

export function useAPData(dateRange?: { from?: Date; to?: Date }) {
  return useQuery({
    queryKey: ["ap-data", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const bills = filterByDate(getMockState().vendorBills, (bill) => bill.issue_date, dateRange)
        .filter((bill) => bill.status !== "Paid");
      const today = new Date();

      const urgent = bills.filter((bill) => differenceInDays(new Date(`${bill.due_date}T00:00:00`), today) <= 7);
      const current = bills.filter((bill) => {
        const days = differenceInDays(new Date(`${bill.due_date}T00:00:00`), today);
        return days > 7 && days <= 30;
      });
      const future = bills.filter((bill) => differenceInDays(new Date(`${bill.due_date}T00:00:00`), today) > 30);

      const total = bills.reduce((sum, bill) => sum + Number(bill.open_amount), 0);

      return {
        total,
        groups: [
          { name: "Due within 7 days", count: urgent.length, amount: urgent.reduce((sum, bill) => sum + bill.open_amount, 0), badge: "Urgent" },
          { name: "Due within 30 days", count: current.length, amount: current.reduce((sum, bill) => sum + bill.open_amount, 0), badge: "Current" },
          { name: "Due later", count: future.length, amount: future.reduce((sum, bill) => sum + bill.open_amount, 0), badge: "Future" },
        ],
      };
    },
  });
}

export function useDSO() {
  return useQuery({
    queryKey: ["dso"],
    queryFn: async () => {
      const state = getMockState();
      const paidInvoices = state.invoices.filter((invoice) => invoice.status === "Paid" || invoice.status === "Partially Paid");
      if (paidInvoices.length === 0) {
        return null;
      }
      const average = paidInvoices.reduce((sum, invoice) => {
        const payment = state.payments.find((item) => item.invoice_id === invoice.id);
        const endDate = payment ? new Date(`${payment.date}T00:00:00`) : new Date(`${invoice.due_date}T00:00:00`);
        return sum + differenceInDays(endDate, new Date(`${invoice.issue_date}T00:00:00`));
      }, 0);
      return Math.round(average / paidInvoices.length);
    },
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => {
      const state = getMockState();
      const activities = [
        ...state.invoices.map((invoice) => ({
          id: invoice.id,
          type: "invoice" as const,
          date: invoice.issue_date,
          amount: invoice.original_amount,
          currency: invoice.original_currency,
          status: invoice.status,
          customerName: getCustomerName(state, invoice.customer_id),
        })),
        ...state.payments.map((payment) => ({
          id: payment.id,
          type: "payment" as const,
          date: payment.date,
          amount: payment.original_amount,
          currency: payment.original_currency,
          status: payment.status,
          customerName: getCustomerName(state, payment.customer_id),
        })),
      ];

      return activities.sort((left, right) => right.date.localeCompare(left.date)).slice(0, 10);
    },
  });
}

export function useARDetailedData(
  dateRange?: { from?: Date; to?: Date },
  sortBy: string = "due_date_asc",
  page: number = 1,
  pageSize: number = 20
) {
  return useQuery({
    queryKey: ["ar-detailed", dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), sortBy, page, pageSize],
    queryFn: async () => {
      const state = getMockState();
      let invoices = filterByDate(state.invoices, (invoice) => invoice.issue_date, dateRange)
        .filter((invoice) => invoice.status === "Open" || invoice.status === "Partial" || invoice.status === "Overdue" || invoice.status === "Partially Paid");

      const today = new Date();
      const mapped = invoices.map((invoice) => {
        const daysOutstanding = Math.ceil((today.getTime() - new Date(`${invoice.due_date}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24));
        let agingBucket = "current";
        if (daysOutstanding > 60) agingBucket = "60+";
        else if (daysOutstanding > 30) agingBucket = "30-60";

        return {
          id: invoice.id,
          invoiceNumber: invoice.id.slice(0, 8),
          customer: getCustomerName(state, invoice.customer_id),
          issueDate: invoice.issue_date,
          dueDate: invoice.due_date,
          status: invoice.status,
          amount: invoice.open_amount,
          currency: invoice.original_currency || "USD",
          daysOutstanding,
          agingBucket,
        };
      });

      const sorted = [...mapped].sort((left, right) => {
        switch (sortBy) {
          case "due_date_desc":
            return right.dueDate.localeCompare(left.dueDate);
          case "issue_date_desc":
            return right.issueDate.localeCompare(left.issueDate);
          case "issue_date_asc":
            return left.issueDate.localeCompare(right.issueDate);
          case "amount_desc":
            return right.amount - left.amount;
          case "amount_asc":
            return left.amount - right.amount;
          case "due_date_asc":
          default:
            return left.dueDate.localeCompare(right.dueDate);
        }
      });

      const total = sorted.length;
      const from = (page - 1) * pageSize;
      const data = sorted.slice(from, from + pageSize);

      return {
        data,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  });
}

export function useAPDetailedData(dateRange?: { from?: Date; to?: Date }, sortBy: string = "due_date_asc") {
  return useQuery({
    queryKey: ["ap-detailed", dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), sortBy],
    queryFn: async () => {
      const today = new Date();
      const bills = filterByDate(getMockState().vendorBills, (bill) => bill.issue_date, dateRange)
        .filter((bill) => bill.status !== "Paid")
        .map((bill) => ({
          id: bill.id,
          billNumber: bill.id.slice(0, 8),
          vendor: bill.vendor_name,
          issueDate: bill.issue_date,
          dueDate: bill.due_date,
          status: bill.status,
          amount: bill.open_amount,
          currency: bill.original_currency || "USD",
          daysUntilDue: Math.ceil((new Date(`${bill.due_date}T00:00:00`).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          category: bill.category || null,
        }));

      return bills.sort((left, right) => {
        switch (sortBy) {
          case "due_date_desc":
            return right.dueDate.localeCompare(left.dueDate);
          case "issue_date_desc":
            return right.issueDate.localeCompare(left.issueDate);
          case "issue_date_asc":
            return left.issueDate.localeCompare(right.issueDate);
          case "amount_desc":
            return right.amount - left.amount;
          case "amount_asc":
            return left.amount - right.amount;
          case "due_date_asc":
          default:
            return left.dueDate.localeCompare(right.dueDate);
        }
      });
    },
  });
}

export { formatCurrency };
