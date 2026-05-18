(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.pnlPdf = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PDFSHIFT_URL = 'https://api.pdfshift.io/v3/convert/pdf';
  const PDFSHIFT_API_KEY = (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.PDFSHIFT_API_KEY
  ) || 'sk_3df748acf1ce265988e07e04544b6452ece1b20e';

  function parseAccountingToNumber(text) {
    if (!text) return 0;
    const t = String(text).trim();
    if (t === '-' || t === '') return 0;
    const neg = /^\(.*\)$/.test(t);
    const cleaned = t.replace(/[(),]/g, '');
    const n = parseFloat(cleaned);
    if (isNaN(n)) return 0;
    return neg ? -n : n;
  }

  function hasNonZeroIncome(containerEl) {
    const table = containerEl.querySelector('.pnl-report-table');
    if (!table) return false;
    const rows = table.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td,th');
      if (!cells.length) continue;

      const label = (cells[0].textContent || '').trim();
      if (label === 'Net Income') {
        const currentMonthCell = cells[1];
        const ytdCell = cells[7];
        const monthValue = parseAccountingToNumber(currentMonthCell?.textContent || '');
        const ytdValue = parseAccountingToNumber(ytdCell?.textContent || '');
        return Math.abs(monthValue) > 0.0001 || Math.abs(ytdValue) > 0.0001;
      }
    }

    return false;
  }

  function createHtmlDocument(htmlContent) {
    const markup = `<div id="root">${htmlContent}</div>`;

    if (typeof DOMParser !== 'undefined') {
      return new DOMParser().parseFromString(markup, 'text/html');
    }

    const { JSDOM } = require('jsdom');
    return new JSDOM(markup).window.document;
  }

  function removeInlineStyleDeclaration(styleText, propertyName) {
    const pattern = new RegExp(`${propertyName}\\s*:\\s*[^;]+;?\\s*`, 'gi');
    return String(styleText || '')
      .replace(pattern, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function isSectionHeaderRow(row) {
    return Boolean(row && row.classList && row.classList.contains('section-header-row'));
  }

  function isAccountReport(container) {
    if (!container) return false;
    const headerText = (container.querySelector('.pnl-report-header')?.textContent || '').replace(/\s+/g, ' ');
    return headerText.includes('Report Type: Account');
  }

  function estimateWrappedLineCount(text, charactersPerLine = 28) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return 1;
    return Math.max(1, Math.ceil(cleaned.length / charactersPerLine));
  }

  function estimateRowUnits(row) {
    if (!row) return 0;
    if (isSectionHeaderRow(row)) return 1.6;

    const firstCell = row.querySelector('td:first-child, th:first-child');
    const labelText = (firstCell?.textContent || '').replace(/\s+/g, ' ').trim();
    const wrappedLines = estimateWrappedLineCount(labelText, 32);
    let units = Math.max(1, Math.min(2.4, 0.95 + ((wrappedLines - 1) * 0.65)));

    if (row.querySelector('td[style*="border-top"], td[style*="border-bottom"]')) {
      units += 0.15;
    }

    return units;
  }

  function getPageCapacityUnits(rowHeight, includeReportHeader, options = {}) {
    const scale = 12.5 / rowHeight;
    const baseUnits = includeReportHeader ? 72 : 72;
    const minimumUnits = includeReportHeader ? 40 : 45;
    return Math.max(minimumUnits, baseUnits * scale);
  }

  function ensureTableHead(doc, table) {
    if (!doc || !table) return null;
    let thead = table.querySelector('thead');
    if (thead) return thead;

    thead = doc.createElement('thead');
    table.insertBefore(thead, table.firstChild);
    return thead;
  }

  function ensurePdfColumnGroup(doc, table) {
    if (!doc || !table) return null;

    let colgroup = table.querySelector('colgroup');
    if (colgroup) return colgroup;

    const widths = [
      '30.5%',
      '8%',
      '4.75%',
      '8%',
      '4.75%',
      '8.5%',
      '1.5%',
      '8%',
      '4.75%',
      '8%',
      '4.75%',
      '8.5%'
    ];

    colgroup = doc.createElement('colgroup');
    widths.forEach(width => {
      const col = doc.createElement('col');
      col.style.width = width;
      colgroup.appendChild(col);
    });

    table.insertBefore(colgroup, table.firstChild);
    return colgroup;
  }

  function prependReportHeaderRows(doc, table, sourceContainer) {
    if (!doc || !table || !sourceContainer) return;

    const reportHeader = sourceContainer.querySelector('.pnl-report-header');
    const divider = sourceContainer.querySelector('.pnl-divider');
    if (!reportHeader && !divider) return;

    const thead = ensureTableHead(doc, table);
    if (!thead) return;

    const headerRow = doc.createElement('tr');
    headerRow.className = 'pnl-report-inline-header-row';
    const headerCell = doc.createElement('th');
    headerCell.colSpan = 12;

    if (reportHeader) {
      headerCell.appendChild(reportHeader.cloneNode(true));
    }
    if (divider) {
      headerCell.appendChild(divider.cloneNode(true));
    }

    headerRow.appendChild(headerCell);
    thead.insertBefore(headerRow, thead.firstChild);
  }

  function serializeContainerForPdf(doc, sourceContainer, includeReportHeader = true) {
    const container = sourceContainer.cloneNode(true);
    const table = container.querySelector('.pnl-report-table');

    container.querySelectorAll('.pnl-report-header, .pnl-divider').forEach(el => el.remove());

    if (includeReportHeader && table) {
      ensurePdfColumnGroup(doc, table);
      prependReportHeaderRows(doc, table, sourceContainer);
    }

    return container.outerHTML;
  }

  function restoreLeadingSubtotalBorderTop(tbody) {
    if (!tbody) return;
    const firstRow = tbody.querySelector('tr:first-child');
    if (!firstRow || !firstRow.classList.contains('pnl-subtotal-row')) return;

    firstRow.querySelectorAll('td[data-pdf-border-top]').forEach(cell => {
      const saved = cell.getAttribute('data-pdf-border-top');
      if (!saved) return;
      const existing = cell.getAttribute('style') || '';
      cell.setAttribute('style', (saved + '; ' + existing).replace(/;\s*$/, '').trim());
    });
  }

  function buildPaginatedContainerHtml(doc, sourceContainer, sourceTable, pageRows, includeReportHeader) {
    const pageContainer = doc.createElement('div');
    pageContainer.setAttribute('class', sourceContainer.getAttribute('class') || 'pnl-report-container page-break');

    if (!includeReportHeader) {
      pageContainer.classList.add('pnl-report-continuation');
    }

    const pageTable = sourceTable.cloneNode(false);
    const thead = sourceTable.querySelector('thead');
    const pageTbody = doc.createElement('tbody');

    ensurePdfColumnGroup(doc, pageTable);

    if (thead) {
      pageTable.appendChild(thead.cloneNode(true));
    }

    if (includeReportHeader) {
      prependReportHeaderRows(doc, pageTable, sourceContainer);
    }

    pageRows.forEach(row => pageTbody.appendChild(row));
    restoreLeadingSubtotalBorderTop(pageTbody);

    pageTable.appendChild(pageTbody);
    pageContainer.appendChild(pageTable);

    return pageContainer.outerHTML;
  }

  function paginateReportContainer(doc, container, options = {}) {
    const table = container.querySelector('.pnl-report-table');
    const tbody = table?.querySelector('tbody');

    if (!table || !tbody) {
      return [container.outerHTML];
    }

    const sourceRows = Array.from(tbody.querySelectorAll(':scope > tr'));
    if (!sourceRows.length) {
      return [container.outerHTML];
    }

    const rowHeight = resolvePdfRowHeight(options);
    const accountReport = isAccountReport(container);
    const firstPageLimit = getPageCapacityUnits(rowHeight, true, { isAccountReport: accountReport });
    const continuationPageLimit = getPageCapacityUnits(rowHeight, false, { isAccountReport: accountReport });
    const totalUnits = sourceRows.reduce((sum, row) => sum + estimateRowUnits(row), 0);

    if (totalUnits <= firstPageLimit) {
      return [container.outerHTML];
    }

    const paginatedHtml = [];
    let currentPageRows = [];
    let currentCapacity = firstPageLimit;
    let currentUsedUnits = 0;
    let isFirstPage = true;

    function flushPage() {
      if (!currentPageRows.length) return;

      paginatedHtml.push(
        buildPaginatedContainerHtml(doc, container, table, currentPageRows, isFirstPage)
      );

      isFirstPage = false;
      currentPageRows = [];
      currentCapacity = continuationPageLimit;
      currentUsedUnits = 0;
    }

    function addRow(row) {
      currentPageRows.push(row.cloneNode(true));
      currentUsedUnits += estimateRowUnits(row);
    }

    sourceRows.forEach((row, index) => {
      const rowUnits = estimateRowUnits(row);
      const nextRow = sourceRows[index + 1] || null;

      // Keep a section header with at least one following detail row when possible.
      if (isSectionHeaderRow(row) && nextRow && currentPageRows.length > 0) {
        const sectionBlockUnits = rowUnits + estimateRowUnits(nextRow);
        if (currentUsedUnits + sectionBlockUnits > currentCapacity) {
          flushPage();
        }
      }

      if (currentPageRows.length > 0 && currentUsedUnits + rowUnits > currentCapacity) {
        flushPage();
      }

      addRow(row);
    });

    flushPage();

    return paginatedHtml.length ? paginatedHtml : [container.outerHTML];
  }

  function canMeasureLayout() {
    return typeof window !== 'undefined'
      && typeof document !== 'undefined'
      && typeof document.createElement === 'function';
  }

  function getMeasuredPageDimensions() {
    const pageHeightPx = 11 * 96;
    const pdfshiftHorizontalMarginPx = 40;
    const footerHeightPx = 10;
    const bodyHorizontalPaddingPx = 40;
    const bottomPageMarginPx = 0;

    return {
      viewportWidthPx: (8.5 * 96) - pdfshiftHorizontalMarginPx,
      pageContentHeightPx: pageHeightPx - footerHeightPx - bottomPageMarginPx,
      bodyHorizontalPaddingPx
    };
  }

  function createMeasurementContext(options = {}) {
    if (!canMeasureLayout()) return null;

    const { viewportWidthPx, pageContentHeightPx } = getMeasuredPageDimensions();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.position = 'absolute';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = `${viewportWidthPx}px`;
    iframe.style.height = `${Math.ceil(11 * 96)}px`;
    iframe.style.visibility = 'hidden';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';

    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      iframe.remove();
      return null;
    }

    const shellHtml = `
      <div id="measure-shell" style="height:${pageContentHeightPx}px; overflow:hidden;">
        <div id="measure-target"></div>
      </div>
    `;

    iframeDoc.open();
    iframeDoc.write(buildPdfHtml(shellHtml, options));
    iframeDoc.close();

    const measureShell = iframeDoc.getElementById('measure-shell');
    const measureTarget = iframeDoc.getElementById('measure-target');
    if (!measureShell || !measureTarget) {
      iframe.remove();
      return null;
    }

    return {
      fitsHtml(html) {
        measureTarget.innerHTML = html;
        return measureShell.scrollHeight <= (measureShell.clientHeight + 1);
      },
      cleanup() {
        iframe.remove();
      }
    };
  }

  function paginateReportContainerMeasured(doc, container, options = {}, measureContext) {
    const table = container.querySelector('.pnl-report-table');
    const tbody = table?.querySelector('tbody');

    if (!table || !tbody || !measureContext) {
      return paginateReportContainer(doc, container, options);
    }

    const sourceRows = Array.from(tbody.querySelectorAll(':scope > tr'));
    if (!sourceRows.length) {
      return [serializeContainerForPdf(doc, container, true)];
    }

    const fullHtml = serializeContainerForPdf(doc, container, true);
    if (measureContext.fitsHtml(fullHtml)) {
      return [fullHtml];
    }

    const paginatedHtml = [];
    let currentPageRows = [];
    let includeReportHeader = true;

    function buildCandidateHtml(candidateRows) {
      return buildPaginatedContainerHtml(doc, container, table, candidateRows, includeReportHeader);
    }

    function flushPage() {
      if (!currentPageRows.length) return;
      paginatedHtml.push(buildCandidateHtml(currentPageRows));
      currentPageRows = [];
      includeReportHeader = false;
    }

    function addRow(row) {
      currentPageRows.push(row.cloneNode(true));
    }

    sourceRows.forEach((row, index) => {
      const nextRow = sourceRows[index + 1] || null;

      if (isSectionHeaderRow(row) && nextRow && currentPageRows.length > 0) {
        const sectionCandidate = [
          ...currentPageRows,
          row.cloneNode(true),
          nextRow.cloneNode(true)
        ];
        if (!measureContext.fitsHtml(buildCandidateHtml(sectionCandidate))) {
          flushPage();
        }
      }

      const rowCandidate = [...currentPageRows, row.cloneNode(true)];
      if (currentPageRows.length > 0 && !measureContext.fitsHtml(buildCandidateHtml(rowCandidate))) {
        flushPage();
      }

      addRow(row);
    });

    flushPage();

    return paginatedHtml.length ? paginatedHtml : [fullHtml];
  }

  function prepareReportHtml(htmlContent, options = {}) {
    const doc = createHtmlDocument(htmlContent);
    const rootEl = doc.getElementById('root');
    const useMeasuredPagination = options.useMeasuredPagination === true
      || (typeof window !== 'undefined' && window.__pnlPdfUseMeasuredPagination === true);
    const measureContext = useMeasuredPagination ? createMeasurementContext(options) : null;

    rootEl.querySelectorAll('.page-break:not(.pnl-report-container)').forEach(el => el.remove());

    const kept = [];
    let keptReportCount = 0;
    const originalContainers = Array.from(rootEl.querySelectorAll('.pnl-report-container'));

    try {
      originalContainers.forEach(container => {
        const table = container.querySelector('.pnl-report-table');
        if (!table) {
          if (hasNonZeroIncome(container)) {
            kept.push(container.outerHTML);
            keptReportCount += 1;
          }
          return;
        }

        // With separate borders for PDF page-break handling, adjacent subtotal rows can
        // render as doubled/thicker lines. Remove the top border from a subtotal row
        // when the previous row is also a subtotal row, so the shared edge stays single.
        let previousWasDoubleLine = false;
        table.querySelectorAll('tbody tr').forEach(row => {
          const currentHasDoubleLine = Boolean(row.querySelector('td[style*="border-top"]'));

          if (currentHasDoubleLine) {
            row.classList.add('pnl-subtotal-row');
          }

          if (currentHasDoubleLine && previousWasDoubleLine) {
            row.querySelectorAll('td[style*="border-top"]').forEach(cell => {
              const styleAttr = cell.getAttribute('style') || '';
              const match = styleAttr.match(/border-top\s*:[^;]*/i);
              if (match) {
                cell.setAttribute('data-pdf-border-top', match[0]);
              }
              const cleanedStyle = removeInlineStyleDeclaration(styleAttr, 'border-top');
              if (cleanedStyle) {
                cell.setAttribute('style', cleanedStyle);
              } else {
                cell.removeAttribute('style');
              }
            });
          }

          previousWasDoubleLine = currentHasDoubleLine;
        });

        if (!hasNonZeroIncome(container)) {
          return;
        }

        const paginated = measureContext
          ? paginateReportContainerMeasured(doc, container, options, measureContext)
          : paginateReportContainer(doc, container, options);

        if (paginated.length === 1 && paginated[0] === container.outerHTML) {
          kept.push(serializeContainerForPdf(doc, container, true));
        } else {
          kept.push(...paginated);
        }
        keptReportCount += 1;
      });
    } finally {
      if (measureContext) {
        measureContext.cleanup();
      }
    }

    const filteredHtmlContent = kept.length
      ? kept.join('\n')
      : (originalContainers[0]?.outerHTML || htmlContent);

    return {
      html: filteredHtmlContent,
      keptCount: keptReportCount
    };
  }

  function resolvePdfRowHeight(options = {}) {
    const value = options.pdfRowHeight
      || (typeof window !== 'undefined' ? window.pdfRowHeight : undefined)
      || (typeof globalThis !== 'undefined' ? globalThis.pdfRowHeight : undefined)
      || 12.5;

    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 12.5;
  }

  function buildPdfHtml(content, options = {}) {
    const rowH = resolvePdfRowHeight(options);
    const tblFont = (rowH * 8.5 / 12.5).toFixed(2);
    const debugLayout = false;
    const debugBanner = debugLayout ? '<div class="pdf-debug-top"></div>' : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      box-sizing: border-box;
    }

    @page {
      size: letter portrait;
      margin: 0;
    }

    body {
      margin: 0;
      padding: 0 20px;
      background: #ffffff;
    }

    .pnl-report-container {
      background: #ffffff;
      font-family: Arial, sans-serif;
      color: #000000;
      width: 100%;
      margin: 0 auto;
      margin-top: 0;
      padding: 4px 18px 0 18px;
      page-break-after: always;
    }

    .pnl-report-container:last-of-type {
      page-break-after: auto !important;
    }

    .pnl-report-header {
      text-align: center;
      margin-bottom: 4px;
      padding: 0;
      line-height: 1.2;
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
    }

    .pnl-report-header .pnl-title {
      font-weight: 700;
      font-size: 13px;
      margin: 0;
      line-height: 1.1;
    }

    .pnl-report-header .pnl-subtitle {
      font-weight: 700;
      font-size: 11px;
      margin: 1px 0 0 0;
      line-height: 1.1;
    }

    .pnl-report-header .pnl-meta,
    .pnl-report-header .meta {
      font-size: 8px;
      line-height: 1.2;
      margin: 0;
    }

    .pnl-header-row {
      display: flex;
      justify-content: center;
      align-items: baseline;
      gap: 4px;
      font-size: 8px;
      line-height: 1.2;
      margin: 0;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .pnl-header-row-secondary {
      font-weight: 700;
      font-size: 9px;
    }

    .pnl-header-item {
      white-space: nowrap;
    }

    .pnl-sep {
      margin: 0 4px;
    }

    .pnl-italic {
      font-style: italic;
    }

    .pnl-divider {
      border: none;
      border-top: 1px solid #ccc;
      margin: 4px 0 6px 0;
      page-break-after: avoid;
      break-after: avoid;
    }

    .pnl-report-table {
      width: 100%;
      margin: 0 auto;
      border-collapse: separate;
      border-spacing: 0;
      font-size: ${tblFont}px;
      background: #ffffff;
      table-layout: fixed;
      page-break-before: avoid;
      break-before: avoid;
    }

    .pnl-report-table thead {
      display: table-header-group;
    }

    .pnl-report-table tbody {
      display: table-row-group;
    }

    .pnl-report-table th,
    .pnl-report-table td {
      padding: 2px 2px;
      border: none;
      white-space: nowrap;
      line-height: 1.22;
      vertical-align: middle;
    }

    .pnl-report-table thead tr,
    .pnl-report-table thead th {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .pnl-report-table tbody td {
      height: ${rowH}px;
    }

    .pnl-report-table th {
      font-weight: 600;
      text-align: center;
      border-bottom: 1px solid #fff;
      background: transparent;
      font-size: ${tblFont}px;
    }

    .pnl-report-table th:not(:first-child) {
      text-align: center;
    }

    .pnl-report-table .header-group-row th {
      font-size: 9px;
      padding: 4px 2px;
      font-weight: 700;
    }

    .pnl-report-table .header-label-row th {
      font-size: 7px;
      padding: 2px;
      border-bottom: 1px solid #ddd;
    }

    .pnl-report-table .section-header-row td {
      height: auto;
      padding-top: 8px;
      padding-bottom: 3px;
    }

    .pnl-report-table .pnl-report-inline-header-row th {
      height: auto !important;
      padding: 0;
      border: none;
      background: transparent;
      text-align: center !important;
    }

    .pnl-report-table .pnl-report-inline-header-row .pnl-report-header {
      margin-bottom: 0;
      padding-bottom: 0;
    }

    .pnl-report-table .pnl-report-inline-header-row .pnl-divider {
      margin: 4px 0 6px 0;
    }

    .pnl-report-table td:first-child,
    .pnl-report-table th:first-child {
      text-align: left;
      white-space: normal;
      word-wrap: break-word;
      max-width: 140px;
      font-size: ${tblFont}px;
    }

    .pnl-report-table td:not(:first-child),
    .pnl-report-table th:not(:first-child) {
      text-align: right;
      font-size: ${tblFont}px;
    }

    .pnl-report-table td:empty:not(:nth-child(7))::after {
      content: "-";
      display: inline-block;
      text-align: center;
      width: 100%;
      color: #000;
      opacity: 0.8;
    }

    .pnl-report-table td {
      vertical-align: middle;
    }

    ${debugLayout ? `
    body { background: #f3f4f6; }
    .pdf-debug-top { height: 16px; background: #e5e7eb; border-bottom: 1px solid #d1d5db; }
    .pnl-report-container { outline: 1px dashed #f59e0b; }
    .pnl-report-header { background: #fef3c7; }
    ` : ''}

    .pnl-report-table td[style*="border-top"] {
      border-top-width: 0.5px !important;
    }

    .pnl-report-table td[style*="border-bottom"] {
      border-bottom-width: 0.5px !important;
    }

    @media print {
      .pnl-report-container {
        page-break-after: always;
      }
    }

  </style>
</head>
<body>
  ${debugBanner}
  ${content}
</body>
</html>`;
  }

  function buildPdfshiftOptions(fullHTML) {
    return {
      source: fullHTML,
      landscape: false,
      use_print: true,
      margin: { top: 0, bottom: 0, left: 20, right: 20 },
      footer: {
        source: '<div style="width:100%;text-align:center;font-size:7px;font-family:Arial,sans-serif;color:#aaa;padding-bottom:1px;">{{ page }}</div>',
        height: '10px'
      }
    };
  }

  async function requestPdfResponse(fullHTML) {
    const pdfshiftOptions = buildPdfshiftOptions(fullHTML);
    const response = await fetch(PDFSHIFT_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': PDFSHIFT_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pdfshiftOptions)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PDFShift API returned ${response.status}: ${errorText}`);
    }

    return response;
  }

  async function requestPdfBlob(fullHTML) {
    const response = await requestPdfResponse(fullHTML);
    return response.blob();
  }

  async function requestPdfBuffer(fullHTML) {
    const response = await requestPdfResponse(fullHTML);
    const arrayBuffer = await response.arrayBuffer();
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(arrayBuffer);
    }
    return new Uint8Array(arrayBuffer);
  }

  async function generatePdfBlobFromReportHtml(htmlContent, options = {}) {
    const prepared = prepareReportHtml(htmlContent, options);
    const fullHTML = buildPdfHtml(prepared.html, options);
    return requestPdfBlob(fullHTML);
  }

  async function generatePdfBufferFromReportHtml(htmlContent, options = {}) {
    const prepared = prepareReportHtml(htmlContent, options);
    const fullHTML = buildPdfHtml(prepared.html, options);
    const pdfBuffer = await requestPdfBuffer(fullHTML);

    return {
      pdfBuffer,
      prepared,
      fullHTML
    };
  }

  function sanitizeFilenamePart(value, fallback = 'report') {
    const cleaned = String(value || '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned || fallback;
  }

  function createDownloadFilename(baseName, suffix) {
    const safeBase = sanitizeFilenamePart(baseName, 'pnl_pdf_debug');
    const safeSuffix = String(suffix || '').replace(/^\.+/, '');
    return safeSuffix ? `${safeBase}.${safeSuffix}` : safeBase;
  }

  function countReportContainers(html) {
    const matches = String(html || '').match(/pnl-report-container/g);
    return matches ? matches.length : 0;
  }

  function normalizeDebugToggleValue(value) {
    if (value == null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
  }

  function isPdfDebugCaptureEnabled() {
    if (typeof window === 'undefined') return false;

    try {
      const params = new URLSearchParams(window.location.search || '');
      const queryFlag = normalizeDebugToggleValue(
        params.get('pnlPdfDebug') ?? params.get('pdfDebug')
      );
      if (queryFlag != null) {
        return queryFlag;
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse PDF debug query flag:', error);
    }

    try {
      const storedFlag = normalizeDebugToggleValue(
        window.localStorage?.getItem('pnlPdfDebugCapture')
      );
      return storedFlag === true;
    } catch (error) {
      console.warn('⚠️ Failed to read PDF debug capture setting:', error);
      return false;
    }
  }

  function setPdfDebugCaptureEnabled(enabled) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (enabled) {
      window.localStorage.setItem('pnlPdfDebugCapture', '1');
    } else {
      window.localStorage.removeItem('pnlPdfDebugCapture');
    }
  }

  function buildPdfDebugCapture(args = {}) {
    const {
      baseName,
      rawHtml,
      preparedReport,
      fullHTML,
      pdfshiftOptions,
      metadata = {}
    } = args;

    const rawReportHtml = String(rawHtml || '');
    const preparedHtml = String(preparedReport?.html || '');
    const composedHtml = String(fullHTML || '');
    const timestamp = new Date().toISOString();
    const debugBaseName = sanitizeFilenamePart(
      `${baseName || 'pnl_report'}_debug_${timestamp.replace(/[:.]/g, '-')}`,
      'pnl_pdf_debug'
    );
    const pdfshiftSummary = pdfshiftOptions
      ? {
          ...pdfshiftOptions,
          source: `[omitted: ${composedHtml.length} chars]`
        }
      : null;

    const manifest = {
      generatedAt: timestamp,
      debugBaseName,
      metadata,
      counts: {
        rawContainers: countReportContainers(rawReportHtml),
        preparedContainers: countReportContainers(preparedHtml),
        keptReportCount: preparedReport?.keptCount ?? null
      },
      lengths: {
        rawHtml: rawReportHtml.length,
        preparedHtml: preparedHtml.length,
        fullHtml: composedHtml.length
      },
      pdfshiftOptions: pdfshiftSummary
    };

    return {
      debugBaseName,
      manifest,
      files: [
        {
          filename: createDownloadFilename(debugBaseName, 'manifest.json'),
          content: JSON.stringify(manifest, null, 2),
          mimeType: 'application/json'
        },
        {
          filename: createDownloadFilename(debugBaseName, 'raw.html'),
          content: rawReportHtml,
          mimeType: 'text/html'
        },
        {
          filename: createDownloadFilename(debugBaseName, 'prepared.html'),
          content: preparedHtml,
          mimeType: 'text/html'
        },
        {
          filename: createDownloadFilename(debugBaseName, 'full.html'),
          content: composedHtml,
          mimeType: 'text/html'
        }
      ]
    };
  }

  function stashPdfDebugCapture(capture) {
    if (typeof window === 'undefined') return;
    window.__lastPnlPdfDebugCapture = capture;
  }

  function downloadText(content, filename, mimeType = 'text/plain') {
    if (typeof Blob === 'undefined') {
      throw new Error('Blob is unavailable in this environment');
    }
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    downloadBlob(blob, filename);
  }

  function capturePdfDebugArtifacts(args = {}) {
    const capture = buildPdfDebugCapture(args);
    stashPdfDebugCapture(capture);

    capture.files.forEach(file => {
      downloadText(file.content, file.filename, file.mimeType);
    });

    return capture;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }

  return {
    parseAccountingToNumber,
    hasNonZeroIncome,
    prepareReportHtml,
    buildPdfHtml,
    buildPdfshiftOptions,
    requestPdfBlob,
    requestPdfBuffer,
    generatePdfBlobFromReportHtml,
    generatePdfBufferFromReportHtml,
    isPdfDebugCaptureEnabled,
    setPdfDebugCaptureEnabled,
    buildPdfDebugCapture,
    capturePdfDebugArtifacts,
    downloadBlob,
    downloadText
  };
});
