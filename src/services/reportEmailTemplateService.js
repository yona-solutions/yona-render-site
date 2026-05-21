function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitNameParts(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : ''
  };
}

function normalizeRecipientContact(recipient) {
  if (typeof recipient === 'string') {
    return {
      email: recipient.trim(),
      name: '',
      firstName: '',
      lastName: ''
    };
  }

  const email = String(recipient?.email || '').trim();
  const name = String(recipient?.name || '').trim();
  const providedFirstName = String(recipient?.firstName || recipient?.first_name || '').trim();
  const providedLastName = String(recipient?.lastName || recipient?.last_name || '').trim();
  const derivedNames = (!providedFirstName || !providedLastName) && name
    ? splitNameParts(name)
    : { firstName: '', lastName: '' };

  const firstName = providedFirstName || derivedNames.firstName;
  const lastName = providedLastName || derivedNames.lastName;
  const fullName = name || [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    email,
    name: fullName,
    firstName,
    lastName
  };
}

function stripScheduleIndex(name = '') {
  return String(name || '').trim().replace(/^\(\d+\)\s*/, '').trim();
}

function stripLegalSuffix(name = '') {
  return String(name || '')
    .trim()
    .replace(/,\s*LLC$/i, '')
    .replace(/\s+LLC$/i, '')
    .trim();
}

function parseDistrictLabel(label = '') {
  const cleaned = stripScheduleIndex(label);
  const match = cleaned.match(/^(District\s+\d+)\s*-\s*(.+)$/i);

  if (match) {
    return {
      districtNumber: match[1].trim(),
      districtManager: match[2].trim()
    };
  }

  return {
    districtNumber: cleaned,
    districtManager: cleaned
  };
}

function getMonthDateParts(reportDate) {
  const normalizedDate = String(reportDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!normalizedDate) {
    return {
      monthName: String(reportDate || '').trim(),
      year: ''
    };
  }

  const [, year, month] = normalizedDate;
  const utcDate = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, 1));

  return {
    monthName: utcDate.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
    year
  };
}

function formatMonthYear(reportDate) {
  const { monthName, year } = getMonthDateParts(reportDate);
  return [monthName, year].filter(Boolean).join(' ').trim();
}

function formatMonthOnly(reportDate) {
  return getMonthDateParts(reportDate).monthName;
}

function getPrimaryReport(schedule = {}) {
  return Array.isArray(schedule.reports) && schedule.reports.length > 0
    ? schedule.reports[0]
    : schedule;
}

function normalizeEmailTemplateType(value) {
  const normalized = String(value || '').trim().toLowerCase();

  switch (normalized) {
    case 'district':
      return 'district';
    case 'region':
      return 'region';
    case 'multiple_districts':
    case 'multi_district':
    case 'multi_districts':
      return 'multiple_districts';
    case 'subsidiary_dietary':
    case 'subsidiary_dietary_only':
      return 'subsidiary_dietary';
    case 'subsidiary':
    case 'subsidiary_all':
      return 'subsidiary';
    default:
      return null;
  }
}

function getReportGroupKind(schedule = {}) {
  return normalizeEmailTemplateType(schedule?.email_template_type);
}

function getScheduleFieldValue(schedule = {}, fieldName) {
  const primaryReport = getPrimaryReport(schedule);
  return String(
    primaryReport?.[fieldName]
      || schedule?.[fieldName]
      || ''
  ).trim();
}

function getRegionName(schedule = {}) {
  return getScheduleFieldValue(schedule, 'region_name') || '';
}

function getEntityName(schedule = {}) {
  const scheduleName = stripScheduleIndex(schedule?.name || schedule?.template_name || '');
  const subsidiaryMatch = scheduleName.match(/^(.*?)\s*-\s*Subsidiary\s*\((Dietary Only|All)\)$/i);
  if (subsidiaryMatch) {
    return subsidiaryMatch[1].trim();
  }

  const multiDistrictMatch = scheduleName.match(/^(.*?)\s+Multi-District Packet\b/i);
  if (multiDistrictMatch) {
    return multiDistrictMatch[1].trim();
  }

  if (scheduleName && !/^District\s+\d+/i.test(scheduleName)) {
    return scheduleName;
  }

  const primaryReport = getPrimaryReport(schedule);
  const fallbackName = primaryReport?.region_name
    || schedule?.region_name
    || primaryReport?.header_subsidiary_name
    || primaryReport?.subsidiary_name
    || schedule?.header_subsidiary_name
    || schedule?.subsidiary_name
    || '';

  return stripLegalSuffix(fallbackName);
}

function buildEmailDocument(paragraphs = []) {
  const body = paragraphs.map(paragraph => `<p>${paragraph}</p>`).join('\n');
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
      </style>
    </head>
    <body>
      ${body}
    </body>
    </html>
  `;
}

function buildReportEmailMessage(schedule, recipient, reportDate) {
  const normalizedRecipient = normalizeRecipientContact(recipient);
  const reportGroupKind = getReportGroupKind(schedule);
  if (!reportGroupKind) {
    throw new Error('Email template type is required on the report group');
  }
  const monthYear = formatMonthYear(reportDate);
  const monthOnly = formatMonthOnly(reportDate);
  const greetingName = normalizedRecipient.firstName || normalizedRecipient.name || 'there';
  const primaryReport = getPrimaryReport(schedule);
  const { districtManager } = parseDistrictLabel(
    primaryReport?.district_name
      || primaryReport?.template_name
      || schedule?.district_name
      || schedule?.template_name
      || ''
  );
  const regionName = getRegionName(schedule) || getEntityName(schedule) || 'Region';
  const entityName = getEntityName(schedule) || 'Yona';

  let subject;
  let secondParagraph;
  let secondParagraphText;

  switch (reportGroupKind) {
    case 'district':
      subject = `${monthYear} Financial Reports - ${districtManager}`;
      secondParagraph = `Attached are the ${escapeHtml(monthOnly)} Financial Reports for your District.`;
      secondParagraphText = `Attached are the ${monthOnly} Financial Reports for your District.`;
      break;
    case 'region':
      subject = `${monthYear} Financial Reports - ${regionName}`;
      secondParagraph = `Attached are the ${escapeHtml(monthOnly)} Financial Reports for ${escapeHtml(regionName)}.`;
      secondParagraphText = `Attached are the ${monthOnly} Financial Reports for ${regionName}.`;
      break;
    case 'multiple_districts':
      subject = `${monthYear} Financial Reports - ${entityName}`;
      secondParagraph = `Attached are the ${escapeHtml(monthOnly)} Financial Reports for ${escapeHtml(entityName)}.`;
      secondParagraphText = `Attached are the ${monthOnly} Financial Reports for ${entityName}.`;
      break;
    case 'subsidiary_dietary':
      subject = `${monthYear} Financial Reports - ${entityName} (Dietary)`;
      secondParagraph = `Attached are the ${escapeHtml(monthOnly)} Financial Reports for all ${escapeHtml(entityName)} dietary accounts.`;
      secondParagraphText = `Attached are the ${monthOnly} Financial Reports for all ${entityName} dietary accounts.`;
      break;
    case 'subsidiary':
      subject = `${monthYear} Financial Reports - ${entityName}`;
      secondParagraph = `Attached are the ${escapeHtml(monthOnly)} Financial Reports for ${escapeHtml(entityName)}.`;
      secondParagraphText = `Attached are the ${monthOnly} Financial Reports for ${entityName}.`;
      break;
    default:
      subject = `${monthYear} Financial Reports - ${entityName}`;
      secondParagraph = `Attached are the ${escapeHtml(monthOnly)} Financial Reports.`;
      secondParagraphText = `Attached are the ${monthOnly} Financial Reports.`;
      break;
  }

  const htmlParagraphs = [
    `Hi ${escapeHtml(greetingName)},`,
    secondParagraph,
    'Please let us know of any questions.',
    'Thank you,<br>Yona Finance Team'
  ];

  const textParagraphs = [
    `Hi ${greetingName},`,
    secondParagraphText,
    'Please let us know of any questions.',
    'Thank you,\nYona Finance Team'
  ];

  return {
    kind: reportGroupKind,
    subject,
    html: buildEmailDocument(htmlParagraphs),
    text: textParagraphs.join('\n\n')
  };
}

function buildAttachmentFilename(schedule, reportDate, reportOverride = null) {
  const reportGroupKind = getReportGroupKind(schedule);
  if (!reportGroupKind && !reportOverride) {
    throw new Error('Email template type is required on the report group');
  }
  const monthYear = formatMonthYear(reportDate);

  if (reportGroupKind === 'multiple_districts' || (reportOverride && reportOverride.template_type === 'district')) {
    const sourceReport = reportOverride || getPrimaryReport(schedule);
    const { districtNumber, districtManager } = parseDistrictLabel(
      sourceReport?.district_name
        || sourceReport?.template_name
        || schedule?.district_name
        || schedule?.template_name
        || ''
    );
    return `${districtNumber} - ${districtManager} (${monthYear}).pdf`;
  }

  if (reportGroupKind === 'district') {
    const sourceReport = reportOverride || getPrimaryReport(schedule);
    const { districtNumber, districtManager } = parseDistrictLabel(
      sourceReport?.district_name
        || sourceReport?.template_name
        || schedule?.district_name
        || schedule?.template_name
        || ''
    );
    return `${districtNumber} - ${districtManager} (${monthYear}).pdf`;
  }

  if (reportGroupKind === 'region' || (reportOverride && reportOverride.template_type === 'region')) {
    const regionName = getRegionName(reportOverride || schedule) || getEntityName(schedule) || 'Region';
    return `${regionName} (${monthYear}).pdf`;
  }

  const entityName = getEntityName(schedule) || stripScheduleIndex(schedule?.name || schedule?.template_name || 'Report');

  if (reportGroupKind === 'subsidiary_dietary') {
    return `${entityName} Dietary Accounts (${monthYear}).pdf`;
  }

  if (reportGroupKind === 'subsidiary') {
    return `${entityName} (${monthYear}).pdf`;
  }

  const fallbackName = stripScheduleIndex(
    reportOverride?.template_name
      || schedule?.name
      || schedule?.template_name
      || 'Report'
  );
  return `${fallbackName} (${monthYear}).pdf`;
}

module.exports = {
  buildAttachmentFilename,
  buildReportEmailMessage,
  formatMonthOnly,
  formatMonthYear,
  getEntityName,
  getReportGroupKind,
  normalizeRecipientContact,
  normalizeEmailTemplateType,
  parseDistrictLabel,
  splitNameParts,
  stripScheduleIndex
};
