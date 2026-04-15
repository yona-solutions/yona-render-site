/**
 * P&L Render Service
 * 
 * Generates HTML for P&L reports at different hierarchy levels.
 * Handles formatting, styling, and layout for multi-level reports
 * (Subsidiary → Region → District → Facility).
 */

const accountService = require('./accountService');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

/**
 * Formats a number for display in P&L reports
 * Negative numbers shown in parentheses
 * 
 * @param {number} n - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(n) {
  if (!n || Math.abs(n) < 0.0001) {
    return '-';
  }
  
  if (n < 0) {
    return `(${Math.round(Math.abs(n)).toLocaleString()})`;
  }
  
  return Math.round(n).toLocaleString();
}

/**
 * Formats a percentage for display
 * 
 * @param {number} n - Percentage value
 * @returns {string} Formatted percentage string
 */
function formatPercent(n) {
  if (!n || Math.abs(n) < 0.0001) {
    return '-';
  }
  
  return `${n.toFixed(1)}%`;
}

/**
 * Formats a date string from YYYY-MM-DD to Mon - YYYY
 * 
 * @param {string} isoDate - ISO date string (YYYY-MM-DD)
 * @returns {string} Formatted month label
 */
function formatMonthLabel(isoDate) {
  if (!isoDate) return '';
  
  try {
    const dateStr = String(isoDate).substring(0, 10);
    const [year, month] = dateStr.split('-');
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month) - 1];
    
    return `${monthName} ${year}`;
  } catch (e) {
    return isoDate;
  }
}

/**
 * Formats a date string to MM/DD/YYYY format
 * 
 * @param {string} dateStr - Date in ISO format (YYYY-MM-DD) or other format
 * @returns {string} Formatted date as MM/DD/YYYY
 */
function formatStartDate(dateStr) {
  if (!dateStr) return '';
  // Format without timezone conversion: prefer date-only parsing.
  const raw = String(dateStr).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }
  return raw;
}

/**
 * Formats a number with 2 decimals for census/headcount display
 * 
 * @param {number} n - Number to format
 * @returns {string} Formatted number string
 */
function formatDecimal(n) {
  if (n == null || Number.isNaN(Number(n))) {
    return '';
  }
  
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatInteger(n) {
  if (n == null || Number.isNaN(Number(n))) {
    return '';
  }
  
  return Math.round(Number(n)).toLocaleString();
}

/**
 * Generates the HTML header for a P&L report
 * Header varies based on entity type (Subsidiary, Region, District, Facility)
 * 
 * @param {Object} meta - Metadata about the entity
 * @returns {string} HTML string for the header
 */
function generateHeader(meta) {
  const {
    typeLabel,
    entityName = '',
    monthLabel,
    districtCount,
    regionCount,
    facilityCount,
    parentDistrict,
    parentRegion,
    actualCensus,
    budgetCensus,
    startDateEst,
    headcount,
    accountCount,
    orgLabel,
    reportTypeLabel,
    regionStructure
  } = meta;
  
  const formattedMonth = formatMonthLabel(monthLabel);
  const organization = orgLabel || '';
  const subsidiaryServiceSuffix = typeof entityName === 'string' && entityName.includes(' — Service: ')
    ? entityName.slice(entityName.indexOf(' — Service: '))
    : '';
  const subsidiaryTitle = orgLabel ? `${orgLabel}${subsidiaryServiceSuffix}` : entityName;
  const resolvedAccountCount = accountCount != null ? accountCount : facilityCount;
  const resolvedReportType = reportTypeLabel || (() => {
    if (typeLabel === 'Facility') return 'Account';
    if (typeLabel === 'Region') return 'Region';
    if (typeLabel === 'District' || typeLabel === 'District Tag') return 'District';
    if (typeLabel === 'Subsidiary' || typeLabel === 'Subsidiary Tag') return 'Entity';
    return typeLabel || 'Report';
  })();
  
  function buildRow(items, { italic, bold, className } = {}) {
    const parts = items.filter(i => i && String(i).trim() !== '');
    if (!parts.length) return '';

    const rowClass = [
      'pnl-header-row',
      italic ? 'pnl-italic' : null,
      className || null
    ].filter(Boolean).join(' ');
    const inlineStyle = [
      'display:flex; justify-content:center; align-items:baseline; gap:6px; line-height:1.4',
      bold ? '; font-weight:700' : '; font-weight:400',
      italic ? '; font-style:italic' : ''
    ].join('');
    const htmlParts = parts.map((part, idx) => {
      const sep = idx === 0 ? '' : '<span class="pnl-sep" style="margin:0 2px; color:#888">|</span>';
      return `${sep}<span class="pnl-header-item" style="white-space:nowrap">${escapeHtml(part)}</span>`;
    });

    return `<div class="${rowClass}" style="${inlineStyle}">${htmlParts.join('')}</div>`;
  }
  
  if (typeLabel === 'Facility') {
    const censusRow = buildRow(
      [
        `Census: ${actualCensus != null ? formatDecimal(actualCensus) : ''}`,
        `Budget Census: ${budgetCensus != null ? formatDecimal(budgetCensus) : ''}`,
        `Headcount: ${headcount != null ? formatInteger(headcount) : ''}`
      ],
      { italic: true }
    );
    
    return `
      <div class="pnl-report-header" style="text-align:center; margin-bottom:10px">
        <div class="pnl-title" style="font-weight:700">${escapeHtml(entityName)}</div>
        ${buildRow([organization, parentRegion, parentDistrict], { bold: true, className: 'pnl-header-row-secondary' })}
        ${buildRow([
          formattedMonth,
          startDateEst ? `Start Date: ${formatStartDate(startDateEst)}` : '',
          `Report Type: ${resolvedReportType}`
        ])}
        ${censusRow}
      </div>
    `;
  } else if (typeLabel === 'Subsidiary') {
    return `
      <div class="pnl-report-header" style="text-align:center; margin-bottom:10px">
        <div class="pnl-title" style="font-weight:700">${escapeHtml(subsidiaryTitle)}</div>
        <div class="pnl-subtitle" style="font-weight:700">Actual vs Budget</div>
        ${buildRow([
          formattedMonth,
          regionCount != null ? `Regions: ${regionCount}` : '',
          districtCount != null ? `Districts: ${districtCount}` : '',
          resolvedAccountCount != null ? `Accounts: ${resolvedAccountCount}` : '',
          `Report Type: ${resolvedReportType}`
        ])}
        ${buildRow(
          [
            `Census: ${actualCensus != null ? formatDecimal(actualCensus) : ''}`,
            `Budget Census: ${budgetCensus != null ? formatDecimal(budgetCensus) : ''}`,
            `Headcount: ${headcount != null ? formatInteger(headcount) : ''}`
          ],
          { italic: true }
        )}
      </div>
    `;
  } else if (typeLabel === 'Subsidiary Tag') {
    return `
      <div class="pnl-report-header" style="text-align:center; margin-bottom:10px">
        <div class="pnl-title" style="font-weight:700">${escapeHtml(subsidiaryTitle)}</div>
        <div class="pnl-subtitle" style="font-weight:700">Actual vs Budget</div>
        ${buildRow([
          formattedMonth,
          regionCount != null ? `Regions: ${regionCount}` : '',
          districtCount != null ? `Districts: ${districtCount}` : '',
          resolvedAccountCount != null ? `Accounts: ${resolvedAccountCount}` : '',
          `Report Type: ${resolvedReportType}`
        ])}
        ${buildRow(
          [
            `Census: ${actualCensus != null ? formatDecimal(actualCensus) : ''}`,
            `Budget Census: ${budgetCensus != null ? formatDecimal(budgetCensus) : ''}`,
            `Headcount: ${headcount != null ? formatInteger(headcount) : ''}`
          ],
          { italic: true }
        )}
      </div>
    `;
  } else if (typeLabel === 'Region') {
    return `
      <div class="pnl-report-header" style="text-align:center; margin-bottom:10px">
        <div class="pnl-title" style="font-weight:700">${escapeHtml(entityName)}</div>
        <div class="pnl-subtitle" style="font-weight:700">${escapeHtml(organization)}</div>
        ${buildRow([
          formattedMonth,
          districtCount != null ? `Districts: ${districtCount}` : '',
          resolvedAccountCount != null ? `Accounts: ${resolvedAccountCount}` : '',
          `Report Type: ${resolvedReportType}`
        ])}
        ${buildRow(
          [
            `Census: ${actualCensus != null ? formatDecimal(actualCensus) : ''}`,
            `Budget Census: ${budgetCensus != null ? formatDecimal(budgetCensus) : ''}`,
            `Headcount: ${headcount != null ? formatInteger(headcount) : ''}`
          ],
          { italic: true }
        )}
      </div>
    `;
  } else if (typeLabel === 'District') {
    return `
      <div class="pnl-report-header" style="text-align:center; margin-bottom:10px">
        <div class="pnl-title" style="font-weight:700">${escapeHtml(entityName)}</div>
        ${buildRow([organization, parentRegion], { bold: true, className: 'pnl-header-row-secondary' })}
        ${buildRow([
          formattedMonth,
          resolvedAccountCount != null ? `Accounts: ${resolvedAccountCount}` : '',
          `Report Type: ${resolvedReportType}`
        ])}
        ${buildRow(
          [
            `Census: ${actualCensus != null ? formatDecimal(actualCensus) : ''}`,
            `Budget Census: ${budgetCensus != null ? formatDecimal(budgetCensus) : ''}`,
            `Headcount: ${headcount != null ? formatInteger(headcount) : ''}`
          ],
          { italic: true }
        )}
      </div>
    `;
  } else if (typeLabel === 'District Tag') {
    return `
      <div class="pnl-report-header" style="text-align:center; margin-bottom:10px">
        <div class="pnl-title" style="font-weight:700">${escapeHtml(entityName)}</div>
        ${buildRow([organization, parentRegion], { bold: true, className: 'pnl-header-row-secondary' })}
        ${buildRow([
          formattedMonth,
          resolvedAccountCount != null ? `Accounts: ${resolvedAccountCount}` : '',
          `Report Type: ${resolvedReportType}`
        ])}
        ${buildRow(
          [
            `Census: ${actualCensus != null ? formatDecimal(actualCensus) : ''}`,
            `Budget Census: ${budgetCensus != null ? formatDecimal(budgetCensus) : ''}`,
            `Headcount: ${headcount != null ? formatInteger(headcount) : ''}`
          ],
          { italic: true }
        )}
      </div>
    `;
  }

  return '';
}

/**
 * Generates HTML for P&L account rows
 * Renders accounts recursively with proper indentation
 * 
 * @param {string} accountLabel - Account to render
 * @param {number} level - Indentation level
 * @param {Object} labelToConfig - Map of label -> account config
 * @param {Object} childrenMap - Map of parent label -> children labels
 * @param {Object} valMonthAct - Month actuals by account
 * @param {Object} valMonthBud - Month budget by account
 * @param {Object} valYtdAct - YTD actuals by account
 * @param {Object} valYtdBud - YTD budget by account
 * @param {Object} incomeTotals - Income totals for percentage calculations
 * @param {boolean} isOperational - Whether this is operational P&L
 * @param {Set<string>} sectionAccounts - Top-level section accounts (for bolding)
 * @returns {string} HTML string for rows
 */
function renderAccountRows(
  accountLabel,
  level,
  labelToConfig,
  childrenMap,
  valMonthAct,
  valMonthBud,
  valYtdAct,
  valYtdBud,
  incomeTotals,
  isOperational,
  sectionAccounts
) {
  let html = '';
  const INDENT = 8;
  
  const cfg = labelToConfig[accountLabel] || {};
  const kids = childrenMap[accountLabel] || [];
  
  // Check if excluded
  const excluded = isOperational
    ? (cfg.operationalExcluded || cfg.displayExcluded)
    : cfg.displayExcluded;
  
  if (excluded) {
    // Still render children
    kids.forEach(c => {
      html += renderAccountRows(
        c, level + 1, labelToConfig, childrenMap, valMonthAct, valMonthBud,
        valYtdAct, valYtdBud, incomeTotals, isOperational, sectionAccounts
      );
    });
    return html;
  }
  
  const act = valMonthAct[accountLabel] || 0;
  const bud = valMonthBud[accountLabel] || 0;
  const ytdA = valYtdAct[accountLabel] || 0;
  const ytdB = valYtdBud[accountLabel] || 0;
  
  // Render children first (they appear below parent)
  // Children are rendered even if parent has zero value
  kids.forEach(c => {
    html += renderAccountRows(
      c, level + 1, labelToConfig, childrenMap, valMonthAct, valMonthBud,
      valYtdAct, valYtdBud, incomeTotals, isOperational, sectionAccounts
    );
  });
  
  // Skip rendering this account if it has no values
  if (Math.abs(act + ytdA) < 0.0001) {
    return html;
  }
  
  // Apply double lines if configured
  const borderStyle = cfg.doubleLines 
    ? 'border-top: 1px solid black; border-bottom: 1px solid black;' 
    : '';
  
  // Bold if has children OR is a top-level section account
  const shouldBold = kids.length > 0 || sectionAccounts.has(accountLabel) || cfg.doubleLines;
  
  // Calculate percentages relative to Income
  const pctMonthAct = incomeTotals.act ? (act / incomeTotals.act * 100) : null;
  const pctMonthBud = incomeTotals.bud ? (bud / incomeTotals.bud * 100) : null;
  const pctYtdAct = incomeTotals.ytdAct ? (ytdA / incomeTotals.ytdAct * 100) : null;
  const pctYtdBud = incomeTotals.ytdBud ? (ytdB / incomeTotals.ytdBud * 100) : null;
  
  html += `
    <tr style="font-weight:${shouldBold ? 600 : 400}">
      <td style="padding-left:${INDENT * level}px">${accountLabel}</td>
      <td style="text-align:right; ${borderStyle}">${formatNumber(act)}</td>
      <td style="text-align:right; ${borderStyle}">${formatPercent(pctMonthAct)}</td>
      <td style="text-align:right; ${borderStyle}">${formatNumber(bud)}</td>
      <td style="text-align:right; ${borderStyle}">${formatPercent(pctMonthBud)}</td>
      <td style="text-align:right; ${borderStyle}">${formatNumber(act - bud)}</td>
      <td></td>
      <td style="text-align:right; ${borderStyle}">${formatNumber(ytdA)}</td>
      <td style="text-align:right; ${borderStyle}">${formatPercent(pctYtdAct)}</td>
      <td style="text-align:right; ${borderStyle}">${formatNumber(ytdB)}</td>
      <td style="text-align:right; ${borderStyle}">${formatPercent(pctYtdBud)}</td>
      <td style="text-align:right; ${borderStyle}">${formatNumber(ytdA - ytdB)}</td>
    </tr>
  `;
  
  return html;
}

/**
 * Generates a complete P&L HTML report
 * 
 * @param {Object} monthData - BigQuery data for the month
 * @param {Object} ytdData - BigQuery data for YTD (can be null for now)
 * @param {Object} meta - Metadata about the entity
 * @param {Object} accountConfig - Account configuration
 * @param {Object} childrenMap - Map of parent -> children
 * @param {Object} sectionConfig - Section configuration
 * @returns {Object} { noRevenue: boolean, html: string }
 */
async function generatePNLReport(monthData, ytdData, meta, accountConfig, childrenMap, sectionConfig) {
  const isOperational = meta.plType === 'Operational';
  
  // Build label-to-config map for efficient lookups
  const labelToConfig = {};
  for (const configId in accountConfig) {
    const config = accountConfig[configId];
    if (config.label) {
      labelToConfig[config.label] = config;
    }
  }
  
  // Build totals by scenario
  const monthActuals = accountService.buildAccountTotals(monthData, 'Actuals');
  const monthBudget = accountService.buildAccountTotals(monthData, 'Budget');
  const ytdActuals = ytdData ? accountService.buildAccountTotals(ytdData, 'Actuals') : {};
  const ytdBudget = ytdData ? accountService.buildAccountTotals(ytdData, 'Budget') : {};

  // Compute rollups (parent accounts aggregate children)
  const valMonthAct = accountService.computeRollups(monthActuals, accountConfig, childrenMap, isOperational);
  const valMonthBud = accountService.computeRollups(monthBudget, accountConfig, childrenMap, isOperational);
  const valYtdAct = accountService.computeRollups(ytdActuals, accountConfig, childrenMap, isOperational);
  const valYtdBud = accountService.computeRollups(ytdBudget, accountConfig, childrenMap, isOperational);
  
  // Get income totals for percentage calculations
  const incomeTotals = {
    act: valMonthAct['Income'] || 0,
    bud: valMonthBud['Income'] || 0,
    ytdAct: valYtdAct['Income'] || 0,
    ytdBud: valYtdBud['Income'] || 0
  };
  
  const epsilon = 0.0001;
  const netIncomeMonth = valMonthAct['Net Income'] || 0;
  const netIncomeYtd = valYtdAct['Net Income'] || 0;
  const revenueMonth = valMonthAct['Income'] || 0;
  const revenueYtd = valYtdAct['Income'] || 0;

  // Facilities, districts, and regions are included only when they have non-zero net income.
  if (['Facility', 'District', 'District Tag', 'Region'].includes(meta.typeLabel)) {
    if (Math.abs(netIncomeMonth) < epsilon && Math.abs(netIncomeYtd) < epsilon) {
      return { noRevenue: true, html: '' };
    }
  }

  // Subsidiary summaries still use revenue to decide whether the overall page should render.
  if (['Subsidiary', 'Subsidiary Tag'].includes(meta.typeLabel)) {
    if (Math.abs(revenueMonth) < epsilon && Math.abs(revenueYtd) < epsilon) {
      return { noRevenue: true, html: '' };
    }
  }
  
  // Generate header
  const headerHtml = generateHeader(meta);
  
  // Build section accounts set (for bolding)
  const sectionAccounts = new Set();
  for (const section of Object.keys(sectionConfig)) {
    const accounts = sectionConfig[section].accounts || [];
    accounts.forEach(a => sectionAccounts.add(a));
  }
  
  // Generate rows by section
  let rowsHtml = '';
  for (const section of Object.keys(sectionConfig)) {
    const accounts = sectionConfig[section].accounts || [];
    
    // Sort section accounts by their order field from the config
    const sortedAccounts = accounts.slice().sort((a, b) => {
      const orderA = labelToConfig[a]?.order ?? 0;
      const orderB = labelToConfig[b]?.order ?? 0;
      return orderA - orderB;
    });
    
    rowsHtml += `
      <tr class="section-header-row">
        <td colspan="12" style="font-weight:700; text-decoration:underline; text-transform:uppercase; padding-top: 12px;">
          ${section}
        </td>
      </tr>
    `;
    
    sortedAccounts.forEach(acct => {
      rowsHtml += renderAccountRows(
        acct, 1, labelToConfig, childrenMap, valMonthAct, valMonthBud,
        valYtdAct, valYtdBud, incomeTotals, isOperational, sectionAccounts
      );
    });
  }
  
  const html = `
    <div class="pnl-report-container page-break">
      ${headerHtml}
      <hr class="pnl-divider">
      <table class="pnl-report-table">
        <thead>
          <tr>
            <th></th>
            <th style="text-decoration:underline;">Current Month</th>
            <th style="text-decoration:underline;">%</th>
            <th style="text-decoration:underline;">Budget</th>
            <th style="text-decoration:underline;">%</th>
            <th style="text-decoration:underline;">Act v Bud</th>
            <th></th>
            <th style="text-decoration:underline;">YTD</th>
            <th style="text-decoration:underline;">%</th>
            <th style="text-decoration:underline;">Budget</th>
            <th style="text-decoration:underline;">%</th>
            <th style="text-decoration:underline;">Act v Bud</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
  
  return { noRevenue: false, html };
}

module.exports = {
  generatePNLReport,
  generateHeader,
  formatNumber,
  formatPercent,
  formatMonthLabel
};
