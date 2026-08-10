import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getMockState, updateAccountingBasis } from "@/mock/mockFinance";

export interface AccountingSettings {
  id: string;
  company_id: string;
  basis: "accrual" | "cash";
  base_currency: string;
  timezone: string;
  allow_future_dates: boolean;
}

export function useAccountingSettings() {
  return useQuery({
    queryKey: ["accounting-settings"],
    queryFn: async () => getMockState().accountingSettings as AccountingSettings,
  });
}

export function useUpdateAccountingBasis() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (basis: "accrual" | "cash") => updateAccountingBasis(basis),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({
        title: "Accounting basis updated",
        description: "Mock financial data has been recalculated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update accounting basis",
        variant: "destructive",
      });
    },
  });
}
