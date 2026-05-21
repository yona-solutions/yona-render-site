/**
 * Mock Email Configuration Data
 * 
 * Provides realistic mock data for email groups and report schedules
 * when DATABASE_URL is not configured. This allows testing the full
 * UI flow without requiring database setup.
 */

function splitMockNameParts(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || null,
    last_name: parts.length > 1 ? parts[parts.length - 1] : null
  };
}

function withMockNameParts(contact) {
  const parsedNames = splitMockNameParts(contact?.name);
  return {
    ...contact,
    first_name: contact?.first_name ?? parsedNames.first_name,
    last_name: contact?.last_name ?? parsedNames.last_name
  };
}

function normalizeMockContacts(input = []) {
  const contacts = Array.isArray(input) ? input : [];
  const seenEmails = new Set();
  const normalized = [];

  contacts.forEach(contact => {
    if (!contact) return;

    const value = typeof contact === 'string' ? { email: contact } : contact;
    const email = String(value.email || '').trim();
    if (!email) return;

    const dedupeKey = email.toLowerCase();
    if (seenEmails.has(dedupeKey)) return;
    seenEmails.add(dedupeKey);

    const name = String(value.name || '').trim();
    const firstName = String(value.first_name || value.firstName || '').trim();
    const lastName = String(value.last_name || value.lastName || '').trim();
    const derivedNames = (!firstName || !lastName) && name
      ? splitMockNameParts(name)
      : { first_name: null, last_name: null };
    const resolvedFirstName = firstName || derivedNames.first_name;
    const resolvedLastName = lastName || derivedNames.last_name;

    normalized.push({
      email,
      name: name || [resolvedFirstName, resolvedLastName].filter(Boolean).join(' ').trim() || null,
      first_name: resolvedFirstName || null,
      last_name: resolvedLastName || null
    });
  });

  return normalized;
}

function normalizeMockScheduleReport(report = {}, index = 0) {
  return {
    id: report.id || null,
    sort_order: Number.isFinite(report.sort_order) ? report.sort_order : index,
    template_name: report.template_name || '',
    template_type: report.template_type || '',
    process: report.process || '',
    apply_subsidiary_filter_to_detail: Boolean(report.apply_subsidiary_filter_to_detail),
    service_filter_id: report.service_filter_id || null,
    service_filter_name: report.service_filter_name || null,
    customer_tag_filter_id: report.customer_tag_filter_id || null,
    customer_tag_filter_name: report.customer_tag_filter_name || null,
    header_subsidiary_id: report.header_subsidiary_id || null,
    header_subsidiary_name: report.header_subsidiary_name || null,
    district_id: report.district_id || null,
    district_name: report.district_name || null,
    region_id: report.region_id || null,
    region_name: report.region_name || null,
    subsidiary_id: report.subsidiary_id || null,
    subsidiary_name: report.subsidiary_name || null,
    customer_tag_id: report.customer_tag_id || null,
    customer_tag_name: report.customer_tag_name || null
  };
}

function getMockScheduleReports(data = {}) {
  if (Array.isArray(data.reports) && data.reports.length > 0) {
    return data.reports.map((report, index) => normalizeMockScheduleReport(report, index));
  }

  if (!data.template_type || !data.process) {
    return [];
  }

  return [
    normalizeMockScheduleReport({
      id: data.report_id || data.id || null,
      template_name: data.report_template_name || data.template_name || data.name || '',
      template_type: data.template_type,
      process: data.process,
      apply_subsidiary_filter_to_detail: data.apply_subsidiary_filter_to_detail,
      service_filter_id: data.service_filter_id,
      service_filter_name: data.service_filter_name,
      customer_tag_filter_id: data.customer_tag_filter_id,
      customer_tag_filter_name: data.customer_tag_filter_name,
      header_subsidiary_id: data.header_subsidiary_id,
      header_subsidiary_name: data.header_subsidiary_name,
      district_id: data.district_id,
      district_name: data.district_name,
      region_id: data.region_id,
      region_name: data.region_name,
      subsidiary_id: data.subsidiary_id,
      subsidiary_name: data.subsidiary_name,
      customer_tag_id: data.customer_tag_id,
      customer_tag_name: data.customer_tag_name
    })
  ];
}

function buildMockReportScheduleMirror(data = {}) {
  const reports = getMockScheduleReports(data);
  const primaryReport = reports[0] || {};
  const emailGroupIds = Array.isArray(data.email_group_ids)
    ? [...new Set(data.email_group_ids.map(id => parseInt(id, 10)).filter(Number.isFinite))]
    : [data.email_group_id].map(id => parseInt(id, 10)).filter(Number.isFinite);

  return {
    name: String(data.name || data.template_name || '').trim() || 'Untitled Report Group',
    template_name: String(data.name || data.template_name || '').trim() || 'Untitled Report Group',
    email_template_type: data.email_template_type || null,
    template_type: primaryReport.template_type || data.template_type || 'district',
    process: primaryReport.process || data.process || 'standard',
    apply_subsidiary_filter_to_detail: Boolean(
      primaryReport.apply_subsidiary_filter_to_detail || data.apply_subsidiary_filter_to_detail
    ),
    tags: Array.isArray(data.tags) ? data.tags : [],
    service_filter_id: primaryReport.service_filter_id || data.service_filter_id || null,
    service_filter_name: primaryReport.service_filter_name || data.service_filter_name || null,
    customer_tag_filter_id: primaryReport.customer_tag_filter_id || data.customer_tag_filter_id || null,
    customer_tag_filter_name: primaryReport.customer_tag_filter_name || data.customer_tag_filter_name || null,
    header_subsidiary_id: primaryReport.header_subsidiary_id || data.header_subsidiary_id || null,
    header_subsidiary_name: primaryReport.header_subsidiary_name || data.header_subsidiary_name || null,
    district_id: primaryReport.district_id || data.district_id || null,
    district_name: primaryReport.district_name || data.district_name || null,
    region_id: primaryReport.region_id || data.region_id || null,
    region_name: primaryReport.region_name || data.region_name || null,
    subsidiary_id: primaryReport.subsidiary_id || data.subsidiary_id || null,
    subsidiary_name: primaryReport.subsidiary_name || data.subsidiary_name || null,
    customer_tag_id: primaryReport.customer_tag_id || data.customer_tag_id || null,
    customer_tag_name: primaryReport.customer_tag_name || data.customer_tag_name || null,
    email_group_id: emailGroupIds[0] || null,
    email_group_ids: emailGroupIds,
    reports,
    frequency: data.frequency || 'monthly',
    day_of_week: data.day_of_week || null,
    day_of_month: data.day_of_month ?? null,
    time_of_day: data.time_of_day || '08:00:00',
    enabled: data.enabled !== undefined ? Boolean(data.enabled) : true
  };
}

// Mock Email Groups
const mockEmailGroups = [
  {
    id: 1,
    name: 'District Managers',
    description: 'All district-level operations managers',
    email_count: 5,
    created_at: new Date('2026-01-15T10:00:00Z'),
    updated_at: new Date('2026-01-15T10:00:00Z')
  },
  {
    id: 2,
    name: 'Regional Directors',
    description: 'Regional leadership team and VPs',
    email_count: 3,
    created_at: new Date('2026-01-16T14:30:00Z'),
    updated_at: new Date('2026-01-16T14:30:00Z')
  },
  {
    id: 3,
    name: 'Finance Team',
    description: 'Accounting, FP&A, and finance department',
    email_count: 4,
    created_at: new Date('2026-01-17T09:15:00Z'),
    updated_at: new Date('2026-01-17T09:15:00Z')
  },
  {
    id: 4,
    name: 'Executive Team',
    description: 'C-suite and senior executives',
    email_count: 3,
    created_at: new Date('2026-01-18T11:00:00Z'),
    updated_at: new Date('2026-01-18T11:00:00Z')
  },
  {
    id: 5,
    name: 'West District Facilities',
    description: 'Facility administrators in West District',
    email_count: 8,
    created_at: new Date('2026-01-19T15:45:00Z'),
    updated_at: new Date('2026-01-19T15:45:00Z')
  },
  {
    id: 6,
    name: 'Northeast Operations',
    description: 'Operations team for Northeast region',
    email_count: 6,
    created_at: new Date('2026-01-20T08:30:00Z'),
    updated_at: new Date('2026-01-20T08:30:00Z')
  }
];

// Mock Email Group Contacts
const rawMockEmailContacts = [
  // District Managers
  { id: 1, email_group_id: 1, email: 'john.smith@yona.com', name: 'John Smith', created_at: new Date('2026-01-15T10:00:00Z') },
  { id: 2, email_group_id: 1, email: 'jane.doe@yona.com', name: 'Jane Doe', created_at: new Date('2026-01-15T10:01:00Z') },
  { id: 3, email_group_id: 1, email: 'mike.johnson@yona.com', name: 'Mike Johnson', created_at: new Date('2026-01-15T10:02:00Z') },
  { id: 4, email_group_id: 1, email: 'sarah.williams@yona.com', name: 'Sarah Williams', created_at: new Date('2026-01-15T10:03:00Z') },
  { id: 5, email_group_id: 1, email: 'david.brown@yona.com', name: 'David Brown', created_at: new Date('2026-01-15T10:04:00Z') },
  
  // Regional Directors
  { id: 6, email_group_id: 2, email: 'robert.clark@yona.com', name: 'Robert Clark - VP Northeast', created_at: new Date('2026-01-16T14:30:00Z') },
  { id: 7, email_group_id: 2, email: 'jennifer.lee@yona.com', name: 'Jennifer Lee - VP West', created_at: new Date('2026-01-16T14:31:00Z') },
  { id: 8, email_group_id: 2, email: 'thomas.martinez@yona.com', name: 'Thomas Martinez - VP South', created_at: new Date('2026-01-16T14:32:00Z') },
  
  // Finance Team
  { id: 9, email_group_id: 3, email: 'finance@yona.com', name: 'Finance Department', created_at: new Date('2026-01-17T09:15:00Z') },
  { id: 10, email_group_id: 3, email: 'controller@yona.com', name: 'Controller', created_at: new Date('2026-01-17T09:16:00Z') },
  { id: 11, email_group_id: 3, email: 'fpa@yona.com', name: 'FP&A Team', created_at: new Date('2026-01-17T09:17:00Z') },
  { id: 12, email_group_id: 3, email: 'accounting@yona.com', name: 'Accounting Team', created_at: new Date('2026-01-17T09:18:00Z') },
  
  // Executive Team
  { id: 13, email_group_id: 4, email: 'ceo@yona.com', name: 'CEO', created_at: new Date('2026-01-18T11:00:00Z') },
  { id: 14, email_group_id: 4, email: 'cfo@yona.com', name: 'CFO', created_at: new Date('2026-01-18T11:01:00Z') },
  { id: 15, email_group_id: 4, email: 'coo@yona.com', name: 'COO', created_at: new Date('2026-01-18T11:02:00Z') },
  
  // West District Facilities
  { id: 16, email_group_id: 5, email: 'facility1.admin@yona.com', name: 'Facility 1 Administrator', created_at: new Date('2026-01-19T15:45:00Z') },
  { id: 17, email_group_id: 5, email: 'facility2.admin@yona.com', name: 'Facility 2 Administrator', created_at: new Date('2026-01-19T15:46:00Z') },
  { id: 18, email_group_id: 5, email: 'facility3.admin@yona.com', name: 'Facility 3 Administrator', created_at: new Date('2026-01-19T15:47:00Z') },
  { id: 19, email_group_id: 5, email: 'facility4.admin@yona.com', name: 'Facility 4 Administrator', created_at: new Date('2026-01-19T15:48:00Z') },
  { id: 20, email_group_id: 5, email: 'facility5.admin@yona.com', name: 'Facility 5 Administrator', created_at: new Date('2026-01-19T15:49:00Z') },
  { id: 21, email_group_id: 5, email: 'facility6.admin@yona.com', name: 'Facility 6 Administrator', created_at: new Date('2026-01-19T15:50:00Z') },
  { id: 22, email_group_id: 5, email: 'facility7.admin@yona.com', name: 'Facility 7 Administrator', created_at: new Date('2026-01-19T15:51:00Z') },
  { id: 23, email_group_id: 5, email: 'facility8.admin@yona.com', name: 'Facility 8 Administrator', created_at: new Date('2026-01-19T15:52:00Z') },
  
  // Northeast Operations
  { id: 24, email_group_id: 6, email: 'ne.operations@yona.com', name: 'Northeast Operations Team', created_at: new Date('2026-01-20T08:30:00Z') },
  { id: 25, email_group_id: 6, email: 'ne.manager1@yona.com', name: 'NE District Manager 1', created_at: new Date('2026-01-20T08:31:00Z') },
  { id: 26, email_group_id: 6, email: 'ne.manager2@yona.com', name: 'NE District Manager 2', created_at: new Date('2026-01-20T08:32:00Z') },
  { id: 27, email_group_id: 6, email: 'ne.coordinator@yona.com', name: 'NE Regional Coordinator', created_at: new Date('2026-01-20T08:33:00Z') },
  { id: 28, email_group_id: 6, email: 'ne.analyst@yona.com', name: 'NE Business Analyst', created_at: new Date('2026-01-20T08:34:00Z') },
  { id: 29, email_group_id: 6, email: 'ne.support@yona.com', name: 'NE Support Team', created_at: new Date('2026-01-20T08:35:00Z') }
];

const mockEmailContacts = rawMockEmailContacts.map(withMockNameParts);

// Mock Report Schedules - Updated with new structure and REAL IDs from configs
const mockReportSchedules = [
  {
    id: 1,
    template_name: 'Weekly District 101 Standard Report',
    template_type: 'district',          // district, region, or subsidiary
    process: 'standard',                // standard or operational
    tags: ['weekly', 'district', 'standard'],
    district_id: '1971',                // Real district ID from config (District 101 - John Miller)
    district_name: 'District 101 - John Miller',
    region_id: null,
    region_name: null,
    subsidiary_id: null,
    subsidiary_name: null,
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [1],  // Array of email group IDs
    frequency: 'weekly',
    day_of_week: 'Monday',
    day_of_month: null,
    time_of_day: '08:00',
    enabled: true,                      // Replaces status active/paused
    created_at: new Date('2026-01-15T10:30:00Z'),
    updated_at: new Date('2026-01-15T10:30:00Z'),
    last_sent_at: new Date('2026-01-20T08:00:00Z'),
    last_run_at: new Date('2026-01-20T08:00:00Z'),
    next_send_at: new Date('2026-01-27T08:00:00Z')
  },
  {
    id: 2,
    template_name: 'Monthly R200 Region Operational Review',
    template_type: 'region',
    process: 'operational',
    tags: ['monthly', 'region', 'operations'],
    district_id: null,
    district_name: null,
    region_id: '4',                     // Real region ID from config (R200)
    region_name: 'R200',
    subsidiary_id: null,
    subsidiary_name: null,
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [2, 3],  // Multiple email groups
    frequency: 'monthly',
    day_of_week: null,
    day_of_month: 5,
    time_of_day: '09:00',
    enabled: true,
    created_at: new Date('2026-01-16T15:00:00Z'),
    updated_at: new Date('2026-01-16T15:00:00Z'),
    last_sent_at: new Date('2026-01-05T09:00:00Z'),
    last_run_at: new Date('2026-01-05T09:00:00Z'),
    next_send_at: new Date('2026-02-05T09:00:00Z')
  },
  {
    id: 3,
    template_name: 'Executive Monthly Standard Report',
    template_type: 'subsidiary',
    process: 'standard',
    tags: ['executive', 'monthly', 'board'],
    district_id: null,
    district_name: null,
    region_id: null,
    region_name: null,
    subsidiary_id: '13',                // Real subsidiary ID from config (Yona Solutions, LLC)
    subsidiary_name: 'Yona Solutions, LLC',
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [4],
    frequency: 'monthly',
    day_of_week: null,
    day_of_month: 1,
    time_of_day: '07:00',
    enabled: true,
    created_at: new Date('2026-01-18T11:30:00Z'),
    updated_at: new Date('2026-01-18T11:30:00Z'),
    last_sent_at: new Date('2026-01-01T07:00:00Z'),
    last_run_at: new Date('2026-01-01T07:00:00Z'),
    next_send_at: new Date('2026-02-01T07:00:00Z')
  },
  {
    id: 4,
    template_name: 'Friday District 102 Operational Summary',
    template_type: 'district',
    process: 'operational',
    tags: ['friday', 'district', 'ops'],
    district_id: '1982',                // Real district ID (District 102 - Michelle King)
    district_name: 'District 102 - Michelle King',
    region_id: null,
    region_name: null,
    subsidiary_id: null,
    subsidiary_name: null,
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [5, 1],  // Facilities + District Managers
    frequency: 'weekly',
    day_of_week: 'Friday',
    day_of_month: null,
    time_of_day: '16:00',
    enabled: true,
    created_at: new Date('2026-01-19T16:00:00Z'),
    updated_at: new Date('2026-01-19T16:00:00Z'),
    last_sent_at: new Date('2026-01-17T16:00:00Z'),
    last_run_at: new Date('2026-01-17T16:00:00Z'),
    next_send_at: new Date('2026-01-24T16:00:00Z')
  },
  {
    id: 5,
    template_name: 'Finance Monthly Standard - R300',
    template_type: 'region',
    process: 'standard',
    tags: ['finance', 'monthly', 'standard'],
    district_id: null,
    district_name: null,
    region_id: '5',                     // Real region ID (R300)
    region_name: 'R300',
    subsidiary_id: null,
    subsidiary_name: null,
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [3],
    frequency: 'monthly',
    day_of_week: null,
    day_of_month: 3,
    time_of_day: '10:00',
    enabled: true,
    created_at: new Date('2026-01-17T10:00:00Z'),
    updated_at: new Date('2026-01-17T10:00:00Z'),
    last_sent_at: new Date('2026-01-03T10:00:00Z'),
    last_run_at: new Date('2026-01-03T10:00:00Z'),
    next_send_at: new Date('2026-02-03T10:00:00Z')
  },
  {
    id: 6,
    template_name: 'R400 Region Weekly Ops (PAUSED)',
    template_type: 'region',
    process: 'operational',
    tags: ['paused', 'weekly', 'ops'],
    district_id: null,
    district_name: null,
    region_id: '6',                     // Real region ID (R400)
    region_name: 'R400',
    subsidiary_id: null,
    subsidiary_name: null,
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [2],
    frequency: 'weekly',
    day_of_week: 'Wednesday',
    day_of_month: null,
    time_of_day: '14:00',
    enabled: false,                     // Paused
    created_at: new Date('2026-01-20T09:00:00Z'),
    updated_at: new Date('2026-01-22T15:00:00Z'),
    last_sent_at: new Date('2026-01-15T14:00:00Z'),
    last_run_at: new Date('2026-01-15T14:00:00Z'),
    next_send_at: null
  },
  {
    id: 7,
    template_name: 'District 201 Monthly Report',
    template_type: 'district',
    process: 'standard',
    tags: ['district', 'monthly', 'northeast'],
    district_id: '2006',                // Real district ID (District 201 - Vestee Garcia)
    district_name: 'District 201 - Vestee Garcia',
    region_id: null,
    region_name: null,
    subsidiary_id: null,
    subsidiary_name: null,
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [1, 6],  // District Managers + Northeast Operations
    frequency: 'monthly',
    day_of_week: null,
    day_of_month: 10,
    time_of_day: '08:30',
    enabled: true,
    created_at: new Date('2026-01-21T11:00:00Z'),
    updated_at: new Date('2026-01-21T11:00:00Z'),
    last_sent_at: new Date('2026-01-10T08:30:00Z'),
    last_run_at: new Date('2026-01-10T08:30:00Z'),
    next_send_at: new Date('2026-02-10T08:30:00Z')
  },
  {
    id: 8,
    template_name: 'Company-Wide Operational Review',
    template_type: 'subsidiary',
    process: 'operational',
    tags: ['company-wide', 'operations', 'leadership'],
    district_id: null,
    district_name: null,
    region_id: null,
    region_name: null,
    subsidiary_id: '8',                 // Real subsidiary ID (Yona Holdings LLC)
    subsidiary_name: 'Yona Holdings LLC',
    customer_tag_id: null,
    customer_tag_name: null,
    email_group_ids: [3, 4],  // Finance Team + Executive Team
    frequency: 'weekly',
    day_of_week: 'Tuesday',
    day_of_month: null,
    time_of_day: '11:00',
    enabled: true,
    created_at: new Date('2026-01-22T09:30:00Z'),
    updated_at: new Date('2026-01-22T09:30:00Z'),
    last_sent_at: new Date('2026-01-21T11:00:00Z'),
    last_run_at: new Date('2026-01-21T11:00:00Z'),
    next_send_at: new Date('2026-01-28T11:00:00Z')
  }
];

/**
 * Get all mock email groups
 */
function getMockEmailGroups() {
  return JSON.parse(JSON.stringify(mockEmailGroups));
}

/**
 * Get mock email group by ID
 */
function getMockEmailGroup(id) {
  const group = mockEmailGroups.find(g => g.id === parseInt(id));
  return group ? JSON.parse(JSON.stringify(group)) : null;
}

/**
 * Get mock contacts for an email group
 */
function getMockEmailGroupContacts(groupId) {
  return mockEmailContacts
    .filter(c => c.email_group_id === parseInt(groupId))
    .map(c => JSON.parse(JSON.stringify(c)));
}

/**
 * Get all mock report schedules
 */
function getMockReportSchedules() {
  return JSON.parse(JSON.stringify(mockReportSchedules));
}

/**
 * Get mock report schedule by ID
 */
function getMockReportSchedule(id) {
  const schedule = mockReportSchedules.find(s => s.id === parseInt(id));
  return schedule ? JSON.parse(JSON.stringify(schedule)) : null;
}

/**
 * Create mock email group (simulated)
 */
function createMockEmailGroup(data) {
  const newId = Math.max(...mockEmailGroups.map(g => g.id)) + 1;
  const contacts = normalizeMockContacts(data.contacts || data.emails || []);
  const newGroup = {
    id: newId,
    name: data.name,
    description: data.description || null,
    email_count: contacts.length,
    created_at: new Date(),
    updated_at: new Date()
  };
  
  mockEmailGroups.push(newGroup);
  
  // Add contacts
  if (contacts.length > 0) {
    const startContactId = mockEmailContacts.length > 0 
      ? Math.max(...mockEmailContacts.map(c => c.id)) + 1 
      : 1;
    
    contacts.forEach((contact, index) => {
      mockEmailContacts.push({
        id: startContactId + index,
        email_group_id: newId,
        email: contact.email,
        name: contact.name,
        first_name: contact.first_name,
        last_name: contact.last_name,
        created_at: new Date()
      });
    });
  }
  
  return newGroup;
}

/**
 * Update mock email group (simulated)
 */
function updateMockEmailGroup(id, updates) {
  const group = mockEmailGroups.find(g => g.id === parseInt(id));
  if (!group) {
    return null;
  }

  group.name = updates.name;
  group.description = updates.description || null;
  group.updated_at = new Date();

  if (updates.contacts !== undefined || updates.emails !== undefined) {
    const contacts = normalizeMockContacts(updates.contacts || updates.emails || []);

    for (let index = mockEmailContacts.length - 1; index >= 0; index -= 1) {
      if (mockEmailContacts[index].email_group_id === parseInt(id)) {
        mockEmailContacts.splice(index, 1);
      }
    }

    const startContactId = mockEmailContacts.length > 0
      ? Math.max(...mockEmailContacts.map(contact => contact.id)) + 1
      : 1;

    contacts.forEach((contact, index) => {
      mockEmailContacts.push({
        id: startContactId + index,
        email_group_id: parseInt(id),
        email: contact.email,
        name: contact.name,
        first_name: contact.first_name,
        last_name: contact.last_name,
        created_at: new Date()
      });
    });

    group.email_count = contacts.length;
  }

  return JSON.parse(JSON.stringify(group));
}

/**
 * Create mock report schedule (simulated)
 */
function createMockReportSchedule(data) {
  const newId = Math.max(...mockReportSchedules.map(s => s.id)) + 1;

  const mirroredSchedule = buildMockReportScheduleMirror(data);
  const newSchedule = {
    id: newId,
    ...mirroredSchedule,
    created_at: new Date(),
    updated_at: new Date(),
    last_sent_at: null,
    last_run_at: null,
    next_send_at: null
  };
  
  mockReportSchedules.push(newSchedule);
  return newSchedule;
}

/**
 * Update mock report schedule (simulated)
 */
function updateMockReportSchedule(id, updates) {
  const scheduleIndex = mockReportSchedules.findIndex(s => s.id === parseInt(id));
  if (scheduleIndex === -1) {
    return null;
  }

  const existing = mockReportSchedules[scheduleIndex];
  const merged = {
    ...existing,
    ...updates,
    reports: Array.isArray(updates.reports) ? updates.reports : (existing.reports || [])
  };
  const mirroredSchedule = buildMockReportScheduleMirror(merged);
  const updatedSchedule = {
    ...existing,
    ...mirroredSchedule,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: new Date()
  };
  mockReportSchedules[scheduleIndex] = updatedSchedule;

  return JSON.parse(JSON.stringify(updatedSchedule));
}

/**
 * Delete mock email group (simulated)
 */
function deleteMockEmailGroup(id) {
  const index = mockEmailGroups.findIndex(g => g.id === parseInt(id));
  if (index === -1) return false;
  
  // Remove group
  mockEmailGroups.splice(index, 1);
  
  // Remove contacts
  const contactIndices = mockEmailContacts
    .map((c, i) => c.email_group_id === parseInt(id) ? i : -1)
    .filter(i => i !== -1)
    .reverse();
  
  contactIndices.forEach(i => mockEmailContacts.splice(i, 1));
  
  return true;
}

/**
 * Delete mock report schedule (simulated)
 */
function deleteMockReportSchedule(id) {
  const index = mockReportSchedules.findIndex(s => s.id === parseInt(id));
  if (index === -1) return false;
  
  mockReportSchedules.splice(index, 1);
  return true;
}

module.exports = {
  getMockEmailGroups,
  getMockEmailGroup,
  getMockEmailGroupContacts,
  getMockReportSchedules,
  getMockReportSchedule,
  createMockEmailGroup,
  updateMockEmailGroup,
  createMockReportSchedule,
  updateMockReportSchedule,
  deleteMockEmailGroup,
  deleteMockReportSchedule
};
