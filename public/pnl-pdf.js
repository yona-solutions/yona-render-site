(function () {
  const PDFSHIFT_URL = 'https://api.pdfshift.io/v3/convert/pdf';
  const PDFSHIFT_API_KEY = 'sk_3df748acf1ce265988e07e04544b6452ece1b20e';

  function parseAccountingToNumber(text) {
    const t = String(text || '').trim();
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

  function prepareReportHtml(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="root">${htmlContent}</div>`, 'text/html');
    const root = doc.getElementById('root');

    root.querySelectorAll('.page-break:not(.pnl-report-container)').forEach(el => el.remove());

    const compactAccountThreshold = 40;
    root.querySelectorAll('.pnl-report-container').forEach(container => {
      const table = container.querySelector('.pnl-report-table');
      if (!table) return;
      const accountCount = table.querySelectorAll('tbody tr:not(.section-header-row)').length;
      if (accountCount >= compactAccountThreshold) {
        table.classList.add('pnl-compact-table');
      }
    });

    const kept = [];
    root.querySelectorAll('.pnl-report-container').forEach(container => {
      if (hasNonZeroIncome(container)) {
        kept.push(container.outerHTML);
      }
    });

    const filteredHtml = kept.length
      ? kept.join('\n')
      : (root.querySelector('.pnl-report-container')?.outerHTML || htmlContent);

    return {
      html: filteredHtml,
      keptCount: kept.length
    };
  }

  function buildPdfHtml(content, options = {}) {
    const rowH = options.pdfRowHeight || window.pdfRowHeight || 12.5;
    const tblFont = (rowH * 8.5 / 12.5).toFixed(2);
    const compactRowH = (rowH * 11 / 12.5).toFixed(2);
    const compactFont = (rowH * 7.25 / 12.5).toFixed(2);
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
      margin: 0 0 0.8in 0;
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
      padding: 4px 18px 10px 18px;
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
      border-collapse: collapse;
      font-size: ${tblFont}px;
      background: #ffffff;
      table-layout: auto;
      page-break-before: avoid;
      break-before: avoid;
    }

    .pnl-report-table th,
    .pnl-report-table td {
      padding: 2px 2px;
      border: none;
      white-space: nowrap;
      height: ${rowH}px;
      line-height: 1.22;
      vertical-align: middle;
    }

    .pnl-compact-table tbody td {
      padding: 1.25px 1px;
      height: ${compactRowH}px;
      line-height: 1.15;
      font-size: ${compactFont}px;
    }

    .pnl-compact-table tbody td:first-child {
      font-size: ${compactFont}px;
      max-width: 140px;
      white-space: nowrap;
    }

    .pnl-compact-table tbody .section-header-row td {
      padding-top: 4px;
      padding-bottom: 2px;
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
      padding-top: 8px;
      padding-bottom: 3px;
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
        source: '<div style="width:100%;text-align:center;font-size:8px;font-family:Arial,sans-serif;color:#aaa;padding-bottom:6px;">{{ page }}</div>',
        height: '20px'
      }
    };
  }

  async function requestPdfBlob(fullHTML) {
    const pdfshiftOptions = buildPdfshiftOptions(fullHTML);
    console.log('🔄 Calling PDFShift API...');
    console.log('🧪 PDFShift options:', pdfshiftOptions);
    console.log('🧪 PDF HTML length:', fullHTML.length);

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
      throw new Error('PDFShift API returned ' + response.status + ': ' + errorText);
    }

    return response.blob();
  }

  async function generatePdfBlobFromReportHtml(htmlContent, options = {}) {
    const prepared = prepareReportHtml(htmlContent);
    console.log(`📊 Filtered to ${prepared.keptCount} reports with non-zero net income`);
    const fullHTML = buildPdfHtml(prepared.html, options);
    return requestPdfBlob(fullHTML);
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

  window.pnlPdf = {
    parseAccountingToNumber,
    hasNonZeroIncome,
    prepareReportHtml,
    buildPdfHtml,
    buildPdfshiftOptions,
    requestPdfBlob,
    generatePdfBlobFromReportHtml,
    downloadBlob
  };
})();
