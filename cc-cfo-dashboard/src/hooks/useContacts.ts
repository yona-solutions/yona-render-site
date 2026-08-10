import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { deleteContact as removeContact, getMockState, upsertContact } from "@/mock/mockFinance";

export interface Contact {
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

export interface ContactInput {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  avatar_color?: string;
}

export function useContacts() {
  const queryClient = useQueryClient();

  const { data: contacts = [], isLoading, error } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => getMockState().contacts as Contact[],
  });

  const createContact = useMutation({
    mutationFn: async (input: ContactInput) => upsertContact(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Contact created",
        description: "The contact has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating contact",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateContact = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ContactInput }) => upsertContact({ id, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Contact updated",
        description: "The contact has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating contact",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => removeContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Contact deleted",
        description: "The contact has been removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting contact",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    contacts,
    isLoading,
    error,
    createContact: createContact.mutate,
    updateContact: updateContact.mutate,
    deleteContact: deleteContact.mutate,
    isCreating: createContact.isPending,
    isUpdating: updateContact.isPending,
    isDeleting: deleteContact.isPending,
  };
}
