const emailConfigService = require('./emailConfigService');
const mockEmailData = require('./mockEmailData');
const { buildSchedulePnlDataUrl } = require('../utils/schedulePnlRequest');
const pnlPdfServer = require('../utils/pnlPdfServer');

function getScheduleEntity(schedule) {
  if (schedule.template_type === 'district' && schedule.district_id) {
    return {
      entityId: schedule.district_id,
      entityName: schedule.district_name || 'District'
    };
  }

  if (schedule.template_type === 'region' && schedule.region_id) {
    return {
      entityId: schedule.region_id,
      entityName: schedule.region_name || 'Region'
    };
  }

  if (schedule.template_type === 'subsidiary' && schedule.subsidiary_id) {
    return {
      entityId: schedule.subsidiary_id,
      entityName: schedule.subsidiary_name || 'Subsidiary'
    };
  }

  throw new Error(`Please select a ${schedule.template_type} before generating the report`);
}

function getScheduleEmailGroupIds(schedule) {
  return schedule.email_group_ids || [schedule.email_group_id].filter(Boolean);
}

function getInternalApiHeaders() {
  return process.env.SCHEDULER_API_KEY
    ? { 'X-API-Key': process.env.SCHEDULER_API_KEY }
    : {};
}

function normalizeReportDateValue(value) {
  if (!value) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const textValue = String(value).trim();
  const match = textValue.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : textValue;
}

function getApplicationBaseUrl() {
  return process.env.NODE_ENV === 'production'
    ? (process.env.REPORT_BATCH_RUNNER_URL || process.env.RENDER_EXTERNAL_URL || 'https://yona-render-site.onrender.com')
    : `http://127.0.0.1:${process.env.PORT || 3000}`;
}

async function resolveReportDate(providedReportDate, bigQueryService) {
  if (providedReportDate) {
    return normalizeReportDateValue(providedReportDate);
  }

  if (bigQueryService) {
    const dates = await bigQueryService.getAvailableDates();
    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      throw new Error('No P&L data available');
    }

    return dates[0].time || dates[0].formatted;
  }

  const datesResponse = await fetch(`${getApplicationBaseUrl()}/api/pl/dates`, {
    headers: getInternalApiHeaders()
  });

  if (!datesResponse.ok) {
    const errorText = await datesResponse.text();
    throw new Error(`Failed to fetch dates: ${datesResponse.status} ${errorText}`);
  }

  const dates = await datesResponse.json();
  if (!dates || !Array.isArray(dates) || dates.length === 0) {
    throw new Error('No P&L data available');
  }

  return dates[0].time || dates[0].formatted;
}

async function fetchScheduleReportHtml(schedule, { entityId, reportDate, baseUrl = getApplicationBaseUrl() } = {}) {
  const dataUrl = buildSchedulePnlDataUrl(baseUrl, schedule, { entityId, reportDate });
  const response = await fetch(dataUrl, { headers: getInternalApiHeaders() });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = errorText;
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.message || parsed.error || errorText;
    } catch (error) {
      // Keep raw response text.
    }
    throw new Error(`Failed to fetch P&L data: ${response.status} - ${detail}`);
  }

  const jsonData = await response.json();
  const htmlContent = jsonData.html;
  if (!htmlContent || !htmlContent.trim()) {
    throw new Error('No report data available');
  }

  return htmlContent;
}

async function generateSchedulePdf(schedule, { reportDate, bigQueryService, pdfRowHeight } = {}) {
  const { entityId, entityName } = getScheduleEntity(schedule);
  const resolvedReportDate = await resolveReportDate(reportDate, bigQueryService);
  const htmlContent = await fetchScheduleReportHtml(schedule, {
    entityId,
    reportDate: normalizeReportDateValue(resolvedReportDate)
  });

  const { pdfBuffer, prepared } = await pnlPdfServer.generatePdfBufferFromReportHtml(htmlContent, {
    pdfRowHeight
  });

  return {
    entityId,
    entityName,
    reportDate: resolvedReportDate,
    htmlContent,
    pdfBuffer,
    preparedReport: prepared
  };
}

async function getScheduleRecipients(schedule) {
  const groupIds = getScheduleEmailGroupIds(schedule);
  const allRecipients = new Set();

  for (const groupId of groupIds) {
    const contacts = emailConfigService.isAvailable()
      ? await emailConfigService.getEmailGroupContacts(groupId)
      : mockEmailData.getMockEmailGroupContacts(groupId);
    contacts.forEach(contact => {
      if (contact?.email) {
        allRecipients.add(contact.email);
      }
    });
  }

  return Array.from(allRecipients);
}

module.exports = {
  getScheduleEntity,
  getScheduleEmailGroupIds,
  getInternalApiHeaders,
  getApplicationBaseUrl,
  normalizeReportDateValue,
  resolveReportDate,
  fetchScheduleReportHtml,
  generateSchedulePdf,
  getScheduleRecipients
};
