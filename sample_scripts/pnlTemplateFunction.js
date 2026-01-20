// Transformer: pnlTemplateFunction
function generatePNLHTML(
    monthData,
    ytdData,
    titleLabel = "Entity Total",
    meta = {},
    accountConfigInput = {},
    sectionConfigInput = null
  ) {
    const accountConfig = accountConfigInput || {};
    const sectionConfig = sectionConfigInput || {{ sectionConfig.value }};
    const entityName = meta.entityName || "";
  
    const {
      monthLabel = "Aug-25",
      regionCount = null,
      districtCount = null,
      facilityCount = null
    } = meta;
  
    // =====================================================================
    // FORMAT MONTH LABEL (YYYY-MM-DD → Mon - YYYY)
    // =====================================================================
    function formatMonthLabel(isoDate) {
      if (!isoDate) return "";
      try {
        // Parse the ISO date string directly to avoid timezone issues
        const dateStr = String(isoDate).substring(0, 10); // Ensure YYYY-MM-DD format
        const [year, month, day] = dateStr.split('-');
        
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = monthNames[parseInt(month) - 1]; // month is 1-indexed in the string
        
        return `${monthName} - ${year}`;
      } catch (e) {
        return isoDate; // fallback to original if parsing fails
      }
    }
    
    const formattedMonthLabel = formatMonthLabel(monthLabel);
  
    // =====================================================================
    // HEADER HTML (UPDATED: ACTUAL + BUDGET CENSUS)
    // =====================================================================
    let censusHtml = "";
  
    if (meta.actualCensus != null) {
      censusHtml += `
        <div class="meta" style="font-weight:400;">
          Census Actual: ${Math.round(Number(meta.actualCensus))}
        </div>
      `;
    }
  
    if (meta.budgetCensus != null) {
      censusHtml += `
        <div class="meta" style="font-weight:400;">
          Census Budget: ${Math.round(Number(meta.budgetCensus))}
        </div>
      `;
    }
  
    let headerHtml = "";
  
    if (meta.typeLabel === "Facility") {
      let startDateHtml = "";
      if (meta.startDateEst) {
        startDateHtml = `<div class="meta">Start Date: ${meta.startDateEst}</div>`;
      }
      
      headerHtml = `
        <div class="report-header">
          <div class="title">${entityName}</div>
          <div class="meta">${formattedMonthLabel}</div>
          <div class="meta">Type: Facility</div>
          <div class="meta">${meta.parentDistrict || ""}</div>
          ${censusHtml}
          ${startDateHtml}
        </div>
      `;
    } else if (meta.typeLabel === "Subsidiary") {
      headerHtml = `
        <div class="report-header">
          <div class="title">${entityName || ""}</div>
          <div class="subtitle">Actual vs Budget</div>
          <div class="meta">${formattedMonthLabel}</div>
          <div class="meta">Districts: ${meta.districtCount ?? "-"}</div>
          <div class="meta">Facilities: ${meta.facilityCount ?? "-"}</div>
        </div>
      `;
    } else if (meta.typeLabel === "Region") {
      headerHtml = `
        <div class="report-header">
          <div class="title">${entityName || ""}</div>
          <div class="subtitle">Yona Solutions</div>
          <div class="meta">${formattedMonthLabel}</div>
          <div class="meta">Districts: ${meta.regionCount ?? "-"}</div>
          <div class="meta">Facilities: ${meta.facilityCount ?? "-"}</div>
        </div>
      `;
    } else if (meta.typeLabel === "District") {
      headerHtml = `
        <div class="report-header">
          <div class="title">${entityName || ""}</div>
          <div class="subtitle">Yona Solutions</div>
          <div class="meta">${formattedMonthLabel}</div>
          <div class="meta">Facilities: ${facilityCount ?? "-"}</div>
          <div class="meta">Type: District</div>
          ${censusHtml}
        </div>
      `;
    }
  
    // =====================================================================
    // EMPTY CHECK
    // =====================================================================
    if (!monthData || !monthData.Account || !monthData.Value) {
      return {
        noRevenue: meta.typeLabel === "Facility",
        html: `
          <div class="report-container">
            ${headerHtml}
            <hr class="divider">
            <table class="report-table">
              <tbody><tr><td>No data</td></tr></tbody>
            </table>
          </div>`
      };
    }
  
    // ================================
    // TOTAL BUILDERS
    // ================================
    function buildTotals(source, scenario) {
      const totals = {};
      if (!source?.Account) return totals;
      
      // DEBUG: Track account 319 (need to find its label)
      const DEBUG_SCENARIO = "Actuals";
      const debugRows = [];
      const accountCounts = {};
  
      for (let i = 0; i < source.Account.length; i++) {
        if (source.Scenario?.[i] === scenario) {
          const acct = source.Account[i];
          const val = Number(source.Value[i]) || 0;
          totals[acct] = (totals[acct] || 0) + val;
          
          // Track account counts for debugging
          accountCounts[acct] = (accountCounts[acct] || 0) + 1;
          
          // Store all rows for debugging (will filter later)
          if (scenario === DEBUG_SCENARIO) {
            debugRows.push({
              index: i,
              account: acct,
              scenario: source.Scenario?.[i],
              value: val,
              cumulativeTotal: totals[acct]
            });
          }
        }
      }
      
      // Log if we're building Actuals totals and have data
      if (scenario === DEBUG_SCENARIO && debugRows.length > 0) {
        // Find account 319 in totals
        const DEBUG_ACCOUNT_LABEL = "51300 Payroll/Benefit Admin Fees"; // Account 319 label
        const account319Total = totals[DEBUG_ACCOUNT_LABEL] || null;
        
        console.log("🔍 BUILD TOTALS DEBUG - Actuals Scenario", {
          function: "buildTotals",
          scenario: scenario,
          entityName: entityName,
          typeLabel: meta.typeLabel,
          totalRows: debugRows.length,
          accountCounts: accountCounts,
          account319Total: account319Total,
          account319Label: DEBUG_ACCOUNT_LABEL,
          sampleRows: debugRows.slice(0, 10),
          totalsSample: Object.entries(totals).slice(0, 10).map(([acct, val]) => ({ account: acct, total: val }))
        });
      }
      
      return totals;
    }
  
    const monthActuals = buildTotals(monthData, "Actuals");
    const monthBudget  = buildTotals(monthData, "Budget");
    const ytdActuals   = buildTotals(ytdData, "Actuals");
    const ytdBudget    = buildTotals(ytdData, "Budget");
  
    // ================================
    // ACCOUNT HIERARCHY
    // ================================
    const childrenMap = {};
    for (const acct in accountConfig) {
      const parent = accountConfig[acct]?.parent;
      if (parent) (childrenMap[parent] ??= []).push(acct);
    }
  
    function computeTotals(raw) {
      const totals = {};
      const isOperational = meta.plType === "Operational";
      
      // DEBUG: Track rollup for specific accounts
      const debugRollup = [];
      const DEBUG_ACCOUNT_LABELS = []; // Will be populated if we find account 319
      
      function compute(acct) {
        if (totals[acct] != null) return totals[acct];
        let t = raw[acct] || 0;
        const baseValue = t;
        const childrenValues = [];
        
        // Roll up children, but ONLY exclude operationalExcluded accounts in Operational mode
        // displayExcluded accounts should still be included in parent rollups
        for (const c of childrenMap[acct] || []) {
          const cfg = accountConfig[c] || {};
          const shouldExcludeFromRollup = isOperational && cfg.operationalExcluded;
          
          if (!shouldExcludeFromRollup) {
            const childValue = compute(c);
            t += childValue;
            childrenValues.push({ account: c, value: childValue, excluded: false });
          } else {
            // Still need to compute the child (for its own children), but don't add to parent
            const childValue = compute(c);
            childrenValues.push({ account: c, value: childValue, excluded: true });
          }
        }
        
        totals[acct] = t;
        
        // Debug logging for accounts with significant values or specific accounts
        if (Math.abs(t) > 0.01 || DEBUG_ACCOUNT_LABELS.includes(acct)) {
          debugRollup.push({
            account: acct,
            baseValue: baseValue,
            childrenCount: childrenValues.length,
            childrenValues: childrenValues,
            totalValue: t,
            hasChildren: (childrenMap[acct] || []).length > 0
          });
        }
        
        return t;
      }
      Object.keys(accountConfig).forEach(compute);
      
      // Log rollup details if we have significant values or are tracking specific accounts
      if (debugRollup.length > 0 && meta.typeLabel !== "Facility") {
        // Find account 319 in rollup
        const DEBUG_ACCOUNT_LABEL = "51300 Payroll/Benefit Admin Fees"; // Account 319 label
        const account319Rollup = debugRollup.find(r => r.account === DEBUG_ACCOUNT_LABEL) || null;
        const account319FinalTotal = totals[DEBUG_ACCOUNT_LABEL] || null;
        
        // Calculate base value (before rollup) for comparison
        const account319BaseValue = raw[DEBUG_ACCOUNT_LABEL] || 0;
        const account319HasChildren = account319Rollup && account319Rollup.childrenCount > 0;
        const account319ChildrenSum = account319Rollup 
          ? account319Rollup.childrenValues.reduce((sum, child) => sum + (child.excluded ? 0 : child.value), 0)
          : 0;
        
        // Focused log for District 121 (customer 11176 investigation)
        if (entityName === "District 121") {
          // First, log a simple direct comparison that won't be truncated
          console.log("🔍🔍🔍 COMPUTE TOTALS - District 121 Account 319", {
            baseValue: account319BaseValue,
            finalTotal: account319FinalTotal,
            difference: account319FinalTotal !== null ? account319FinalTotal - account319BaseValue : null,
            hasChildren: account319HasChildren,
            childrenCount: account319Rollup?.childrenCount || 0,
            childrenSum: account319ChildrenSum,
            issueFound: account319FinalTotal !== null && Math.abs(account319FinalTotal - account319BaseValue) > 0.01
          });
          
          const summary = {
            "🔍 CUSTOMER 11176 INVESTIGATION - District 121 Rollup": {
              account319BaseValue: account319BaseValue,
              account319FinalTotal: account319FinalTotal,
              account319Difference: account319FinalTotal !== null ? account319FinalTotal - account319BaseValue : null,
              account319HasChildren: account319HasChildren,
              account319ChildrenCount: account319Rollup?.childrenCount || 0,
              account319ChildrenSum: account319ChildrenSum,
              issueFound: account319FinalTotal !== null && Math.abs(account319FinalTotal - account319BaseValue) > 0.01,
              note: account319FinalTotal !== null && Math.abs(account319FinalTotal - account319BaseValue) > 0.01
                ? `⚠️ ISSUE: Account 319 changed during rollup! Base=${account319BaseValue}, Final=${account319FinalTotal}, Diff=${account319FinalTotal - account319BaseValue}`
                : "✅ Account 319 unchanged during rollup"
            }
          };
          console.log("", summary); // Empty string first to make it stand out
        }
        
        console.log("🔍 COMPUTE TOTALS DEBUG - Rollup Computation", {
          function: "computeTotals",
          entityName: entityName,
          typeLabel: meta.typeLabel,
          isOperational: isOperational,
          account319Label: DEBUG_ACCOUNT_LABEL,
          account319BaseValue: account319BaseValue,
          account319FinalTotal: account319FinalTotal,
          account319HasChildren: account319HasChildren,
          account319ChildrenCount: account319Rollup?.childrenCount || 0,
          account319ChildrenSum: account319ChildrenSum,
          account319Rollup: account319Rollup,
          account319Difference: account319FinalTotal !== null ? account319FinalTotal - account319BaseValue : null,
          note: account319FinalTotal !== null && Math.abs(account319FinalTotal - account319BaseValue) > 0.01
            ? `⚠️ Account 319 changed during rollup: base=${account319BaseValue}, final=${account319FinalTotal}, diff=${account319FinalTotal - account319BaseValue}`
            : "✅ Account 319 unchanged during rollup",
          rollupDetails: debugRollup.slice(0, 20), // First 20 accounts with values
          totalAccountsComputed: Object.keys(totals).length
        });
      }
      
      return totals;
    }
  
    const valMonthAct = computeTotals(monthActuals);
    const valMonthBud = computeTotals(monthBudget);
    const valYtdAct   = computeTotals(ytdActuals);
    const valYtdBud   = computeTotals(ytdBudget);
    
    // DEBUG: Store computed totals globally for debugging
    if (typeof window !== 'undefined') {
      window._lastPNLComputedTotals = {
        entityName: entityName,
        typeLabel: meta.typeLabel,
        monthActuals: valMonthAct,
        monthBudget: valMonthBud,
        ytdActuals: valYtdAct,
        ytdBudget: valYtdBud,
        monthActualsRaw: monthActuals,
        monthBudgetRaw: monthBudget
      };
    }
  
    // ================================
    // INCOME TOTALS (for percentage calculations)
    // ================================
    const incomeTotals = {
      act: valMonthAct["Income"] || 0,
      bud: valMonthBud["Income"] || 0,
      ytdAct: valYtdAct["Income"] || 0,
      ytdBud: valYtdBud["Income"] || 0
    };
  
    // ================================
    // FACILITY REVENUE CHECK
    // ================================
    if (meta.typeLabel === "Facility") {
      const income = incomeTotals.act;
      if (Math.abs(income) < 0.0001) return { noRevenue: true };
    }
  
    // ================================
    // FORMATTERS
    // ================================
    const fmt = n =>
      !n || Math.abs(n) < 0.0001
        ? "-"
        : n < 0
        ? `(${Math.round(Math.abs(n)).toLocaleString()})`
        : Math.round(n).toLocaleString();
  
    const fmtPct = n =>
      !n || Math.abs(n) < 0.0001
        ? "-"
        : `${n.toFixed(1)}%`;
  
    const INDENT = 8;
    let rowsHtml = "";
    const isOperational = meta.plType === "Operational";
    
    // Build a set of all accounts that appear in sectionConfig (top-level accounts)
    const sectionAccounts = new Set();
    for (const section of Object.keys(sectionConfig)) {
      const accts = sectionConfig[section] || [];
      accts.forEach(a => sectionAccounts.add(a));
    }
  
    function renderNode(acct, level) {
      const cfg = accountConfig[acct] || {};
      const kids = childrenMap[acct] || [];

      const excluded = isOperational
        ? cfg.operationalExcluded || cfg.displayExcluded
        : cfg.displayExcluded;

      if (excluded) {
        kids.forEach(c => renderNode(c, level));
        return;
      }

      const act = valMonthAct[acct] || 0;
      const bud = valMonthBud[acct] || 0;
      const ytdA = valYtdAct[acct] || 0;
      const ytdB = valYtdBud[acct] || 0;

      if (Math.abs(act + ytdA) < 0.0001) return;

      kids.forEach(c => renderNode(c, level + 1));

      // Add double lines (border top and bottom) if the account has doubleLines enabled
      // Only apply to number columns, not the account name column or gap column
      const borderStyle = cfg.doubleLines 
        ? 'border-top: 1px solid black; border-bottom: 1px solid black;' 
        : '';
      
      // Bold if account has children OR is a top-level section account
      const shouldBold = kids.length > 0 || sectionAccounts.has(acct);

      // Calculate percentages using Income total for all rows
      const pctMonthAct = incomeTotals.act ? (act / incomeTotals.act * 100) : null;
      const pctMonthBud = incomeTotals.bud ? (bud / incomeTotals.bud * 100) : null;
      const pctYtdAct = incomeTotals.ytdAct ? (ytdA / incomeTotals.ytdAct * 100) : null;
      const pctYtdBud = incomeTotals.ytdBud ? (ytdB / incomeTotals.ytdBud * 100) : null;

      rowsHtml += `
        <tr style="font-weight:${shouldBold ? 600 : 400}">
          <td style="padding-left:${INDENT * level}px">${acct}</td>
          <td style="text-align:right; ${borderStyle}">${fmt(act)}</td>
          <td style="text-align:right; ${borderStyle}">${fmtPct(pctMonthAct)}</td>
          <td style="text-align:right; ${borderStyle}">${fmt(bud)}</td>
          <td style="text-align:right; ${borderStyle}">${fmtPct(pctMonthBud)}</td>
          <td style="text-align:right; ${borderStyle}">${fmt(act - bud)}</td>
          <td></td>
          <td style="text-align:right; ${borderStyle}">${fmt(ytdA)}</td>
          <td style="text-align:right; ${borderStyle}">${fmtPct(pctYtdAct)}</td>
          <td style="text-align:right; ${borderStyle}">${fmt(ytdB)}</td>
          <td style="text-align:right; ${borderStyle}">${fmtPct(pctYtdBud)}</td>
          <td style="text-align:right; ${borderStyle}">${fmt(ytdA - ytdB)}</td>
        </tr>
      `;
    }
  
    for (const section of Object.keys(sectionConfig)) {
      const accts = sectionConfig[section];
  
      rowsHtml += `
        <tr><td colspan="12" style="font-weight:700; text-decoration:underline; text-transform:uppercase;">${section}</td></tr>
      `;
      accts.forEach(a => renderNode(a, 1));
    }
  
    return {
      noRevenue: false,
      html: `
        <div class="report-container page-break">
          ${headerHtml}
          <hr class="divider">
          <table class="report-table">
            <thead>
              <tr style="font-weight:700; border-bottom: 1px solid black;">
                <th style="text-align:left;"></th>
                <th style="text-align:right;">Actual</th>
                <th style="text-align:right;">%</th>
                <th style="text-align:right;">Budget</th>
                <th style="text-align:right;">%</th>
                <th style="text-align:right;">Act v Bud</th>
                <th></th>
                <th style="text-align:right;">Actual</th>
                <th style="text-align:right;">%</th>
                <th style="text-align:right;">Budget</th>
                <th style="text-align:right;">%</th>
                <th style="text-align:right;">Act v Bud</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `
    };
  }
  
  window.generatePNLHTML = generatePNLHTML;
  return "PNL template loaded";
  