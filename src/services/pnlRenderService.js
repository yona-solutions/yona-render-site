/**
 * P&L Render Service
 * 
 * Generates HTML for P&L reports at different hierarchy levels.
 * Handles formatting, styling, and layout for multi-level reports
 * (Subsidiary → Region → District → Facility).
 */

const accountService = require('./accountService');

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
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[parseInt(month) - 1];
    
    return `${monthName} - ${year}`;
  } catch (e) {
    return isoDate;
  }
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
    actualCensus,
    budgetCensus,
    startDateEst
  } = meta;
  
  const formattedMonth = formatMonthLabel(monthLabel);
  
  let censusHtml = '';
  if (actualCensus != null) {
    censusHtml += `<div class="meta">Census Actual: ${Math.round(Number(actualCensus))}</div>`;
  }
  if (budgetCensus != null) {
    censusHtml += `<div class="meta">Census Budget: ${Math.round(Number(budgetCensus))}</div>`;
  }
  
  if (typeLabel === 'Facility') {
    let startDateHtml = startDateEst ? `<div class="meta">Start Date: ${startDateEst}</div>` : '';
    
    return `
      <div class="pnl-report-header">
        <div class="pnl-title">${entityName}</div>
        <div class="pnl-meta">${formattedMonth}</div>
        <div class="pnl-meta">Type: Facility</div>
        <div class="pnl-meta">${parentDistrict || ''}</div>
        ${censusHtml}
        ${startDateHtml}
      </div>
    `;
  } else if (typeLabel === 'Subsidiary') {
    return `
      <div class="pnl-report-header">
        <div class="pnl-title">${entityName}</div>
        <div class="pnl-subtitle">Actual vs Budget</div>
        <div class="pnl-meta">${formattedMonth}</div>
        <div class="pnl-meta">Districts: ${districtCount ?? '-'}</div>
        <div class="pnl-meta">Facilities: ${facilityCount ?? '-'}</div>
      </div>
    `;
  } else if (typeLabel === 'Region') {
    return `
      <div class="pnl-report-header">
        <div class="pnl-title">${entityName}</div>
        <div class="pnl-subtitle">Yona Solutions</div>
        <div class="pnl-meta">${formattedMonth}</div>
        <div class="pnl-meta">Districts: ${regionCount ?? '-'}</div>
        <div class="pnl-meta">Facilities: ${facilityCount ?? '-'}</div>
      </div>
    `;
  } else if (typeLabel === 'District') {
    return `
      <div class="pnl-report-header">
        <div class="pnl-title">${entityName}</div>
        <div class="pnl-subtitle">Yona Solutions</div>
        <div class="pnl-meta">${formattedMonth}</div>
        <div class="pnl-meta">Facilities: ${facilityCount ?? '-'}</div>
        <div class="pnl-meta">Type: District</div>
        ${censusHtml}
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
        c, level, labelToConfig, childrenMap, valMonthAct, valMonthBud,
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
  const shouldBold = kids.length > 0 || sectionAccounts.has(accountLabel);
  
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
  
  // Check for no revenue (facilities only)
  if (meta.typeLabel === 'Facility') {
    const hasRevenue = Math.abs(incomeTotals.act) >= 0.0001;
    console.log(`   🏢 Facility "${meta.entityName}": Income = ${incomeTotals.act}, hasRevenue = ${hasRevenue}`);
    if (!hasRevenue) {
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
    
    rowsHtml += `
      <tr>
        <td colspan="12" style="font-weight:700; text-decoration:underline; text-transform:uppercase; padding-top: 12px;">
          ${section}
        </td>
      </tr>
    `;
    
    accounts.forEach(acct => {
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
            <th>Actual</th>
            <th>%</th>
            <th>Budget</th>
            <th>%</th>
            <th>Act v Bud</th>
            <th></th>
            <th>Actual</th>
            <th>%</th>
            <th>Budget</th>
            <th>%</th>
            <th>Act v Bud</th>
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
  formatNumber,
  formatPercent,
  formatMonthLabel
};

