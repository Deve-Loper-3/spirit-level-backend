require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { sweepStaleTestData } = require('./helpers/sweepTestData');

// Best effort: a failed sweep must not stop the run, the tests create their own data anyway.
module.exports = async () => {
  const prisma = new PrismaClient();
  try {
    await sweepStaleTestData(prisma);
  } catch (err) {
    process.stderr.write(`test data sweep skipped: ${err.name}\n`);
  } finally {
    await prisma.$disconnect();
  }
};
