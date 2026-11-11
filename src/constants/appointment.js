const { Role } = require('./roles');
const { COACH_MANAGER_ROLES } = require('./coach');

// SLAPP 66/111 S6: appointment types and one-to-one appointments (API enum strings, same as Prisma).
const AppointmentState = Object.freeze({
  BOOKED: 'BOOKED',
  CANCELLED: 'CANCELLED',
});

// Limits (the DB CHECKs only cover duration 1-480, non-blank name and buffers >= 0).
const APPOINTMENT_TYPE_NAME_MAX_LENGTH = 100;
const APPOINTMENT_DURATION_MIN = 1;
const APPOINTMENT_DURATION_MAX = 480;
const APPOINTMENT_BUFFER_MAX = 240;

// Writes (types and appointments) are for managers; everybody signed in may read, scoped by role.
const APPOINTMENT_MANAGER_ROLES = COACH_MANAGER_ROLES;
const APPOINTMENT_READER_ROLES = Object.freeze([Role.ADMIN, Role.OWNER, Role.COACH, Role.MEMBER]);

module.exports = {
  AppointmentState,
  APPOINTMENT_TYPE_NAME_MAX_LENGTH,
  APPOINTMENT_DURATION_MIN,
  APPOINTMENT_DURATION_MAX,
  APPOINTMENT_BUFFER_MAX,
  APPOINTMENT_MANAGER_ROLES,
  APPOINTMENT_READER_ROLES,
};
