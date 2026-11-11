const iso = (date) => (date ? date.toISOString() : null);

// Appointment as the API returns it: ISO 8601 UTC timestamps, explicit nulls, names for display.
// The buffers are the snapshots stored on the appointment, never the type's current values.
const toAppointmentResponse = (row) => ({
  id: row.id,
  coachId: row.coachId,
  coachName: row.coach?.user?.fullName ?? null,
  memberId: row.memberId,
  memberName: row.member?.fullName ?? null,
  appointmentTypeId: row.appointmentTypeId,
  appointmentTypeName: row.appointmentType?.name ?? null,
  startAt: iso(row.startAt),
  endAt: iso(row.endAt),
  bufferBeforeMin: row.bufferBeforeMin,
  bufferAfterMin: row.bufferAfterMin,
  state: row.state,
  cancelledAt: iso(row.cancelledAt),
  version: row.version,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

module.exports = { toAppointmentResponse };
