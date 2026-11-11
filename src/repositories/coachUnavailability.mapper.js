// 'YYYY-MM-DD' from a @db.Date value (midnight UTC).
const toDateString = (date) => date.toISOString().slice(0, 10);

// Leave as the API returns it. Dates are calendar dates, timestamps ISO 8601 UTC, and an empty
// note is an explicit null (never omitted).
const toUnavailabilityResponse = (row) => ({
  id: row.id,
  coachId: row.coachId,
  startDate: toDateString(row.startDate),
  endDate: toDateString(row.endDate),
  reason: row.reason,
  note: row.note ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toAffectedSessionResponse = (session, coverage) => ({
  sessionId: session.id,
  classId: session.classId,
  title: session.class.name,
  startAt: session.startAt.toISOString(),
  endAt: session.endAt.toISOString(),
  coverage,
});

// POST / PATCH answer with the leave plus what it touches (read-only information).
const toUnavailabilityWithImpact = (row, { affectedSessions, affectedTotal }) => ({
  ...toUnavailabilityResponse(row),
  affectedSessions,
  affectedTotal,
});

module.exports = {
  toDateString,
  toUnavailabilityResponse,
  toAffectedSessionResponse,
  toUnavailabilityWithImpact,
};
