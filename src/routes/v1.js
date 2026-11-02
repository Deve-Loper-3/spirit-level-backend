const { Router } = require('express');
const authRoutes = require('./auth.routes');
const staffRoutes = require('./staff.routes');
const coachRoutes = require('./coach.routes');
const uploadsRoutes = require('./uploads.routes');
const membershipRoutes = require('./membership.routes');
const planRoutes = require('./plan.routes');
const classRoutes = require('./class.routes');
const sessionRoutes = require('./session.routes');
const cafeRoutes = require('./cafe.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin/staff', staffRoutes);
router.use('/coaches', coachRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/memberships', membershipRoutes);
router.use('/plans', planRoutes);
router.use('/classes', classRoutes);
router.use('/sessions', sessionRoutes);
router.use('/cafe', cafeRoutes);

module.exports = router;
