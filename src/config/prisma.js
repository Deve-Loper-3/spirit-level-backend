const { PrismaClient } = require('@prisma/client');
const env = require('./env');

const prisma = new PrismaClient({
  log: env.isDev ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
