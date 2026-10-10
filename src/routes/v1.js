const { Router } = require('express');
const authRoutes = require('./auth.routes');
const staffRoutes = require('./staff.routes');
const uploadsRoutes = require('./uploads.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin/staff', staffRoutes);
router.use('/uploads', uploadsRoutes);

module.exports = router;
