const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { Role } = require('../constants/roles');
const { validateCreateStaff } = require('../validators/staff.validation');
const { createStaff } = require('../controllers/staff.controller');

const router = Router();

router.post('/', authenticate, authorize(Role.ADMIN, Role.OWNER), validateCreateStaff, createStaff);

module.exports = router;
