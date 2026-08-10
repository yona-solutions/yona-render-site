import { useQuery } from "@tanstack/react-query";
import { convertCurrency, getFxRateLookup, getMockState } from "@/mock/mockFinance";
import { getCurrencySymbol } from "@/lib/currencySymbols";

export const useCurrencyConversion = (currency: string = "USD") => {
  const { data: fxLookup } = useQuery({
    queryKey: ["all-fx-rates-with-dates"],
    queryFn: async () => getFxRateLookup(getMockState()),
  });

  const { data: fxRate } = useQuery({
    queryKey: ["fx-rate", currency],
    queryFn: async () => {
      if (currency === "USD") {
        return { rate_to_base: 1, currency: "USD" };
      }

      const state = getMockState();
      const matching = state.fxRates
        .filter((rate) => rate.currency === currency)
        .sort((left, right) => right.date.localeCompare(left.date));

      const latest = matching[0];
      return latest ? { rate_to_base: latest.rate_to_base, currency: latest.currency } : { rate_to_base: 1, currency };
    },
    enabled: !!currency,
  });

  const convertAmount = (amount: number, fromCurrency: string = "USD", transactionDate?: string) =>
    convertCurrency(amount, fromCurrency, currency, transactionDate, getMockState());

  return {
    fxRate,
    allFxRatesData: fxLookup,
    convertAmount,
    currencySymbol: getCurrencySymbol(currency),
    isLoading: !fxRate,
  };
};
