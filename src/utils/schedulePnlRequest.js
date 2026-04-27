function normalizeScheduleProcess(process) {
  const normalized = String(process || '').trim().toLowerCase();
  return normalized === 'operational' ? 'operational' : 'standard';
}

function getScheduleOrgLabel(schedule) {
  const label = schedule?.header_subsidiary_name || schedule?.org_label || '';
  const trimmed = String(label).trim();
  return trimmed || null;
}

function buildSchedulePnlDataPath(schedule, { entityId, reportDate }) {
  const params = new URLSearchParams({
    hierarchy: schedule.template_type,
    selectedId: String(entityId),
    date: String(reportDate),
    plType: normalizeScheduleProcess(schedule.process)
  });

  const orgLabel = getScheduleOrgLabel(schedule);
  if (orgLabel) {
    params.set('orgLabel', orgLabel);
  }

  if ((schedule.template_type === 'region' || schedule.template_type === 'district') && schedule.subsidiary_id) {
    params.set('subsidiaryFilter', schedule.subsidiary_id);
  }

  if (schedule.template_type === 'subsidiary' && schedule.service_filter_id) {
    params.set('serviceFilter', schedule.service_filter_id);
  }

  return `/api/pl/data?${params.toString()}`;
}

function buildSchedulePnlDataUrl(baseUrl, schedule, { entityId, reportDate }) {
  return `${baseUrl}${buildSchedulePnlDataPath(schedule, { entityId, reportDate })}`;
}

module.exports = {
  normalizeScheduleProcess,
  getScheduleOrgLabel,
  buildSchedulePnlDataPath,
  buildSchedulePnlDataUrl
};
