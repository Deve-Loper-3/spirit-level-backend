// One-off, idempotent data fix for 2 Glofox plans that were seeded as SUBSCRIPTION + ONE_OFF + recurring=true.
// Default is a dry run (SELECT only). Pass --apply to run the UPDATE.
//   node prisma/scripts/fix-miskinded-plans.js          -> preview
//   node prisma/scripts/fix-miskinded-plans.js --apply  -> update
// The WHERE matches only the current wrong values, so a second run changes nothing.
const prisma = require('../../src/config/prisma');

const CODES = ['1678946801778', '1787584139715'];

const PREVIEW_SQL = `
  SELECT "externalRef", name, kind, "billingCycle", recurring, "periodMonths", version
  FROM membership_plans
  WHERE "externalRef" = ANY($1::text[])
  ORDER BY "externalRef"`;

const MATCH_WRONG = `
  "externalRef" = ANY($1::text[])
  AND kind = 'SUBSCRIPTION' AND "billingCycle" = 'ONE_OFF' AND recurring = true AND "periodMonths" IS NULL`;

const run = async () => {
  const apply = process.argv.includes('--apply');

  console.log('Before:');
  console.table(await prisma.$queryRawUnsafe(PREVIEW_SQL, CODES));

  const [{ count }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM membership_plans WHERE ${MATCH_WRONG}`,
    CODES,
  );
  console.log(`Rows matching the wrong values: ${count}`);

  if (!apply) {
    console.log('Dry run. Nothing changed. Pass --apply to update.');
    return;
  }

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE membership_plans SET kind = 'CREDIT_PACK', recurring = false, "periodMonths" = NULL
     WHERE ${MATCH_WRONG}`,
    CODES,
  );
  console.log(`Updated rows: ${updated}`);
  console.log('After:');
  console.table(await prisma.$queryRawUnsafe(PREVIEW_SQL, CODES));
};

run()
  .catch((err) => {
    console.error('fix failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
