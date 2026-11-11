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
  validateListAppointmentTypesQuery,
  validateCreateAppointmentTypeBody,
  validateUpdateAppointmentTypeBody,
  validateAppointmentTypeParams,
} = require('../validators/appointment.validation');
const {
  listAppointmentTypes,
  createAppointmentType,
  updateAppointmentType,
} = require('../controllers/appointmentType.controller');

const router = Router();

// Every signed-in role reads (non-managers see active types only); only managers write.
// There is no DELETE: a type is deactivated with `isActive: false`.
router.get(
  '/',
  authenticate,
  authorize(...APPOINTMENT_READER_ROLES),
  appointmentReadLimiter,
  validateListAppointmentTypesQuery,
  listAppointmentTypes,
);
router.post(
  '/',
  authenticate,
  authorize(...APPOINTMENT_MANAGER_ROLES),
  appointmentLimiter,
  validateCreateAppointmentTypeBody,
  createAppointmentType,
);
router.patch(
  '/:typeId',
  authenticate,
  authorize(...APPOINTMENT_MANAGER_ROLES),
  appointmentLimiter,
  validateAppointmentTypeParams,
  validateUpdateAppointmentTypeBody,
  updateAppointmentType,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['GET', 'POST']));
router.all('/:typeId', methodNotAllowed(['PATCH']));

module.exports = router;
