/**
 * Mock Email Configuration Data
 * 
 * Provides realistic mock data for email groups and report schedules
 * when DATABASE_URL is not configured. This allows testing the full
 * UI flow without requiring database setup.
 */

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
const mockEmailContacts = [
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

// Mock Report Schedules
const mockReportSchedules = [
  {
    id: 1,
    report_type: 'standard',
    hierarchy: 'district',
    entity_id: 'west_district',
    entity_name: 'West District',
    email_group_id: 1,
    email_group_name: 'District Managers',
    frequency: 'monthly',
    status: 'active',
    day_of_month: 5, // Send on 5th of each month
    time_of_day: '08:00',
    created_at: new Date('2026-01-15T10:30:00Z'),
    updated_at: new Date('2026-01-15T10:30:00Z'),
    last_sent_at: new Date('2026-01-05T08:00:00Z'),
    next_send_at: new Date('2026-02-05T08:00:00Z')
  },
  {
    id: 2,
    report_type: 'operational',
    hierarchy: 'region',
    entity_id: 'northeast',
    entity_name: 'Northeast Region',
    email_group_id: 2,
    email_group_name: 'Regional Directors',
    frequency: 'weekly',
    status: 'active',
    day_of_week: 'Monday',
    time_of_day: '09:00',
    created_at: new Date('2026-01-16T15:00:00Z'),
    updated_at: new Date('2026-01-16T15:00:00Z'),
    last_sent_at: new Date('2026-01-20T09:00:00Z'),
    next_send_at: new Date('2026-01-27T09:00:00Z')
  },
  {
    id: 3,
    report_type: 'standard',
    hierarchy: 'subsidiary',
    entity_id: 'yona_main',
    entity_name: 'Yona Solutions Main',
    email_group_id: 4,
    email_group_name: 'Executive Team',
    frequency: 'monthly',
    status: 'active',
    day_of_month: 1, // Send on 1st of each month
    time_of_day: '07:00',
    created_at: new Date('2026-01-18T11:30:00Z'),
    updated_at: new Date('2026-01-18T11:30:00Z'),
    last_sent_at: new Date('2026-01-01T07:00:00Z'),
    next_send_at: new Date('2026-02-01T07:00:00Z')
  },
  {
    id: 4,
    report_type: 'operational',
    hierarchy: 'district',
    entity_id: 'west_district',
    entity_name: 'West District',
    email_group_id: 5,
    email_group_name: 'West District Facilities',
    frequency: 'weekly',
    status: 'active',
    day_of_week: 'Friday',
    time_of_day: '16:00',
    created_at: new Date('2026-01-19T16:00:00Z'),
    updated_at: new Date('2026-01-19T16:00:00Z'),
    last_sent_at: new Date('2026-01-17T16:00:00Z'),
    next_send_at: new Date('2026-01-24T16:00:00Z')
  },
  {
    id: 5,
    report_type: 'standard',
    hierarchy: 'region',
    entity_id: 'northeast',
    entity_name: 'Northeast Region',
    email_group_id: 3,
    email_group_name: 'Finance Team',
    frequency: 'monthly',
    status: 'active',
    day_of_month: 3,
    time_of_day: '10:00',
    created_at: new Date('2026-01-17T10:00:00Z'),
    updated_at: new Date('2026-01-17T10:00:00Z'),
    last_sent_at: new Date('2026-01-03T10:00:00Z'),
    next_send_at: new Date('2026-02-03T10:00:00Z')
  },
  {
    id: 6,
    report_type: 'operational',
    hierarchy: 'region',
    entity_id: 'west',
    entity_name: 'West Region',
    email_group_id: 2,
    email_group_name: 'Regional Directors',
    frequency: 'weekly',
    status: 'paused',
    day_of_week: 'Wednesday',
    time_of_day: '14:00',
    created_at: new Date('2026-01-20T09:00:00Z'),
    updated_at: new Date('2026-01-22T15:00:00Z'),
    last_sent_at: new Date('2026-01-15T14:00:00Z'),
    next_send_at: null
  },
  {
    id: 7,
    report_type: 'standard',
    hierarchy: 'district',
    entity_id: 'south_district',
    entity_name: 'South District',
    email_group_id: 1,
    email_group_name: 'District Managers',
    frequency: 'monthly',
    status: 'active',
    day_of_month: 10,
    time_of_day: '08:30',
    created_at: new Date('2026-01-21T11:00:00Z'),
    updated_at: new Date('2026-01-21T11:00:00Z'),
    last_sent_at: new Date('2026-01-10T08:30:00Z'),
    next_send_at: new Date('2026-02-10T08:30:00Z')
  },
  {
    id: 8,
    report_type: 'operational',
    hierarchy: 'subsidiary',
    entity_id: 'yona_main',
    entity_name: 'Yona Solutions Main',
    email_group_id: 3,
    email_group_name: 'Finance Team',
    frequency: 'weekly',
    status: 'active',
    day_of_week: 'Tuesday',
    time_of_day: '11:00',
    created_at: new Date('2026-01-22T09:30:00Z'),
    updated_at: new Date('2026-01-22T09:30:00Z'),
    last_sent_at: new Date('2026-01-21T11:00:00Z'),
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
  const newGroup = {
    id: newId,
    name: data.name,
    description: data.description || null,
    email_count: data.emails ? data.emails.length : 0,
    created_at: new Date(),
    updated_at: new Date()
  };
  
  mockEmailGroups.push(newGroup);
  
  // Add contacts
  if (data.emails && data.emails.length > 0) {
    const startContactId = mockEmailContacts.length > 0 
      ? Math.max(...mockEmailContacts.map(c => c.id)) + 1 
      : 1;
    
    data.emails.forEach((email, index) => {
      mockEmailContacts.push({
        id: startContactId + index,
        email_group_id: newId,
        email: email,
        name: null,
        created_at: new Date()
      });
    });
  }
  
  return newGroup;
}

/**
 * Create mock report schedule (simulated)
 */
function createMockReportSchedule(data) {
  const newId = Math.max(...mockReportSchedules.map(s => s.id)) + 1;
  
  // Find email group name
  const emailGroup = mockEmailGroups.find(g => g.id === parseInt(data.email_group_id));
  
  const newSchedule = {
    id: newId,
    report_type: data.report_type,
    hierarchy: data.hierarchy,
    entity_id: data.entity_id,
    entity_name: data.entity_name || null,
    email_group_id: parseInt(data.email_group_id),
    email_group_name: emailGroup ? emailGroup.name : 'Unknown',
    frequency: data.frequency,
    status: data.status || 'active',
    day_of_week: data.day_of_week || null,
    day_of_month: data.day_of_month || null,
    time_of_day: data.time_of_day || '08:00',
    created_at: new Date(),
    updated_at: new Date(),
    last_sent_at: null,
    next_send_at: null
  };
  
  mockReportSchedules.push(newSchedule);
  return newSchedule;
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
  createMockReportSchedule,
  deleteMockEmailGroup,
  deleteMockReportSchedule
};

