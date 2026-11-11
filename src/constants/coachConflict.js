// SLAPP 66/111 S7: why a coach cannot take an interval. These strings are part of the API contract
// (`details.conflicts[].type` of a 409 COACH_CONFLICT and `conflict.type` of GET /coaches/eligible).
// The older session conflicts ('COACH_CONFLICT', 'COACH_LEAVE', 'COACH_UNQUALIFIED') are unchanged.
const CoachConflictType = Object.freeze({
  AVAILABILITY_NOT_SET: 'AVAILABILITY_NOT_SET',
  OUTSIDE_AVAILABILITY: 'OUTSIDE_AVAILABILITY',
  COACH_UNAVAILABLE: 'COACH_UNAVAILABLE',
  SESSION_OVERLAP: 'SESSION_OVERLAP',
  APPOINTMENT_OVERLAP: 'APPOINTMENT_OVERLAP',
  APPOINTMENT_BUFFER: 'APPOINTMENT_BUFFER',
});

// What `conflictingItem.id` refers to.
const ConflictItemKind = Object.freeze({
  SESSION: 'SESSION',
  APPOINTMENT: 'APPOINTMENT',
  LEAVE: 'LEAVE',
});

// Stored buffers are capped at 240 minutes (APPOINTMENT_BUFFER_MAX); the appointment loader widens its
// window by this much on each side, so no appointment whose buffer could reach the interval is missed.
const MAX_STORED_BUFFER_MIN = 240;

module.exports = { CoachConflictType, ConflictItemKind, MAX_STORED_BUFFER_MIN };
