const prisma = require('../config/prisma');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { CoachStatus } = require('../constants/coach');
const { findCoachStatus } = require('../repositories/coachSchedule.repository');

// ==========================================
// Coach schedule conflict engine (SEAM)
//
// SLAPP 66/111 S6 ships only the entry point so callers can already be written against it.
// S7 replaces the body with the real rules (strict weekly availability, leave, class-session
// overlap, appointment overlap and buffers) and the 409 COACH_CONFLICT shape
// (`details.conflicts[]`, same shape as the class scheduling conflicts).
//
// Contract (stable, S7 keeps it):
//   - call it INSIDE a transaction that already holds `lockCoachSchedule(coachId, client)`;
//   - `client` is that transaction client;
//   - it resolves when the interval is assignable and throws an AppError when it is not;
//   - `startAt` / `endAt` are Dates (UTC instants), the buffers are minutes
//     (the occupied window is [startAt - bufferBeforeMin, endAt + bufferAfterMin]);
//   - `excludeAppointmentId` leaves that appointment out of the overlap check (reschedule).
//
// S6 behaviour (pass-through): the coach exists and is ACTIVE. Nothing else is checked.
// ==========================================
const assertIntervalAssignable = async (
  { coachId, startAt, endAt, bufferBeforeMin, bufferAfterMin, excludeAppointmentId },
  client = prisma,
) => {
  void [startAt, endAt, bufferBeforeMin, bufferAfterMin, excludeAppointmentId]; // used by S7
  const coach = await findCoachStatus(coachId, client);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  if (coach.status !== CoachStatus.ACTIVE) throw createAppError(AppErrors.COACH_INACTIVE);
};

module.exports = { assertIntervalAssignable };
