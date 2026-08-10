import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteScheduledReport as removeScheduledReport, getMockState, upsertScheduledReport } from "@/mock/mockFinance";

export interface ScheduledReport {
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

export interface ScheduledReportInput {
  report_type: string;
  report_name: string;
  frequency: string;
  next_run_date: string;
  recipients: string[];
  format: string;
  is_active?: boolean;
}

export const useScheduledReports = () => {
  const queryClient = useQueryClient();

  const { data: scheduledReports, isLoading } = useQuery({
    queryKey: ["scheduled-reports"],
    queryFn: async () => getMockState().scheduledReports as ScheduledReport[],
  });

  const createScheduledReport = useMutation({
    mutationFn: async (input: ScheduledReportInput) => upsertScheduledReport(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] }),
  });

  const updateScheduledReport = useMutation({
    mutationFn: async ({ id, ...input }: Partial<ScheduledReportInput> & { id: string }) =>
      upsertScheduledReport({
        id,
        report_type: input.report_type || "custom",
        report_name: input.report_name || "Scheduled Report",
        frequency: input.frequency || "monthly",
        next_run_date: input.next_run_date || new Date().toISOString().slice(0, 10),
        recipients: input.recipients || [],
        format: input.format || "pdf",
        is_active: input.is_active,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] }),
  });

  const deleteScheduledReport = useMutation({
    mutationFn: async (id: string) => removeScheduledReport(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] }),
  });

  return {
    scheduledReports,
    isLoading,
    createScheduledReport,
    updateScheduledReport,
    deleteScheduledReport,
  };
};
