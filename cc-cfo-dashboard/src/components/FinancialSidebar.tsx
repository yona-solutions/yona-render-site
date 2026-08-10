import { useLocation, NavLink } from "react-router-dom";
import { LayoutDashboard, TrendingUp, Receipt, CircleDollarSign, FileText, Activity, CreditCard, FileBarChart, BarChart3 } from "@/components/icons";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuickBooksConnectionStatus } from "@/hooks/useQuickBooksConnectionStatus";
import { CheckCircle2, Link2Off } from "lucide-react";
import cureCompanyLogo from "@/assets/cure-company-logo.png";
const mainNavItems = [{
  title: "Overview",
  url: "/",
  icon: LayoutDashboard
}, {
  title: "Revenue",
  url: "/revenue",
  icon: TrendingUp
}, {
  title: "Expenses",
  url: "/expenses",
  icon: Receipt
}, {
  title: "Profitability",
  url: "/profitability",
  icon: CircleDollarSign
}, {
  title: "P&L Statement",
  url: "/profit-loss",
  icon: FileBarChart
}, {
  title: "Balance Sheet",
  url: "/balance-sheet",
  icon: BarChart3
}, {
  title: "Cash Flow",
  url: "/cash-flow",
  icon: Activity
}, {
  title: "Receivable & Payable",
  url: "/receivables",
  icon: CreditCard
}, {
  title: "Reports & Export",
  url: "/reports",
  icon: FileText
}];
export function FinancialSidebar() {
  const {
    state
  } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const { data: quickBooksStatus } = useQuickBooksConnectionStatus();
  const collapsed = state === "collapsed";
  const isQuickBooksConnected = Boolean(quickBooksStatus?.connection.connected);
  const quickBooksAccountName =
    quickBooksStatus?.connection.displayName ||
    quickBooksStatus?.connection.companyName ||
    "QuickBooks not connected";
  const isActive = (path: string) => {
    if (path === "/") return currentPath === "/";
    return currentPath.startsWith(path);
  };
  const getNavClasses = (path: string) => {
    const active = isActive(path);
    return `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${active ? "bg-primary-light text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`;
  };
  const getIconClasses = (path: string) => {
    const active = isActive(path);
    const size = "w-5 h-5";
    return `${size} flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`;
  };
  return <Sidebar className={`${collapsed ? "w-16" : "w-64"} border-r border-sidebar-border bg-sidebar transition-all duration-300`}>
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-sidebar-border">
            <img src={cureCompanyLogo} alt="The Cure Company logo" className="h-full w-full object-cover" />
          </div>
          {!collapsed && <div>
              <h2 className="text-sm font-semibold leading-tight text-sidebar-foreground">The Cure Company</h2>
              <p className="text-xs text-muted-foreground">Financial Dashboard</p>
            </div>}
        </div>
      </div>

      <SidebarContent className="px-4 py-6">
        <SidebarGroup>
          <SidebarGroupLabel className={`text-xs font-medium text-muted-foreground mb-3 ${collapsed ? "hidden" : ""}`}>
            MAIN NAVIGATION
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {mainNavItems.map(item => <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} className={getNavClasses(item.url)}>
                      <item.icon className={getIconClasses(item.url)} />
                      {!collapsed && <span className="font-medium">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-4 py-4">
        {!collapsed ? (
          <div className="rounded-xl border border-sidebar-border bg-card/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">QuickBooks</div>
                <div className="mt-1 truncate text-sm font-medium text-sidebar-foreground">{quickBooksAccountName}</div>
              </div>
              <Badge
                variant={isQuickBooksConnected ? "outline" : "secondary"}
                className={`${isQuickBooksConnected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""} gap-1 px-2 py-0.5 text-[11px]`}
              >
                {isQuickBooksConnected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
                {isQuickBooksConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {quickBooksStatus?.connection.realmId ? `Realm ID: ${quickBooksStatus.connection.realmId}` : "Connect QuickBooks to use live accounting data."}
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <Badge
              variant={isQuickBooksConnected ? "outline" : "secondary"}
              className={`${isQuickBooksConnected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""} p-1.5`}
            >
              {isQuickBooksConnected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
            </Badge>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>;
}
