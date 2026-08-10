import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { FinancialSidebar } from "./FinancialSidebar";
import { NotificationPopover } from "./NotificationPopover";
import { SearchResults } from "./SearchResults";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, RotateCcw, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState, useRef } from "react";
import { useGlobalSearch, SearchResult } from "@/hooks/useGlobalSearch";
import { useNavigate } from "react-router-dom";
import { resetMockState } from "@/mock/mockFinance";
import { useQueryClient } from "@tanstack/react-query";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  
  const { results, isLoading } = useGlobalSearch(searchQuery);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowResults(value.trim().length >= 2);
  };

  const handleResultClick = (result: SearchResult) => {
    setShowResults(false);
    setSearchQuery("");

    // Navigate based on result type with specific item IDs
    switch (result.type) {
      case 'invoice':
        navigate(`/receivables?invoiceId=${result.id}`);
        break;
      case 'payment':
        navigate(`/receivables?paymentId=${result.id}`);
        break;
      case 'customer':
        navigate(`/receivables?customerId=${result.id}`);
        break;
      case 'contact':
        // Navigate to overview with contact highlighted
        toast({
          title: "Contact Found",
          description: `${result.title} - ${result.subtitle}`,
        });
        navigate('/');
        break;
    }
  };

  const handleResetDemo = async () => {
    resetMockState();
    await queryClient.invalidateQueries();
    setSearchQuery("");
    setShowResults(false);
    toast({
      title: "Mock data reset",
      description: "The dashboard has been reset to the seeded demo dataset.",
    });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <FinancialSidebar />
        
        <div className="flex-1 flex flex-col overflow-visible">
          {/* Header */}
          <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6 sticky top-0 z-50 overflow-visible">
            <div className="flex items-center gap-4 flex-1 overflow-visible relative">
              <SidebarTrigger className="lg:hidden" />
              
              {/* Search Bar */}
              <div className="relative flex-1 max-w-2xl z-50" ref={searchRef}>
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4 z-10" />
                <Input
                  placeholder="Search for transactions, accounts and anything else financial"
                  className="pl-10 bg-muted-50 border-none"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => searchQuery.trim().length >= 2 && setShowResults(true)}
                />
                {showResults && (
                  <SearchResults results={results} onResultClick={handleResultClick} />
                )}
                {isLoading && searchQuery.trim().length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-2 p-4 bg-card rounded-md shadow-2xl z-[9999] border border-border">
                    <p className="text-sm text-muted-foreground text-center">Searching...</p>
                  </div>
                )}
              </div>
              
            </div>
            
            <div className="flex items-center gap-3">
              {/* Notification Bell */}
              <NotificationPopover />

              <Badge variant="outline" className="hidden md:inline-flex">
                Mock Data
              </Badge>
              
              {/* Action Buttons */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    className="bg-secondary text-secondary-foreground hover:bg-secondary-hover-90"
                    onClick={() => {
                      toast({
                        title: "Coming Soon",
                        description: "QuickBooks connection will plug into this UI next.",
                      });
                    }}
                  >
                    <Wallet className="w-4 h-4 mr-2" />
                    Connect QuickBooks
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>QuickBooks wiring comes next</p>
                </TooltipContent>
              </Tooltip>
              
              {/* Reset Mock Data */}
              <Button 
                variant="outline" 
                onClick={handleResetDemo}
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Demo
              </Button>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6 bg-background overflow-auto relative z-0">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
