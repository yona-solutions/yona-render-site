import http from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

const ROOT_DIR = process.cwd();
const PORT = Number(process.env.QUICKBOOKS_API_PORT || 8787);
const QB_ENV_FILE = path.join(ROOT_DIR, ".env.quickbooks.local");
const FALLBACK_ENV_FILE = path.join(ROOT_DIR, ".env");
const QB_BASE_URL = "https://sandbox-quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const REPORT_MINOR_VERSION = "75";
const DEFAULT_COMPANY_NAME = "Cure Company";
const APP_URL = process.env.QUICKBOOKS_APP_URL || "http://127.0.0.1:4173/profit-loss";

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "row";
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function loadConfig() {
  const env = {
    ...parseEnvFile(FALLBACK_ENV_FILE),
    ...parseEnvFile(QB_ENV_FILE),
    ...process.env,
  };

  return {
    clientId: env.QUICKBOOKS_CLIENT_ID || "",
    clientSecret: env.QUICKBOOKS_CLIENT_SECRET || "",
    redirectUri: env.QUICKBOOKS_REDIRECT_URI || "",
    realmId: env.QUICKBOOKS_REALM_ID || "",
    authCode: env.QUICKBOOKS_AUTH_CODE || "",
    refreshToken: env.QUICKBOOKS_REFRESH_TOKEN || "",
    accessToken: env.QUICKBOOKS_ACCESS_TOKEN || "",
    accessTokenExpiresAt: env.QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT || "",
  };
}

function saveQuickBooksEnv(updates) {
  const current = parseEnvFile(QB_ENV_FILE);
  const merged = { ...current };
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      delete merged[key];
      return;
    }
    merged[key] = value;
  });
  const lines = [
    "# Local QuickBooks sandbox credentials and tokens",
    ...Object.entries(merged)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${value}`),
    "",
  ];

  writeFileSync(QB_ENV_FILE, lines.join("\n"), "utf8");
}

function buildAuthorizationUrl(config) {
  if (!config.clientId || !config.redirectUri) {
    return "";
  }

  const url = new URL(QB_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("state", randomUUID());
  return url.toString();
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  response.end();
}

function html(response, statusCode, markup) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(markup);
}

function buildConnectionState(config, overrides = {}) {
  return {
    connected: false,
    mode: "sandbox",
    companyName: overrides.companyName,
    realmId: config.realmId || undefined,
    authorizationUrl: buildAuthorizationUrl(config) || undefined,
    ...overrides,
  };
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function isAccessTokenFresh(expiresAt) {
  if (!expiresAt) {
    return false;
  }
  const expirationTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expirationTime)) {
    return false;
  }
  return expirationTime - Date.now() > 90_000;
}

function buildBasicAuthHeader(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function requestTokens(config, body) {
  const response = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: buildBasicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function persistTokenPayload(payload) {
  const expiresAt = payload.expires_in
    ? new Date(Date.now() + Math.max(payload.expires_in - 120, 60) * 1000).toISOString()
    : undefined;

  saveQuickBooksEnv({
    QUICKBOOKS_ACCESS_TOKEN: payload.access_token,
    QUICKBOOKS_REFRESH_TOKEN: payload.refresh_token,
    QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT: expiresAt,
    QUICKBOOKS_AUTH_CODE: null,
  });
}

async function exchangeAuthorizationCode(config) {
  const { response, payload } = await requestTokens(config, {
    grant_type: "authorization_code",
    code: config.authCode,
    redirect_uri: config.redirectUri,
  });

  if (!response.ok || !payload.access_token) {
    const description = payload.error_description || payload.error || "QuickBooks rejected the authorization code.";
    return {
      accessToken: null,
      connection: buildConnectionState(config, {
        needsAuthorization: true,
        message: "QuickBooks needs a fresh authorization grant before live data can load.",
        lastError: description,
      }),
    };
  }

  persistTokenPayload(payload);
  return {
    accessToken: payload.access_token,
    connection: buildConnectionState(config, { connected: true }),
  };
}

async function refreshAccessToken(config) {
  const { response, payload } = await requestTokens(config, {
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
  });

  if (!response.ok || !payload.access_token) {
    const description = payload.error_description || payload.error || "QuickBooks rejected the refresh token.";
    return {
      accessToken: null,
      connection: buildConnectionState(config, {
        needsAuthorization: true,
        message: "QuickBooks needs to be reconnected before live data can load.",
        lastError: description,
      }),
    };
  }

  persistTokenPayload(payload);
  return {
    accessToken: payload.access_token,
    connection: buildConnectionState(config, { connected: true }),
  };
}

async function ensureAccessToken(config) {
  if (!config.clientId || !config.clientSecret || !config.redirectUri || !config.realmId) {
    return {
      accessToken: null,
      connection: buildConnectionState(config, {
        needsAuthorization: true,
        message: "QuickBooks credentials are incomplete. Add the client ID, secret, redirect URI, and realm ID.",
      }),
    };
  }

  if (config.accessToken && isAccessTokenFresh(config.accessTokenExpiresAt)) {
    return {
      accessToken: config.accessToken,
      connection: buildConnectionState(config, { connected: true }),
    };
  }

  if (config.refreshToken) {
    return refreshAccessToken(config);
  }

  if (config.authCode) {
    return exchangeAuthorizationCode(config);
  }

  return {
    accessToken: null,
    connection: buildConnectionState(config, {
      needsAuthorization: true,
      message: "QuickBooks has not been authorized yet. Open the authorization URL, approve access, and store the new code or refresh token locally.",
    }),
  };
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = raw
    .replace(/[$,]/g, "")
    .replace(/\((.*)\)/, "-$1")
    .replace(/\s+/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function getLabelFromColData(colData) {
  const label = toArray(colData)
    .map((item) => item?.value)
    .find((value) => value !== undefined && value !== null && String(value).trim() !== "");
  return label ? String(label).trim() : "";
}

function getAmountFromColData(colData) {
  const values = toArray(colData)
    .map((item) => item?.value)
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const parsed = parseMoney(values[index]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function getRowLabel(row) {
  return (
    getLabelFromColData(row?.Header?.ColData) ||
    getLabelFromColData(row?.ColData) ||
    getLabelFromColData(row?.Summary?.ColData) ||
    ""
  );
}

function getRowAmount(row) {
  return (
    getAmountFromColData(row?.ColData) ??
    getAmountFromColData(row?.Summary?.ColData) ??
    getAmountFromColData(row?.Header?.ColData)
  );
}

function getSummaryAmount(row) {
  return getAmountFromColData(row?.Summary?.ColData);
}

function getAmountSeriesFromColData(colData) {
  const values = toArray(colData).slice(1).map((item) => parseMoney(item?.value));
  if (!values.length) {
    return null;
  }
  return values;
}

function getRowAmountSeries(row) {
  return (
    getAmountSeriesFromColData(row?.Summary?.ColData) ||
    getAmountSeriesFromColData(row?.ColData) ||
    getAmountSeriesFromColData(row?.Header?.ColData)
  );
}

function normalizeProfitLossLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

function mapProfitLossSection(label) {
  const normalized = normalizeProfitLossLabel(label);
  if (!normalized) {
    return null;
  }

  if (normalized === "income" || normalized === "revenue" || normalized === "sales") {
    return "Revenue";
  }

  if (normalized === "cost of goods sold" || normalized === "cost of sales") {
    return "Cost of Goods Sold";
  }

  if (normalized === "expenses" || normalized === "operating expenses") {
    return "Operating Expenses";
  }

  if (normalized === "other expense" || normalized === "other expenses") {
    return "Other Expenses";
  }

  if (normalized === "other income") {
    return "Other Income";
  }

  return null;
}

function sectionDisplayName(section) {
  return section === "Revenue" ? "Income" : section;
}

function buildProfitLossMatrixMergeKey(row) {
  return [row.section || "", row.depth || 0, row.rowType || "", row.parentLabel || "", row.label || ""].join("|");
}

function buildStatementOptions() {
  const currentYear = new Date().getFullYear();
  return {
    years: Array.from({ length: 5 }, (_, index) => currentYear - index),
    regions: [],
    products: [],
    channels: [],
    departments: [],
    expenseCategories: [],
  };
}

async function fetchQuickBooksCompanyInfo(config, accessToken, allowRetry = true) {
  const url = new URL(`${QB_BASE_URL}/v3/company/${config.realmId}/companyinfo/${config.realmId}`);
  url.searchParams.set("minorversion", REPORT_MINOR_VERSION);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401 && allowRetry) {
    const refreshed = await refreshAccessToken(loadConfig());
    if (refreshed.accessToken) {
      return fetchQuickBooksCompanyInfo(loadConfig(), refreshed.accessToken, false);
    }
    throw new Error(refreshed.connection.lastError || "QuickBooks authentication failed.");
  }

  if (!response.ok) {
    const detail = payload?.Fault?.Error?.[0]?.Detail || payload?.Fault?.Error?.[0]?.Message || payload?.message || response.statusText;
    throw new Error(detail || `QuickBooks company info request failed with status ${response.status}.`);
  }

  return payload?.CompanyInfo || null;
}

function formatApiDate(value) {
  if (!value) {
    return "";
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return String(value);
  }

  return `${match[2]}/${match[3]}/${match[1]}`;
}

function columnIndex(columns, names) {
  return columns.findIndex((column) => names.includes(column.toLowerCase()));
}

function getColumnValue(colData, index) {
  if (index < 0) {
    return "";
  }
  return String(toArray(colData)[index]?.value || "").trim();
}

function inferSummaryTotals(summaryRows) {
  const totals = {
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    operatingIncome: 0,
    netIncome: 0,
    grossMargin: 0,
    netMargin: 0,
  };

  summaryRows.forEach((row) => {
    const lower = row.label.toLowerCase();
    if (row.id === "revenue-total") {
      totals.revenue = row.amount || 0;
    } else if (row.id === "cogs-total") {
      totals.cogs = row.amount || 0;
    } else if (row.id === "opex-total") {
      totals.operatingExpenses = row.amount || 0;
    } else if (lower === "gross profit") {
      totals.grossProfit = row.amount || 0;
    } else if (lower === "operating income" || lower === "net operating income") {
      totals.operatingIncome = row.amount || 0;
    } else if (lower === "net income") {
      totals.netIncome = row.amount || 0;
    }
  });

  if (!totals.grossProfit) {
    totals.grossProfit = totals.revenue - totals.cogs;
  }
  if (!totals.operatingIncome) {
    totals.operatingIncome = totals.grossProfit - totals.operatingExpenses;
  }
  if (!totals.netIncome) {
    totals.netIncome = totals.operatingIncome;
  }
  totals.grossMargin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;
  totals.netMargin = totals.revenue > 0 ? (totals.netIncome / totals.revenue) * 100 : 0;
  return totals;
}

function parseSummaryReport(report) {
  const summaryRows = [];
  const statementRows = [];
  const topRows = toArray(report?.Rows?.Row);
  const companyName = report?.Header?.CompanyName || DEFAULT_COMPANY_NAME;
  let rowCounter = 0;

  function pushStatementRow(id, section, label, rowType, amount) {
    statementRows.push({
      id,
      section,
      label,
      rowType,
      amount,
      compareAmount: null,
      varianceAmount: null,
      variancePercent: null,
      percentOfRevenue: null,
    });
  }

  function walkNestedRows(rows, section, depth, parentLabel) {
    toArray(rows).forEach((row) => {
      const label = getRowLabel(row);
      const children = toArray(row?.Rows?.Row);
      const summaryAmount = getSummaryAmount(row);
      const baseAmount = getRowAmount(row);

      if (!label) {
        if (children.length) {
          walkNestedRows(children, section, depth, parentLabel);
        }
        return;
      }

      if (children.length) {
        const accountId = `${slugify(section)}-${slugify(label)}-${rowCounter += 1}`;
        summaryRows.push({
          id: accountId,
          label,
          amount: baseAmount,
          depth,
          rowType: "account",
          section,
          parentLabel,
        });
        pushStatementRow(accountId, section, label, "detail", baseAmount);
        walkNestedRows(children, section, depth + 1, label);

        if (summaryAmount !== null) {
          const subtotalId = `${accountId}-subtotal`;
          summaryRows.push({
            id: subtotalId,
            label: `Total for ${label}`,
            amount: summaryAmount,
            depth,
            rowType: "subtotal",
            section,
            parentLabel,
          });
          pushStatementRow(subtotalId, section, `Total for ${label}`, "subtotal", summaryAmount);
        }
        return;
      }

      const detailId = `${slugify(section)}-${slugify(label)}-${rowCounter += 1}`;
      summaryRows.push({
        id: detailId,
        label,
        amount: baseAmount,
        depth,
        rowType: "account",
        section,
        parentLabel,
      });
      pushStatementRow(detailId, section, label, "detail", baseAmount);
    });
  }

  topRows.forEach((row) => {
    const label = getRowLabel(row);
    const mappedSection = mapProfitLossSection(label);

    if (mappedSection) {
      const sectionId = `${slugify(mappedSection)}-section`;
      const sectionTotalId =
        mappedSection === "Revenue"
          ? "revenue-total"
          : mappedSection === "Cost of Goods Sold"
            ? "cogs-total"
            : mappedSection === "Operating Expenses"
              ? "opex-total"
              : `${slugify(mappedSection)}-total`;
      const sectionTotalLabel =
        mappedSection === "Revenue"
          ? "Total Revenue"
          : mappedSection === "Cost of Goods Sold"
            ? "Total Cost of Goods Sold"
            : mappedSection === "Operating Expenses"
              ? "Total Operating Expenses"
              : `Total ${sectionDisplayName(mappedSection)}`;
      const sectionChildren = toArray(row?.Rows?.Row);
      const sectionTotal = getSummaryAmount(row) ?? 0;

      summaryRows.push({
        id: sectionId,
        label: sectionDisplayName(mappedSection),
        amount: null,
        depth: 0,
        rowType: "section",
        section: mappedSection,
      });
      pushStatementRow(sectionId, mappedSection, sectionDisplayName(mappedSection), "section", null);
      walkNestedRows(sectionChildren, mappedSection, 1, sectionDisplayName(mappedSection));

      summaryRows.push({
        id: sectionTotalId,
        label: `Total for ${sectionDisplayName(mappedSection)}`,
        amount: sectionTotal,
        depth: 0,
        rowType: "subtotal",
        section: mappedSection,
      });
      pushStatementRow(sectionTotalId, mappedSection, sectionTotalLabel, "subtotal", sectionTotal);
      return;
    }

    const totalAmount = getRowAmount(row);
    if (totalAmount === null || !label) {
      return;
    }

    const lower = normalizeProfitLossLabel(label);
    let id = `${slugify(label)}-${rowCounter += 1}`;
    if (lower === "gross profit") {
      id = "gross-profit-total";
    } else if (lower === "operating income" || lower === "net operating income" || lower === "net ordinary income") {
      id = "operating-income-total";
    } else if (lower === "net other income") {
      id = "net-other-income-total";
    } else if (lower === "net income") {
      id = "net-income-total";
    }

    summaryRows.push({
      id,
      label,
      amount: totalAmount,
      depth: 0,
      rowType: "total",
      section: "Summary",
    });
    pushStatementRow(id, "Summary", label, "total", totalAmount);
  });

  const summary = inferSummaryTotals(summaryRows);

  return {
    companyName,
    summaryRows,
    statementRows,
    summary,
  };
}

function mapBalanceSheetSection(label) {
  const lower = String(label || "").toLowerCase();
  if (!lower) {
    return null;
  }

  if (lower.includes("asset")) {
    return "Assets";
  }

  if (lower.includes("liabilities and equity")) {
    return "Liabilities & Equity";
  }

  return null;
}

function parseBalanceSheetReport(report) {
  const rows = [];
  const topRows = toArray(report?.Rows?.Row);
  const companyName = report?.Header?.CompanyName || DEFAULT_COMPANY_NAME;
  let rowCounter = 0;

  function walkNestedRows(nestedRows, section, depth, parentLabel) {
    toArray(nestedRows).forEach((row) => {
      const label = getRowLabel(row);
      const children = toArray(row?.Rows?.Row);
      const summaryAmount = getSummaryAmount(row);
      const baseAmount = getRowAmount(row);

      if (!label) {
        if (children.length) {
          walkNestedRows(children, section, depth, parentLabel);
        }
        return;
      }

      if (children.length) {
        const accountId = `${slugify(section)}-${slugify(label)}-${rowCounter += 1}`;
        rows.push({
          id: accountId,
          label,
          amount: baseAmount,
          depth,
          rowType: "account",
          section,
          parentLabel,
        });
        walkNestedRows(children, section, depth + 1, label);

        if (summaryAmount !== null) {
          rows.push({
            id: `${accountId}-subtotal`,
            label: `Total for ${label}`,
            amount: summaryAmount,
            depth,
            rowType: "subtotal",
            section,
            parentLabel,
          });
        }
        return;
      }

      rows.push({
        id: `${slugify(section)}-${slugify(label)}-${rowCounter += 1}`,
        label,
        amount: baseAmount,
        depth,
        rowType: "account",
        section,
        parentLabel,
      });
    });
  }

  topRows.forEach((row) => {
    const label = getRowLabel(row);
    const section = mapBalanceSheetSection(label);
    if (!section) {
      return;
    }

    rows.push({
      id: `${slugify(section)}-section`,
      label: section,
      amount: null,
      depth: 0,
      rowType: "section",
      section,
    });

    walkNestedRows(row?.Rows?.Row, section, 1, section);

    const summaryAmount = getSummaryAmount(row);
    if (summaryAmount !== null) {
      const summaryLabel = getLabelFromColData(row?.Summary?.ColData) || `Total ${section}`;
      rows.push({
        id: `${slugify(section)}-total`,
        label: summaryLabel,
        amount: summaryAmount,
        depth: 0,
        rowType: "total",
        section: "Summary",
      });
    }
  });

  return {
    companyName,
    rows,
  };
}

function parseSummaryMatrixReport(report) {
  const companyName = report?.Header?.CompanyName || DEFAULT_COMPANY_NAME;
  const columns = toArray(report?.Columns?.Column)
    .slice(1)
    .map((column, index, allColumns) => ({
      id: `column-${index + 1}`,
      label: String(column?.ColTitle || "").trim() || `Period ${index + 1}`,
      isTotal: index === allColumns.length - 1,
    }));
  const rows = [];
  const topRows = toArray(report?.Rows?.Row);
  let rowCounter = 0;

  function emptySeries() {
    return Array.from({ length: columns.length }, () => null);
  }

  function walkNestedRows(nestedRows, section, depth, parentLabel) {
    toArray(nestedRows).forEach((row) => {
      const label = getRowLabel(row);
      const children = toArray(row?.Rows?.Row);
      const amountSeries = getRowAmountSeries(row);
      const summarySeries = getAmountSeriesFromColData(row?.Summary?.ColData);

      if (!label) {
        if (children.length) {
          walkNestedRows(children, section, depth, parentLabel);
        }
        return;
      }

      if (children.length) {
        const accountId = `${slugify(section)}-${slugify(label)}-${rowCounter += 1}`;
        rows.push({
          id: accountId,
          label,
          depth,
          rowType: "account",
          section,
          parentLabel,
          values: summarySeries || amountSeries || emptySeries(),
        });
        walkNestedRows(children, section, depth + 1, label);

        if (summarySeries) {
          rows.push({
            id: `${accountId}-subtotal`,
            label: `Total for ${label}`,
            depth,
            rowType: "subtotal",
            section,
            parentLabel,
            values: summarySeries,
          });
        }
        return;
      }

      rows.push({
        id: `${slugify(section)}-${slugify(label)}-${rowCounter += 1}`,
        label,
        depth,
        rowType: "account",
        section,
        parentLabel,
        values: amountSeries || emptySeries(),
      });
    });
  }

  topRows.forEach((row) => {
    const label = getRowLabel(row);
    const mappedSection = mapProfitLossSection(label);

    if (mappedSection) {
      const sectionTotalId =
        mappedSection === "Revenue"
          ? "revenue-total"
          : mappedSection === "Cost of Goods Sold"
            ? "cogs-total"
            : mappedSection === "Operating Expenses"
              ? "opex-total"
              : `${slugify(mappedSection)}-total`;
      const sectionTotalSeries = getAmountSeriesFromColData(row?.Summary?.ColData) || emptySeries();

      rows.push({
        id: `${slugify(mappedSection)}-section`,
        label: sectionDisplayName(mappedSection),
        depth: 0,
        rowType: "section",
        section: mappedSection,
        values: emptySeries(),
      });
      walkNestedRows(row?.Rows?.Row, mappedSection, 1, sectionDisplayName(mappedSection));
      rows.push({
        id: sectionTotalId,
        label:
          mappedSection === "Revenue"
            ? "Total for Income"
            : mappedSection === "Cost of Goods Sold"
              ? "Total for Cost of Goods Sold"
              : mappedSection === "Operating Expenses"
                ? "Total for Operating Expenses"
                : `Total for ${sectionDisplayName(mappedSection)}`,
        depth: 0,
        rowType: "subtotal",
        section: mappedSection,
        values: sectionTotalSeries,
      });
      return;
    }

    const amountSeries = getRowAmountSeries(row);
    if (!amountSeries || !label) {
      return;
    }

    const lower = normalizeProfitLossLabel(label);
    let id = `${slugify(label)}-${rowCounter += 1}`;
    if (lower === "gross profit") {
      id = "gross-profit-total";
    } else if (lower === "operating income" || lower === "net operating income" || lower === "net ordinary income") {
      id = "operating-income-total";
    } else if (lower === "net other income") {
      id = "net-other-income-total";
    } else if (lower === "net income") {
      id = "net-income-total";
    }

    rows.push({
      id,
      label,
      depth: 0,
      rowType: "total",
      section: "Summary",
      values: amountSeries,
    });
  });

  return {
    companyName,
    columns,
    rows,
  };
}

function mergeSummaryMatrixReports(currentMatrix, comparisonMatrix) {
  const comparisonRowsByKey = new Map(
    comparisonMatrix
      ? comparisonMatrix.rows.map((row) => [buildProfitLossMatrixMergeKey(row), row])
      : [],
  );

  return {
    companyName: currentMatrix.companyName,
    columns: currentMatrix.columns.map((column, index) => ({
      ...column,
      compareLabel: comparisonMatrix?.columns?.[index]?.label,
    })),
    rows: currentMatrix.rows.map((row) => {
      const comparisonRow = comparisonRowsByKey.get(buildProfitLossMatrixMergeKey(row));
      return {
        id: row.id,
        label: row.label,
        depth: row.depth,
        rowType: row.rowType,
        section: row.section,
        parentLabel: row.parentLabel,
        cells: row.values.map((amount, index) => {
          const compareAmount = comparisonRow?.values?.[index] ?? null;
          return {
            amount,
            compareAmount,
            variancePercent:
              amount === null || compareAmount === null || compareAmount === 0
                ? null
                : ((amount - compareAmount) / Math.abs(compareAmount)) * 100,
          };
        }),
      };
    }),
  };
}

function parseDetailReport(report) {
  const rows = [];
  const columns = toArray(report?.Columns?.Column).map((column) => String(column?.ColTitle || "").trim());
  const dateIndex = columnIndex(columns, ["transaction date", "date"]);
  const typeIndex = columnIndex(columns, ["transaction type", "type"]);
  const numIndex = columnIndex(columns, ["num", "number"]);
  const nameIndex = columnIndex(columns, ["name", "customer", "vendor"]);
  const departmentIndex = columnIndex(columns, ["department", "class full name", "class"]);
  const descriptionIndex = columnIndex(columns, ["description", "memo/description", "memo"]);
  const splitAccountIndex = columnIndex(columns, ["split account", "item split account", "account"]);
  const amountIndex = columnIndex(columns, ["amount", "total"]);
  let rowCounter = 0;

  function walkNestedRows(nestedRows, section, depth) {
    toArray(nestedRows).forEach((row) => {
      const label = getRowLabel(row);
      const children = toArray(row?.Rows?.Row);
      const colData = toArray(row?.ColData);

      if (children.length) {
        if (label) {
          rows.push({
            id: `detail-group-${slugify(label)}-${rowCounter += 1}`,
            rowType: "group",
            section,
            label,
            depth,
          });
        }
        walkNestedRows(children, section, depth + 1);
        return;
      }

      if (!colData.length) {
        return;
      }

      rows.push({
        id: `detail-row-${rowCounter += 1}`,
        rowType: "detail",
        section,
        label,
        depth,
        sortDate: getColumnValue(colData, dateIndex),
        date: formatApiDate(getColumnValue(colData, dateIndex)),
        transactionType: getColumnValue(colData, typeIndex),
        num: getColumnValue(colData, numIndex),
        name: getColumnValue(colData, nameIndex),
        department: getColumnValue(colData, departmentIndex),
        description: getColumnValue(colData, descriptionIndex),
        splitAccount: getColumnValue(colData, splitAccountIndex),
        amount: parseMoney(getColumnValue(colData, amountIndex)) ?? getRowAmount(row) ?? 0,
      });
    });
  }

  function appendSectionRow(section) {
    rows.push({
      id: `detail-section-${slugify(section)}-${rowCounter += 1}`,
      rowType: "section",
      section,
      label: sectionDisplayName(section),
      depth: 0,
    });
  }

  function appendMappedSection(row, section) {
    appendSectionRow(section);
    walkNestedRows(row?.Rows?.Row, section, 1);
  }

  toArray(report?.Rows?.Row).forEach((row) => {
    const label = getRowLabel(row);
    const mappedSection = mapProfitLossSection(label);
    const children = toArray(row?.Rows?.Row);

    if (mappedSection) {
      appendMappedSection(row, mappedSection);
      return;
    }

    if (!children.length) {
      return;
    }

    children.forEach((childRow) => {
      const childSection = mapProfitLossSection(getRowLabel(childRow));
      if (!childSection) {
        return;
      }

      appendMappedSection(childRow, childSection);
    });
  });

  return rows;
}

async function fetchQuickBooksReport(config, accessToken, reportName, params, allowRetry = true) {
  const url = new URL(`${QB_BASE_URL}/v3/company/${config.realmId}/reports/${reportName}`);
  url.searchParams.set("minorversion", REPORT_MINOR_VERSION);
  url.searchParams.set("accounting_method", params.basis === "cash" ? "Cash" : "Accrual");
  url.searchParams.set("start_date", params.startDate);
  url.searchParams.set("end_date", params.endDate);
  if (params.summarizeColumnBy) {
    url.searchParams.set("summarize_column_by", params.summarizeColumnBy);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401 && allowRetry) {
    const refreshed = await refreshAccessToken(loadConfig());
    if (refreshed.accessToken) {
      return fetchQuickBooksReport(loadConfig(), refreshed.accessToken, reportName, params, false);
    }
    throw new Error(refreshed.connection.lastError || "QuickBooks authentication failed.");
  }

  if (!response.ok) {
    const detail = payload?.Fault?.Error?.[0]?.Detail || payload?.Fault?.Error?.[0]?.Message || payload?.message || response.statusText;
    throw new Error(detail || `QuickBooks report request failed with status ${response.status}.`);
  }

  return payload;
}

async function buildProfitLossPayload(searchParams) {
  const config = loadConfig();
  const auth = await ensureAccessToken(config);

  if (!auth.accessToken) {
    return {
      connection: auth.connection,
      companyName: DEFAULT_COMPANY_NAME,
      statement: null,
      detailRows: [],
      summaryRows: [],
    };
  }

  const basis = searchParams.get("basis") || "accrual";
  const currentParams = {
    basis,
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  };

  if (!currentParams.startDate || !currentParams.endDate) {
    return {
      connection: buildConnectionState(config, {
        needsAuthorization: false,
        message: "The Profit & Loss filters are missing a start or end date.",
      }),
      companyName: DEFAULT_COMPANY_NAME,
      statement: null,
      detailRows: [],
      summaryRows: [],
    };
  }

  const [summaryReport, detailReport, companyInfo] = await Promise.all([
    fetchQuickBooksReport(config, auth.accessToken, "ProfitAndLoss", currentParams),
    fetchQuickBooksReport(config, auth.accessToken, "ProfitAndLossDetail", currentParams),
    fetchQuickBooksCompanyInfo(config, auth.accessToken),
  ]);

  const comparisonStartDate = searchParams.get("compareStartDate");
  const comparisonEndDate = searchParams.get("compareEndDate");
  const comparisonReport =
    comparisonStartDate && comparisonEndDate
      ? await fetchQuickBooksReport(config, auth.accessToken, "ProfitAndLoss", {
          basis,
          startDate: comparisonStartDate,
          endDate: comparisonEndDate,
        })
      : null;

  const parsedCurrent = parseSummaryReport(summaryReport);
  const parsedComparison = comparisonReport ? parseSummaryReport(comparisonReport) : null;
  const companyName = parsedCurrent.companyName || DEFAULT_COMPANY_NAME;
  const connectedCompanyName = companyInfo?.CompanyName || companyInfo?.LegalName || companyName;

  return {
    connection: buildConnectionState(config, {
      connected: true,
      companyName: connectedCompanyName,
      displayName: companyInfo?.LegalName || connectedCompanyName,
    }),
    companyName,
    statement: {
      rows: parsedCurrent.statementRows,
      summary: parsedCurrent.summary,
      comparisonSummary: parsedComparison?.summary || null,
      options: buildStatementOptions(),
      periodLabel: searchParams.get("periodLabel") || `${currentParams.startDate} - ${currentParams.endDate}`,
      comparisonLabel: searchParams.get("comparisonLabel") || null,
      source: "quickbooks",
    },
    detailRows: parseDetailReport(detailReport),
    summaryRows: parsedCurrent.summaryRows,
  };
}

async function buildProfitLossMatrixPayload(searchParams) {
  const config = loadConfig();
  const auth = await ensureAccessToken(config);

  if (!auth.accessToken) {
    return {
      connection: auth.connection,
      companyName: DEFAULT_COMPANY_NAME,
      matrix: null,
    };
  }

  const basis = searchParams.get("basis") || "accrual";
  const currentParams = {
    basis,
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
    summarizeColumnBy: "Month",
  };

  if (!currentParams.startDate || !currentParams.endDate) {
    return {
      connection: buildConnectionState(config, {
        needsAuthorization: false,
        message: "The Profit & Loss monthly view is missing a start or end date.",
      }),
      companyName: DEFAULT_COMPANY_NAME,
      matrix: null,
    };
  }

  const [currentReport, companyInfo] = await Promise.all([
    fetchQuickBooksReport(config, auth.accessToken, "ProfitAndLoss", currentParams),
    fetchQuickBooksCompanyInfo(config, auth.accessToken),
  ]);

  const comparisonStartDate = searchParams.get("compareStartDate");
  const comparisonEndDate = searchParams.get("compareEndDate");
  const comparisonReport =
    comparisonStartDate && comparisonEndDate
      ? await fetchQuickBooksReport(config, auth.accessToken, "ProfitAndLoss", {
          basis,
          startDate: comparisonStartDate,
          endDate: comparisonEndDate,
          summarizeColumnBy: "Month",
        })
      : null;

  const currentMatrix = parseSummaryMatrixReport(currentReport);
  const comparisonMatrix = comparisonReport ? parseSummaryMatrixReport(comparisonReport) : null;
  const mergedMatrix = mergeSummaryMatrixReports(currentMatrix, comparisonMatrix);
  const connectedCompanyName = companyInfo?.CompanyName || companyInfo?.LegalName || currentMatrix.companyName || DEFAULT_COMPANY_NAME;

  return {
    connection: buildConnectionState(config, {
      connected: true,
      companyName: connectedCompanyName,
      displayName: companyInfo?.LegalName || connectedCompanyName,
    }),
    companyName: currentMatrix.companyName || DEFAULT_COMPANY_NAME,
    matrix: {
      columns: mergedMatrix.columns,
      rows: mergedMatrix.rows,
      periodLabel: searchParams.get("periodLabel") || `${currentParams.startDate} - ${currentParams.endDate}`,
      source: "quickbooks",
    },
  };
}

async function buildBalanceSheetPayload(searchParams) {
  const config = loadConfig();
  const auth = await ensureAccessToken(config);

  if (!auth.accessToken) {
    return {
      connection: auth.connection,
      companyName: DEFAULT_COMPANY_NAME,
      statement: null,
      rows: [],
    };
  }

  const currentParams = {
    basis: searchParams.get("basis") || "accrual",
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  };

  if (!currentParams.startDate || !currentParams.endDate) {
    return {
      connection: buildConnectionState(config, {
        needsAuthorization: false,
        message: "The Balance Sheet filters are missing a start or end date.",
      }),
      companyName: DEFAULT_COMPANY_NAME,
      statement: null,
      rows: [],
    };
  }

  const [report, companyInfo] = await Promise.all([
    fetchQuickBooksReport(config, auth.accessToken, "BalanceSheet", currentParams),
    fetchQuickBooksCompanyInfo(config, auth.accessToken),
  ]);

  const parsed = parseBalanceSheetReport(report);
  const companyName = parsed.companyName || DEFAULT_COMPANY_NAME;
  const connectedCompanyName = companyInfo?.CompanyName || companyInfo?.LegalName || companyName;

  return {
    connection: buildConnectionState(config, {
      connected: true,
      companyName: connectedCompanyName,
      displayName: companyInfo?.LegalName || connectedCompanyName,
    }),
    companyName,
    statement: {
      rows: parsed.rows,
      options: buildStatementOptions(),
      periodLabel: searchParams.get("periodLabel") || currentParams.endDate,
      asOfDate: currentParams.endDate,
      source: "quickbooks",
    },
    rows: parsed.rows,
  };
}

async function buildQuickBooksStatusPayload() {
  const config = loadConfig();
  const auth = await ensureAccessToken(config);

  if (!auth.accessToken) {
    return {
      connection: auth.connection,
    };
  }

  const companyInfo = await fetchQuickBooksCompanyInfo(config, auth.accessToken);
  const connectedCompanyName = companyInfo?.CompanyName || companyInfo?.LegalName || DEFAULT_COMPANY_NAME;

  return {
    connection: buildConnectionState(config, {
      connected: true,
      companyName: connectedCompanyName,
      displayName: companyInfo?.LegalName || connectedCompanyName,
    }),
  };
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  if (request.method !== "GET") {
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  if (requestUrl.pathname === "/api/quickbooks/connect") {
    const authorizationUrl = buildAuthorizationUrl(loadConfig());
    if (!authorizationUrl) {
      html(response, 500, "<h1>QuickBooks config is incomplete</h1><p>Add the client ID, secret, redirect URI, and realm ID first.</p>");
      return;
    }
    redirect(response, authorizationUrl);
    return;
  }

  if (requestUrl.pathname === "/api/quickbooks/callback") {
    const config = loadConfig();
    const error = requestUrl.searchParams.get("error");
    const errorDescription = requestUrl.searchParams.get("error_description");
    const code = requestUrl.searchParams.get("code");
    const realmId = requestUrl.searchParams.get("realmId");

    if (error) {
      html(
        response,
        400,
        `<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>QuickBooks connection was not completed</h1><p>${errorDescription || error}</p><p><a href="${APP_URL}">Return to the Profit &amp; Loss page</a></p></body></html>`,
      );
      return;
    }

    if (!code || !realmId) {
      html(
        response,
        400,
        `<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>QuickBooks callback is missing required values</h1><p>The response did not include both a code and a realmId.</p><p><a href="${APP_URL}">Return to the Profit &amp; Loss page</a></p></body></html>`,
      );
      return;
    }

    saveQuickBooksEnv({
      QUICKBOOKS_REALM_ID: realmId,
      QUICKBOOKS_AUTH_CODE: code,
    });

    const exchangeResult = await exchangeAuthorizationCode({
      ...config,
      realmId,
      authCode: code,
    });

    if (!exchangeResult.accessToken) {
      html(
        response,
        400,
        `<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>QuickBooks token exchange failed</h1><p>${exchangeResult.connection.lastError || "The authorization code could not be exchanged."}</p><p><a href="${APP_URL}">Return to the Profit &amp; Loss page</a></p></body></html>`,
      );
      return;
    }

    html(
      response,
      200,
      `<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>QuickBooks connected</h1><p>The sandbox connection is saved locally and the Profit &amp; Loss page can now use live QuickBooks data.</p><p><a href="${APP_URL}">Open the Profit &amp; Loss page</a></p></body></html>`,
    );
    return;
  }

  if (requestUrl.pathname === "/health") {
    json(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname === "/api/quickbooks/status") {
    try {
      const payload = await buildQuickBooksStatusPayload();
      json(response, payload.connection.connected ? 200 : 412, payload);
    } catch (error) {
      json(response, 500, {
        connection: {
          connected: false,
          mode: "sandbox",
          message: "QuickBooks status could not be loaded.",
          lastError: error instanceof Error ? error.message : "Unknown server error",
        },
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/quickbooks/profit-loss-matrix") {
    try {
      const payload = await buildProfitLossMatrixPayload(requestUrl.searchParams);
      json(response, payload.connection.connected ? 200 : 412, payload);
    } catch (error) {
      json(response, 500, {
        connection: {
          connected: false,
          mode: "sandbox",
          companyName: DEFAULT_COMPANY_NAME,
          message: "QuickBooks bridge failed while loading the live Profit & Loss monthly view.",
          lastError: error instanceof Error ? error.message : "Unknown server error",
        },
        companyName: DEFAULT_COMPANY_NAME,
        matrix: null,
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/quickbooks/balance-sheet") {
    try {
      const payload = await buildBalanceSheetPayload(requestUrl.searchParams);
      json(response, payload.connection.connected ? 200 : 412, payload);
    } catch (error) {
      json(response, 500, {
        connection: {
          connected: false,
          mode: "sandbox",
          companyName: DEFAULT_COMPANY_NAME,
          message: "QuickBooks bridge failed while loading the live Balance Sheet report.",
          lastError: error instanceof Error ? error.message : "Unknown server error",
        },
        companyName: DEFAULT_COMPANY_NAME,
        statement: null,
        rows: [],
      });
    }
    return;
  }

  if (requestUrl.pathname !== "/api/quickbooks/profit-loss") {
    json(response, 404, { error: "Not found" });
    return;
  }

  try {
    const payload = await buildProfitLossPayload(requestUrl.searchParams);
    json(response, payload.connection.connected ? 200 : 412, payload);
  } catch (error) {
    json(response, 500, {
      connection: {
        connected: false,
        mode: "sandbox",
        companyName: DEFAULT_COMPANY_NAME,
        message: "QuickBooks bridge failed while loading the live Profit & Loss report.",
        lastError: error instanceof Error ? error.message : "Unknown server error",
      },
      companyName: DEFAULT_COMPANY_NAME,
      statement: null,
      detailRows: [],
      summaryRows: [],
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`QuickBooks bridge listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
