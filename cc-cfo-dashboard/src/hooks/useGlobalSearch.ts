import { useQuery } from "@tanstack/react-query";
import { getCustomerName, getMockState } from "@/mock/mockFinance";

export interface SearchResult {
  id: string;
  type: "invoice" | "payment" | "customer" | "contact";
  title: string;
  subtitle: string;
  amount?: number;
  status?: string;
  date?: string;
}

export const useGlobalSearch = (searchQuery: string) => {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["global-search", normalizedQuery],
    queryFn: async (): Promise<SearchResult[]> => {
      if (normalizedQuery.length < 2) {
        return [];
      }

      const state = getMockState();
      const matches: SearchResult[] = [];

      state.invoices.forEach((invoice) => {
        const customerName = getCustomerName(state, invoice.customer_id);
        if (
          customerName.toLowerCase().includes(normalizedQuery) ||
          invoice.status.toLowerCase().includes(normalizedQuery) ||
          invoice.product_id?.toLowerCase().includes(normalizedQuery) ||
          invoice.region?.toLowerCase().includes(normalizedQuery)
        ) {
          matches.push({
            id: invoice.id,
            type: "invoice",
            title: `Invoice - ${customerName}`,
            subtitle: `${invoice.status} • ${invoice.issue_date}`,
            amount: invoice.amount_total,
            status: invoice.status,
            date: invoice.issue_date,
          });
        }
      });

      state.customers.forEach((customer) => {
        if (
          customer.name.toLowerCase().includes(normalizedQuery) ||
          customer.email?.toLowerCase().includes(normalizedQuery)
        ) {
          matches.push({
            id: customer.id,
            type: "customer",
            title: customer.name,
            subtitle: customer.email || "Customer",
          });
        }
      });

      state.contacts.forEach((contact) => {
        if (
          contact.name.toLowerCase().includes(normalizedQuery) ||
          contact.email?.toLowerCase().includes(normalizedQuery) ||
          contact.phone?.toLowerCase().includes(normalizedQuery)
        ) {
          matches.push({
            id: contact.id,
            type: "contact",
            title: contact.name,
            subtitle: [contact.email, contact.phone].filter(Boolean).join(" • ") || "Contact",
          });
        }
      });

      state.payments.forEach((payment) => {
        const customerName = getCustomerName(state, payment.customer_id);
        if (
          payment.status.toLowerCase().includes(normalizedQuery) ||
          customerName.toLowerCase().includes(normalizedQuery)
        ) {
          matches.push({
            id: payment.id,
            type: "payment",
            title: `Payment - ${customerName}`,
            subtitle: `${payment.status} • ${payment.date}`,
            amount: payment.amount,
            status: payment.status,
            date: payment.date,
          });
        }
      });

      return matches.slice(0, 20);
    },
    enabled: normalizedQuery.length >= 2,
    staleTime: 30000,
  });

  return {
    results,
    isLoading,
  };
};
