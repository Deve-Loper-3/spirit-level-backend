# SLAPP 66/111 — Coach availability, leave, appointments, replacement coach

Branch `feat/SLAPP-111-coach-availability#daniyal`. Full details, decisions and the requirement checklist are in
`docs/CODEMAP.md` §28; the client contract is `docs/openapi.yaml`.

## Summary

- **Task 1 — weekly availability and conflict validation.** Coaches have recurring weekly hours (several ranges per
  day, days off). One conflict engine (`coachSchedule.rules/service`) decides whether a coach can take an interval:
  availability, leave, class sessions, appointments with buffers. It guards every manual assignment (create session,
  PATCH session coaches or time, restore session, book appointment). Also: appointment types and one-to-one
  appointments, a coach picker for a time slot and a calculator of free appointment slots.
- **Task 2 — effect of hours changes.** Saving hours never moves, cancels or edits an existing session or booking; a
  clash shows up the next time that item is edited or restored. Session generation (`generateSessionsForWindow`, the
  daily job) is untouched.
- **Task 3 — leave.** Date-specific unavailability with CRUD. Adding or editing leave only reports the affected upcoming
  sessions (COVERED / UNCOVERED); `GET /sessions/coverage` gives the schedule view. Leave blocks assigning that coach.
- **Task 4 — replacement coach and cancellation side effects.** The admin replaces the coach of ONE session instance with
  any active coach (`PATCH /sessions/:id` with `coachIds`); nothing is chosen automatically; the class template and other
  occurrences are untouched; `SESSION_COACH_REPLACED` is audited. Cancelling a class cancels the booked members'
  bookings, returns one credit each (append-only ledger, idempotent), creates an in-app notification and sends an e-mail
  after the commit.

## Migrations (3 new, apply in this order)

1. `20261111100000_add_coach_availability` — `coach_availability_days`, `coach_availability_slots`, `coach_unavailability`, 5 `AuditAction` values.
2. `20261111110000_add_appointments` — `appointment_types`, `appointments`, `AppointmentState`, 4 `AuditAction` values.
3. `20261111120000_add_bookings_credits_notifications` — `class_bookings`, `member_credit_transactions`, `notifications`, 3 enums.

All three are additive. SLAPP-104 (booking rules) migrations were merged into this branch earlier and are unchanged.
Apply with `npx prisma migrate deploy`; `DIRECT_URL` (the non-pooled Neon URL) is what Prisma uses for migrations. If the
command hangs on the pooled host, run `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy`, then `npx prisma generate`.
Each migration folder has a `down.sql` (scratch databases only).

## New endpoints (20)

- Availability: `GET`/`PUT /coaches/:coachId/availability`, `GET /coaches/:coachId/availability/slots`
- Leave: `GET`/`POST /coaches/:coachId/unavailability`, `PATCH`/`DELETE /coaches/:coachId/unavailability/:unavailabilityId`
- Coach picker: `GET /coaches/eligible`
- Appointment types: `GET`/`POST /appointment-types`, `PATCH /appointment-types/:typeId`
- Appointments: `GET`/`POST /appointments`, `GET /appointments/:appointmentId`, `POST /appointments/:appointmentId/cancel`
- Schedule view: `GET /sessions/coverage`
- Notifications: `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:notificationId/read`, `POST /notifications/read-all`

Existing endpoints with new behaviour: `POST /sessions`, `PATCH /sessions/:id`, `POST /sessions/:id/restore` (409
`COACH_CONFLICT` with the new conflict types), `POST /sessions/:id/cancel` (bookings, credits, notifications; response
keys unchanged).

## Decisions

- **Strict availability:** a coach is assignable only when the interval fits fully inside ONE saved range of that
  facility day. No saved hours, a missing day or a day off means not assignable.
- **In-app notifications instead of push:** no `firebase-admin`, no device tokens, no new dependency. Notifications are
  read through the API; class cancellations also send an e-mail.
- **Engine on manual paths only:** never on generation or the cron (a conflict there would silently skip sessions);
  `isCoachOnLeave` stays a stub for that reason.
- **Replacement may use any active coach**, not only the class template's coaches; the engine is the gate.
- Times are stored in UTC; weekly hours are `HH:mm` facility wall-clock (`FACILITY_TIMEZONE`, default Asia/Dubai).
- One credit is returned per cancelled booking; restoring a session re-books nobody and reverses nothing.

## Limitations

- `getBookingStats` and `countFutureBookedSessions` are still stubs returning 0; there is no public booking endpoint.
- `isCoachOnLeave` (kept off for generation) and `isCoachQualified` are stubs.
- No read-only report of what a changed weekly schedule would clash with (leave has one).
- The `down.sql` of migration 1 predates the later `AuditAction` values.
- Members cannot book appointments or read open slots; SLAPP-104 appointment rules are not applied.

## How to test

```bash
npx prisma validate && npx prisma migrate status
npx jest tests/unit
npx jest --runInBand 'tests/integration/(admin|auth|authorization|audit-log|session|user|uploads|cors|idparam|method-not-allowed|public|test-data)[.]'
npx jest --runInBand 'tests/integration/(membership|membershipPlan|plan)[.]'
npx jest --runInBand 'tests/integration/cafe[.]'
npx jest --runInBand 'tests/integration/(class|schedule|sessions)[.]'
npx jest --runInBand 'tests/integration/(coaches|coachSchedule|appointments|appointmentTypes|notifications|bookingRule)[.]'
npx eslint .
```

Integration tests use the database configured in `.env`; the new suites create and remove their own data (prefix
`test_...`). No test is destructive to existing data.
