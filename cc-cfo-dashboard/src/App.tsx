import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardLayout } from "./components/DashboardLayout";
import Index from "./pages/Index";
import Revenue from "./pages/Revenue";
import Expenses from "./pages/Expenses";
import Profitability from "./pages/Profitability";
import ProfitLoss from "./pages/ProfitLoss";
import BalanceSheet from "./pages/BalanceSheet";
import CashFlow from "./pages/CashFlow";
import Receivables from "./pages/Receivables";
import Reports from "./pages/Reports";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={
            <DashboardLayout>
              <Index />
            </DashboardLayout>
          } />
          <Route path="/revenue" element={
            <DashboardLayout>
              <Revenue />
            </DashboardLayout>
          } />
          <Route path="/expenses" element={
            <DashboardLayout>
              <Expenses />
            </DashboardLayout>
          } />
          <Route path="/profitability" element={
            <DashboardLayout>
              <Profitability />
            </DashboardLayout>
          } />
          <Route path="/profit-loss" element={
            <DashboardLayout>
              <ProfitLoss />
            </DashboardLayout>
          } />
          <Route path="/balance-sheet" element={
            <DashboardLayout>
              <BalanceSheet />
            </DashboardLayout>
          } />
          <Route path="/cash-flow" element={
            <DashboardLayout>
              <CashFlow />
            </DashboardLayout>
          } />
          <Route path="/receivables" element={
            <DashboardLayout>
              <Receivables />
            </DashboardLayout>
          } />
          <Route path="/reports" element={
            <DashboardLayout>
              <Reports />
            </DashboardLayout>
          } />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
