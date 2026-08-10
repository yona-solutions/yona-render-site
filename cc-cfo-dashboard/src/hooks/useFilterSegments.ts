import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { deleteSegment, getMockState, upsertSegment } from "@/mock/mockFinance";

export type SegmentType = "project" | "department" | "product" | "region";

export interface FilterSegment {
  id: string;
  company_id: string;
  segment_type: SegmentType;
  segment_value: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FilterSegmentInput {
  segment_type: SegmentType;
  segment_value: string;
  is_active?: boolean;
}

export function useFilterSegments(segmentType?: SegmentType) {
  const queryClient = useQueryClient();

  const { data: segments = [], isLoading, error } = useQuery({
    queryKey: ["filter-segments", segmentType],
    queryFn: async () => {
      const allSegments = getMockState().filterSegments.filter((segment) => segment.is_active);
      return (segmentType
        ? allSegments.filter((segment) => segment.segment_type === segmentType)
        : allSegments) as FilterSegment[];
    },
  });

  const createSegment = useMutation({
    mutationFn: async (input: FilterSegmentInput) => upsertSegment(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filter-segments"] });
      toast({
        title: "Segment created",
        description: "The filter segment has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating segment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSegment = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<FilterSegmentInput> }) =>
      upsertSegment({ id, segment_type: input.segment_type as SegmentType, segment_value: input.segment_value || "", is_active: input.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filter-segments"] });
      toast({
        title: "Segment updated",
        description: "The filter segment has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating segment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeSegment = useMutation({
    mutationFn: async (id: string) => deleteSegment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filter-segments"] });
      toast({
        title: "Segment deleted",
        description: "The filter segment has been removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting segment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    segments,
    isLoading,
    error,
    createSegment: createSegment.mutate,
    updateSegment: updateSegment.mutate,
    deleteSegment: removeSegment.mutate,
    isCreating: createSegment.isPending,
    isUpdating: updateSegment.isPending,
    isDeleting: removeSegment.isPending,
  };
}

export function useSegmentValuesByType() {
  const { segments } = useFilterSegments();

  const getSegmentValues = (type: SegmentType): string[] =>
    segments.filter((segment) => segment.segment_type === type).map((segment) => segment.segment_value);

  return {
    projects: getSegmentValues("project"),
    departments: getSegmentValues("department"),
    products: getSegmentValues("product"),
    regions: getSegmentValues("region"),
  };
}
