// Run with: npm run seed:booking-rules
// Inserts every rule of the catalogue that is not in the table yet. Rows that exist (edited or
// not) are left alone; a rule deleted on purpose is added back, so only run this deliberately.
const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const {
  BOOKING_RULE_CATALOGUE,
  API_TO_DB_CATEGORY,
  API_TO_DB_UNIT,
} = require('../../src/constants/bookingRule');

const toSeedRow = (entry) => ({
  id: crypto.randomUUID(),
  ruleKey: entry.ruleKey,
  category: API_TO_DB_CATEGORY[entry.category],
  name: entry.name,
  value: entry.defaultValue,
  unit: entry.unit ? API_TO_DB_UNIT[entry.unit] : null,
  enabled: entry.defaultEnabled,
});

const seedBookingRules = async (client = prisma) => {
  const rows = BOOKING_RULE_CATALOGUE.map(toSeedRow);
  const { count } = await client.bookingRule.createMany({ data: rows, skipDuplicates: true });
  return { created: count, skipped: rows.length - count };
};

if (require.main === module) {
  seedBookingRules()
    .then(({ created, skipped }) => {
      process.stdout.write(`Booking rules seed: ${created} created, ${skipped} already present.\n`);
    })
    .catch((err) => {
      process.stderr.write(
        `Booking rules seed failed: ${err.name}${err.code ? ` (${err.code})` : ''}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { seedBookingRules, toSeedRow };
