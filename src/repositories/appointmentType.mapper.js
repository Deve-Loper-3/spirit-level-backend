// Appointment type as the API returns it (ISO 8601 UTC timestamps).
const toAppointmentTypeResponse = (row) => ({
  id: row.id,
  name: row.name,
  durationMin: row.durationMin,
  bufferBeforeMin: row.bufferBeforeMin,
  bufferAfterMin: row.bufferAfterMin,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

module.exports = { toAppointmentTypeResponse };
