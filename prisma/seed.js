// Run with: npm run prisma:seed
const prisma = require('../src/config/prisma');
const { seedOwner, describeSeedResult, SEED_CONFIG_INVALID } = require('./seed-owner');

// Only configuration errors are printed in full. Anything else (e.g. Prisma errors can embed the
// submitted data) is reduced to its name and code so no credential material reaches the terminal.
const describeFailure = (err) =>
  err.code === SEED_CONFIG_INVALID ? err.message : `${err.name}${err.code ? ` (${err.code})` : ''}`;

const main = async () => {
  const result = await seedOwner(process.env);
  process.stdout.write(`${describeSeedResult(result)}\n`);
};

main()
  .catch((err) => {
    process.stderr.write(`Owner seed failed: ${describeFailure(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
