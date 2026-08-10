import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import { TrendingUp, TrendingDown, DollarSign, Banknote } from "lucide-react";
import { FilterHeader, FilterState } from "@/components/FilterHeader";
import { useQuery } from "@tanstack/react-query";
import { differenceInDays, format, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useCashFlowDrillDown } from "@/hooks/useCashFlowDrillDown";
import { CashFlowDataTable } from "@/components/CashFlowDataTable";
import { filterByDate, getFactsCashflowDaily, getMockState } from "@/mock/mockFinance";

const CashFlow = () => {
  const [filters, setFilters] = useState<FilterState>({
    dateRange: {},
    currency: "USD",
  });

  const { convertAmount, currencySymbol } = useCurrencyConversion(filters.currency);
  const { drillDownData, handlePeriodClick, clearDrillDown } = useCashFlowDrillDown();

  const formatWithCurrency = (amount: number) =>
    `${currencySymbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const { data: cashflowData } = useQuery({
    queryKey: ["cashflow-data", filters.dateRange?.from?.toISOString(), filters.dateRange?.to?.toISOString(), filters.currency],
    queryFn: async () => {
      const state = getMockState();
      const rows = filterByDate(getFactsCashflowDaily(state), (row) => row.date, filters.dateRange);

      const totals = rows.reduce(
        (accumulator, row) => ({
          inflow: accumulator.inflow + convertAmount(row.inflow, "USD", row.date),
          outflow: accumulator.outflow + convertAmount(row.outflow, "USD", row.date),
        }),
        { inflow: 0, outflow: 0 }
      );

      const dateRangeDays = filters.dateRange?.from && filters.dateRange?.to
        ? differenceInDays(filters.dateRange.to, filters.dateRange.from)
        : rows.length > 0
          ? differenceInDays(parseISO(rows[rows.length - 1].date), parseISO(rows[0].date))
          : 0;

      const useDailyGranularity = dateRangeDays <= 30;
      const aggregated = rows.reduce<Record<string, { period: string; dateKey: string; inflow: number; outflow: number; net: number }>>(
        (accumulator, row) => {
          const parsedDate = parseISO(row.date);
          const period = useDailyGranularity ? format(parsedDate, "MMM dd") : format(parsedDate, "MMM yyyy");
          const dateKey = useDailyGranularity ? format(parsedDate, "yyyy-MM-dd") : format(parsedDate, "yyyy-MM");
          if (!accumulator[period]) {
            accumulator[period] = { period, dateKey, inflow: 0, outflow: 0, net: 0 };
          }
          const convertedInflow = convertAmount(row.inflow, "USD", row.date);
          const convertedOutflow = convertAmount(row.outflow, "USD", row.date);
          accumulator[period].inflow += convertedInflow;
          accumulator[period].outflow += convertedOutflow;
          accumulator[period].net += convertedInflow - convertedOutflow;
          return accumulator;
        },
        {}
      );

      return {
        totals,
        chartData: Object.values(aggregated).sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
      };
    },
  });

  const { data: accountsData } = useQuery({
    queryKey: ["accounts-balance", filters.currency],
    queryFn: async () =>
      getMockState().accounts.reduce(
        (sum, account) => sum + convertAmount(account.balance, account.currency || "USD"),
        0
      ),
  });

  const { data: forecastData, isLoading: isForecastLoading } = useQuery({
    queryKey: ["cashflow-forecast", cashflowData?.chartData],
    queryFn: async () => {
      if (!cashflowData?.chartData || cashflowData.chartData.length === 0) {
        return null;
      }

      const monthlyRows = [...cashflowData.chartData].slice(-3);
      const averageInflow = monthlyRows.reduce((sum, row) => sum + row.inflow, 0) / monthlyRows.length;
      const averageOutflow = monthlyRows.reduce((sum, row) => sum + row.outflow, 0) / monthlyRows.length;
      const seedDate = monthlyRows[monthlyRows.length - 1]?.dateKey || format(new Date(), "yyyy-MM");
      const baseDate = new Date(`${seedDate.length === 7 ? `${seedDate}-01` : seedDate}T00:00:00`);

      return Array.from({ length: 12 }, (_, index) => {
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + index + 1, 1);
        const inflow = averageInflow * (1 + index * 0.01);
        const outflow = averageOutflow * (1 + index * 0.008);
        return {
          period: format(date, "MMM yyyy"),
          inflow,
          outflow,
          net: inflow - outflow,
        };
      });
    },
    enabled: !!cashflowData?.chartData && cashflowData.chartData.length > 0,
  });

  const netCashFlow = (cashflowData?.totals.inflow || 0) - (cashflowData?.totals.outflow || 0);
  const totalOutflow = cashflowData?.totals.outflow || 0;

  let dateRangeDays = 30;
  if (filters.dateRange?.from && filters.dateRange?.to) {
    dateRangeDays = differenceInDays(filters.dateRange.to, filters.dateRange.from);
  } else if (cashflowData?.chartData && cashflowData.chartData.length > 0) {
    const firstDate = cashflowData.chartData[0].dateKey;
    const lastDate = cashflowData.chartData[cashflowData.chartData.length - 1].dateKey;
    if (firstDate && lastDate) {
      const normalizedFirst = firstDate.length === 7 ? `${firstDate}-01` : firstDate;
      const normalizedLast = lastDate.length === 7 ? `${lastDate}-01` : lastDate;
      dateRangeDays = differenceInDays(parseISO(normalizedLast), parseISO(normalizedFirst));
    }
  }

  const monthlyBurnRate = dateRangeDays > 0 ? (totalOutflow / dateRangeDays) * 30 : 0;
  const cashBalance = accountsData || 0;
  const freeCashFlow = netCashFlow;
  const hasData = (cashflowData?.totals.inflow || 0) > 0 || (cashflowData?.totals.outflow || 0) > 0;
  const runwayMonths = monthlyBurnRate > 0 && cashBalance > 0 ? cashBalance / monthlyBurnRate : 0;

  return (
    <div className="space-y-0">
      <FilterHeader filters={filters} onFiltersChange={setFilters} showFxCurrency={true} />

      <div className="space-y-6 p-4">
        <div>
          <h1 className="text-3xl tracking-tight">Cash Flow Management</h1>
          <p className="text-muted-foreground">
            Monitor cash inflows and outflows to maintain healthy liquidity
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Operating Cash Flow"
            value={formatWithCurrency(netCashFlow)}
            changeType="positive"
            hasData={hasData}
            icon={<TrendingUp className="w-5 h-5" />}
          />
          <MetricCard
            title="Free Cash Flow"
            value={formatWithCurrency(freeCashFlow)}
            changeType="positive"
            hasData={hasData}
            icon={<DollarSign className="w-5 h-5" />}
          />
          <MetricCard
            title="Cash Balance"
            value={formatWithCurrency(cashBalance)}
            changeType="positive"
            hasData={cashBalance > 0}
            icon={<Banknote className="w-5 h-5" />}
          />
          <MetricCard
            title="Monthly Burn Rate"
            value={formatWithCurrency(monthlyBurnRate)}
            changeType="negative"
            hasData={hasData}
            icon={<TrendingDown className="w-5 h-5" />}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <h3 className="text-lg mb-4">Cash Flow Summary</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Cash Inflows</span>
                <span className="font-medium text-green-600">+{formatWithCurrency(cashflowData?.totals.inflow || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Cash Outflows</span>
                <span className="font-medium text-red-600">-{formatWithCurrency(cashflowData?.totals.outflow || 0)}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-sm font-medium">Net Cash Flow</span>
                <span className={`font-semibold ${netCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {netCashFlow >= 0 ? "+" : ""}{formatWithCurrency(netCashFlow)}
                </span>
              </div>
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Cash Runway</div>
                <div className="font-semibold">{runwayMonths > 0 ? `${runwayMonths.toFixed(1)} months` : "N/A"}</div>
                <div className="text-xs text-green-600">
                  {runwayMonths > 0
                    ? "Based on monthly burn rate"
                    : cashBalance === 0
                      ? "Add cash balance to accounts to see runway"
                      : "Add outflow data to calculate burn rate"}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg mb-4">Monthly Cash Flow Trends</h3>
            {hasData && cashflowData?.chartData && cashflowData.chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={cashflowData.chartData}
                  onClick={(data) => {
                    if (data && data.activePayload && data.activePayload[0]) {
                      const payload = data.activePayload[0].payload;
                      handlePeriodClick(payload.period, payload.dateKey);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis
                    tickFormatter={(value) => {
                      const converted = convertAmount(value, "USD");
                      if (converted >= 1000000) return `${currencySymbol}${(converted / 1000000).toFixed(1)}M`;
                      if (converted >= 1000) return `${currencySymbol}${(converted / 1000).toFixed(0)}K`;
                      return `${currencySymbol}${converted.toFixed(0)}`;
                    }}
                  />
                  <Tooltip formatter={(value) => formatWithCurrency(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="inflow" stroke="#10b981" name="Inflows" strokeWidth={2} activeDot={{ cursor: "pointer", r: 6 }} />
                  <Line type="monotone" dataKey="outflow" stroke="#ef4444" name="Outflows" strokeWidth={2} activeDot={{ cursor: "pointer", r: 6 }} />
                  <Line type="monotone" dataKey="net" stroke="#3b82f6" name="Net Cash Flow" strokeWidth={2} activeDot={{ cursor: "pointer", r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center py-8">
                <span className="inline-flex items-center justify-center rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground">No Data</span>
              </div>
            )}
          </Card>
        </div>

        {drillDownData && (
          <CashFlowDataTable drillDownData={drillDownData} onClose={clearDrillDown} formatCurrency={formatWithCurrency} />
        )}

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-lg">12-Month Cash Flow Forecast</h3>
            <Badge variant="secondary" className="bg-secondary-light text-secondary hover:bg-secondary-light-20">
              Mock Forecast
            </Badge>
          </div>
          {isForecastLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="inline-flex items-center justify-center rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground">Generating forecast...</span>
            </div>
          ) : forecastData && forecastData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={forecastData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip formatter={(value) => formatWithCurrency(Number(value))} />
                <Legend />
                <Line type="monotone" dataKey="inflow" stroke="#10b981" name="Projected Inflows" strokeWidth={2} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="outflow" stroke="#ef4444" name="Projected Outflows" strokeWidth={2} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" name="Projected Net" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center py-8">
              <span className="inline-flex items-center justify-center rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground">
                {hasData ? "Unable to generate forecast" : "Add cash flow data to see forecast"}
              </span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default CashFlow;
