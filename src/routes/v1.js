const { Router } = require('express');
const authRoutes = require('./auth.routes');
const staffRoutes = require('./staff.routes');
const coachRoutes = require('./coach.routes');
const uploadsRoutes = require('./uploads.routes');
const planRoutes = require('./plan.routes');
const classRoutes = require('./class.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin/staff', staffRoutes);
router.use('/coaches', coachRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/plans', planRoutes);
router.use('/classes', classRoutes);

module.exports = router;
