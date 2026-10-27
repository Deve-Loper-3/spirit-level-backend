const cron = require('node-cron');
const logger = require('../config/logger');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { generateSessionsForWindow } = require('./schedule.service');

/**
 * Runs idempotent rolling session generation for all active classes.
 * Failures on individual classes are logged and isolated so other classes proceed.
 */
const runDailyGeneration = async (options = {}) => {
  const { classId = null } = options;
  logger.info('Starting daily session generation job...');
  try {
    const where = { status: 'ACTIVE' };
    if (classId) {
      where.id = classId;
    }
    const activeClasses = await prisma.class.findMany({
      where,
      select: { id: true, name: true, timezone: true },
    });

    let totalGenerated = 0;
    let totalConflicts = 0;

    for (const classItem of activeClasses) {
      try {
        const result = await generateSessionsForWindow({
          classId: classItem.id,
          client: prisma,
        });
        totalGenerated += result.generatedCount;
        totalConflicts += result.conflictCount;
      } catch (err) {
        logger.error(
          { err, classId: classItem.id },
          `Failed to generate sessions for class ${classItem.name}`,
        );
      }
    }

    logger.info(
      { totalGenerated, totalConflicts, activeClassesCount: activeClasses.length },
      'Daily session generation job completed',
    );
    return { totalGenerated, totalConflicts, classesCount: activeClasses.length };
  } catch (err) {
    logger.error({ err }, 'Unhandled error in daily session generation job');
    return { totalGenerated: 0, totalConflicts: 0, error: err.message };
  }
};

let scheduledTask = null;

/**
 * Initializes the node-cron scheduled job for long-running Express server.
 * Runs at 00:05 in facility timezone.
 */
const startScheduleJob = () => {
  if (env.isTest) {
    return null;
  }

  const cronTimezone = env.FACILITY_TIMEZONE || 'Asia/Dubai';
  scheduledTask = cron.schedule(
    '5 0 * * *',
    async () => {
      await runDailyGeneration();
    },
    {
      timezone: cronTimezone,
    },
  );

  logger.info({ timezone: cronTimezone }, 'Scheduled daily session generation job (00:05 daily)');
  return scheduledTask;
};

const stopScheduleJob = () => {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
};

module.exports = {
  runDailyGeneration,
  startScheduleJob,
  stopScheduleJob,
};
