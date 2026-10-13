const { Router } = require('express');
const healthRoutes = require('./health.routes');
const v1Routes = require('./v1');

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/v1', v1Routes);

module.exports = router;
