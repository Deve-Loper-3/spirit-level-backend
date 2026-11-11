const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const { seedBookingRules } = require('../../prisma/seeds/bookingRules.seed');
const {
  BOOKING_RULE_CATALOGUE,
  API_TO_DB_CATEGORY,
  API_TO_DB_UNIT,
} = require('../../src/constants/bookingRule');
const { snapshotBookingRules, restoreBookingRules } = require('../helpers/bookingRule.helper');

jest.setTimeout(60000);

describe('booking_rules table and seed', () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await snapshotBookingRules();
  });

  beforeEach(async () => {
    await prisma.bookingRule.deleteMany();
  });

  afterAll(async () => {
    await restoreBookingRules(snapshot);
    await prisma.$disconnect();
  });

  const insertRaw = (overrides) =>
    prisma.bookingRule.create({
      data: {
        id: crypto.randomUUID(),
        ruleKey: 'TEST_RULE',
        category: 'BOOKING_WINDOW',
        name: 'Test rule',
        value: 5,
        unit: 'HOURS',
        enabled: true,
        ...overrides,
      },
    });

  describe('seedBookingRules', () => {
    it('creates all 21 catalogue rows with the approved defaults', async () => {
      const result = await seedBookingRules();
      expect(result).toEqual({ created: 21, skipped: 0 });

      const rows = await prisma.bookingRule.findMany();
      expect(rows).toHaveLength(21);
      BOOKING_RULE_CATALOGUE.forEach((entry) => {
        const row = rows.find((r) => r.ruleKey === entry.ruleKey);
        expect(row).toMatchObject({
          category: API_TO_DB_CATEGORY[entry.category],
          name: entry.name,
          value: entry.defaultValue,
          unit: entry.unit ? API_TO_DB_UNIT[entry.unit] : null,
          enabled: entry.defaultEnabled,
        });
      });
    });

    it('is idempotent: a second run creates nothing', async () => {
      await seedBookingRules();
      expect(await seedBookingRules()).toEqual({ created: 0, skipped: 21 });
      expect(await prisma.bookingRule.count()).toBe(21);
    });

    it('does not overwrite a row that was edited', async () => {
      await seedBookingRules();
      await prisma.bookingRule.update({
        where: { ruleKey: 'WAITLIST_MAX_PER_CLASS' },
        data: { value: 9, enabled: false },
      });

      await seedBookingRules();

      const row = await prisma.bookingRule.findUnique({
        where: { ruleKey: 'WAITLIST_MAX_PER_CLASS' },
      });
      expect(row).toMatchObject({ value: 9, enabled: false });
    });

    it('adds back only the row that was deleted', async () => {
      await seedBookingRules();
      await prisma.bookingRule.delete({ where: { ruleKey: 'LATE_FEE' } });

      expect(await seedBookingRules()).toEqual({ created: 1, skipped: 20 });
      expect(await prisma.bookingRule.count()).toBe(21);
    });

    it('seeds the disabled-by-default rules as disabled', async () => {
      await seedBookingRules();
      const disabled = await prisma.bookingRule.findMany({
        where: { enabled: false },
        orderBy: { ruleKey: 'asc' },
      });
      expect(disabled.map((r) => r.ruleKey)).toEqual([
        'CLIENT_SELF_PAUSE',
        'CREDIT_OVERDRAFT',
        'LATE_FEE',
        'MAX_CLASSES_PER_WEEK',
      ]);
    });
  });

  describe('table constraints', () => {
    it('blocks a duplicate ruleKey', async () => {
      await insertRaw({});
      await expect(insertRaw({})).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rejects a negative value', async () => {
      await expect(insertRaw({ value: -1 })).rejects.toThrow();
    });

    it.each([
      ['hours above 8760', { unit: 'HOURS', value: 8761 }],
      ['days above 365', { unit: 'DAYS', value: 366 }],
      ['count above 1000', { unit: 'COUNT', value: 1001 }],
      ['percent of 0', { unit: 'PERCENT', value: 0 }],
      ['percent above 100', { unit: 'PERCENT', value: 101 }],
    ])('rejects %s', async (_label, overrides) => {
      await expect(insertRaw(overrides)).rejects.toThrow();
    });

    it('accepts values on the bounds', async () => {
      await expect(insertRaw({ ruleKey: 'A', unit: 'HOURS', value: 8760 })).resolves.toBeTruthy();
      await expect(insertRaw({ ruleKey: 'B', unit: 'PERCENT', value: 1 })).resolves.toBeTruthy();
      await expect(insertRaw({ ruleKey: 'C', unit: 'COUNT', value: 0 })).resolves.toBeTruthy();
    });

    it('rejects a unit without a value and a value without a unit', async () => {
      await expect(insertRaw({ ruleKey: 'D', unit: 'HOURS', value: null })).rejects.toThrow();
      await expect(insertRaw({ ruleKey: 'E', unit: null, value: 5 })).rejects.toThrow();
    });

    it('accepts a flag rule with neither unit nor value', async () => {
      await expect(insertRaw({ ruleKey: 'F', unit: null, value: null })).resolves.toBeTruthy();
    });
  });
});
