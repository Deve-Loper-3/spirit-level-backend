const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const {
  appointmentLimiter,
  appointmentReadLimiter,
} = require('../middlewares/rateLimiter.middleware');
const { APPOINTMENT_MANAGER_ROLES, APPOINTMENT_READER_ROLES } = require('../constants/appointment');
const {
  validateListAppointmentsQuery,
  validateCreateAppointmentBody,
  validateAppointmentParams,
} = require('../validators/appointment.validation');
const {
  listAppointments,
  getAppointment,
  createAppointment,
  cancelAppointment,
} = require('../controllers/appointment.controller');

const router = Router();

// Managers read everything. A coach reads only their own appointments and a member only their own
// (appointment.service scopes the list and answers 403 for someone else's). Only managers write.
router.get(
  '/',
  authenticate,
  authorize(...APPOINTMENT_READER_ROLES),
  appointmentReadLimiter,
  validateListAppointmentsQuery,
  listAppointments,
);
router.post(
  '/',
  authenticate,
  authorize(...APPOINTMENT_MANAGER_ROLES),
  appointmentLimiter,
  validateCreateAppointmentBody,
  createAppointment,
);
router.get(
  '/:appointmentId',
  authenticate,
  authorize(...APPOINTMENT_READER_ROLES),
  appointmentReadLimiter,
  validateAppointmentParams,
  getAppointment,
);
router.post(
  '/:appointmentId/cancel',
  authenticate,
  authorize(...APPOINTMENT_MANAGER_ROLES),
  appointmentLimiter,
  validateAppointmentParams,
  cancelAppointment,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['GET', 'POST']));
router.all('/:appointmentId', methodNotAllowed(['GET']));
router.all('/:appointmentId/cancel', methodNotAllowed(['POST']));

module.exports = router;
