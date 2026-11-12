const prisma = require('../../src/config/prisma');
const { COMMERCIAL_FIELDS } = require('../../src/constants/membershipPlan');
const {
  deleteTestPlans,
  createTestPlan,
  createTestMembership,
  deleteTestMemberships,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

// The version of a plan is bumped by a BEFORE UPDATE trigger in the database, not by the app.
// These tests pin down exactly which columns it reacts to.
describe('membership_plans version trigger', () => {
  const PREFIX = 'test_slmp04_ver_';

  // The fields that make a new commercial version: the 7 of SL-MP-01 plus term, recurring,
  // periodMonths and joiningFee (migration 20261112110000).
  const EXPECTED_COMMERCIAL_FIELDS = [
    'price',
    'billingCycle',
    'creditType',
    'creditsIncluded',
    'creditRefill',
    'validityValue',
    'validityUnit',
    'term',
    'recurring',
    'periodMonths',
    'joiningFee',
  ];

  const COMMERCIAL_CHANGES = {
    price: 150,
    billingCycle: 'QUARTER',
    creditType: 'APPOINTMENT',
    creditsIncluded: 11,
    creditRefill: 'ONCE',
    validityValue: 2,
    validityUnit: 'WEEK',
    term: '6 months',
    recurring: (plan) => !plan.recurring, // always the opposite of the fixture's value
    periodMonths: 6,
    joiningFee: 25,
  };

  const NON_COMMERCIAL_CHANGES = {
    name: `${PREFIX}renamed`,
    kind: 'CREDIT_PACK',
    startsOn: 'FIRST_BOOKING',
    oneTimePurchasePerClient: true,
    visibility: 'HIDDEN',
    status: 'INACTIVE',
    description: 'a different description',
    externalRef: `${PREFIX}ref`,
    membershipId: null,
  };

  // A change may be a function of the fixture plan, so it can never equal the value already stored.
  const resolveChanges = (changes, plan) =>
    Object.fromEntries(
      Object.entries(changes).map(([field, value]) => [
        field,
        typeof value === 'function' ? value(plan) : value,
      ]),
    );

  const update = (id, data) => prisma.membershipPlan.update({ where: { id }, data });

  beforeAll(async () => {
    await deleteTestPlans(PREFIX);
    await deleteTestMemberships(PREFIX);
    const testMembership = await createTestMembership(PREFIX);
    NON_COMMERCIAL_CHANGES.membershipId = testMembership.id;
  });

  afterAll(async () => {
    await deleteTestPlans(PREFIX);
    await deleteTestMemberships(PREFIX);
    await prisma.$disconnect();
  });

  it('the app list of commercial fields is exactly the expected list', () => {
    expect([...COMMERCIAL_FIELDS].sort()).toEqual([...EXPECTED_COMMERCIAL_FIELDS].sort());
  });

  it('the trigger function compares exactly the commercial fields', async () => {
    const [{ definition }] = await prisma.$queryRaw`
      SELECT pg_get_functiondef('bump_membership_plan_version'::regproc) AS definition`;

    const compared = [...definition.matchAll(/OLD\."(\w+)" IS DISTINCT FROM NEW\."\1"/g)].map(
      (match) => match[1],
    );

    expect(compared.sort()).toEqual([...COMMERCIAL_FIELDS].sort());
  });

  it('every column of a plan is covered by one of the two lists above', async () => {
    const columns = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'membership_plans'`;
    const known = new Set([
      'id',
      'version',
      'createdAt',
      'updatedAt',
      ...Object.keys(COMMERCIAL_CHANGES),
      ...Object.keys(NON_COMMERCIAL_CHANGES),
    ]);

    expect(columns.map((column) => column.column_name).filter((name) => !known.has(name))).toEqual(
      [],
    );
  });

  it.each(Object.entries(COMMERCIAL_CHANGES))(
    'changing %s bumps the version by exactly 1',
    async (field, value) => {
      const plan = await createTestPlan(PREFIX, { creditRefill: 'MONTHLY' });

      const updated = await update(plan.id, resolveChanges({ [field]: value }, plan));

      expect(updated.version).toBe(plan.version + 1);
    },
  );

  it.each(Object.entries(NON_COMMERCIAL_CHANGES))(
    'changing %s leaves the version alone',
    async (field, value) => {
      const plan = await createTestPlan(PREFIX);

      const updated = await update(plan.id, { [field]: value });

      expect(updated.version).toBe(plan.version);
    },
  );

  it('changing several commercial fields in one statement bumps by 1, not by 1 per field', async () => {
    const plan = await createTestPlan(PREFIX);

    const updated = await update(plan.id, resolveChanges(COMMERCIAL_CHANGES, plan));

    expect(updated.version).toBe(plan.version + 1);
  });

  it('a commercial and a non-commercial change together bump by 1', async () => {
    const plan = await createTestPlan(PREFIX);
    const updated = await update(plan.id, { price: 175, description: 'both' });
    expect(updated.version).toBe(plan.version + 1);
  });

  it('writing every commercial field with its current value does not bump the version', async () => {
    const plan = await createTestPlan(PREFIX);
    const sameValues = Object.fromEntries(
      EXPECTED_COMMERCIAL_FIELDS.map((field) => [field, plan[field]]),
    );

    const updated = await update(plan.id, sameValues);

    expect(updated.version).toBe(plan.version);
  });

  it('changing membershipId (a plain link) never bumps the version', async () => {
    const plan = await createTestPlan(PREFIX);
    const updated = await update(plan.id, { membershipId: NON_COMMERCIAL_CHANGES.membershipId });
    expect(updated.version).toBe(plan.version);
  });

  it('a price written in another numeric form but equal does not bump the version', async () => {
    const plan = await createTestPlan(PREFIX, { price: 100 });
    const updated = await update(plan.id, { price: '100.00' });
    expect(updated.version).toBe(plan.version);
  });

  it('updateMany, which the API uses, fires the trigger too', async () => {
    const plan = await createTestPlan(PREFIX);

    await prisma.membershipPlan.updateMany({ where: { id: plan.id }, data: { price: 222 } });
    await prisma.membershipPlan.updateMany({
      where: { id: plan.id },
      data: { description: 'no bump' },
    });

    const row = await prisma.membershipPlan.findUnique({ where: { id: plan.id } });
    expect(row.version).toBe(plan.version + 1);
  });

  it('the version keeps rising with each separate commercial change', async () => {
    const plan = await createTestPlan(PREFIX);
    await update(plan.id, { price: 111 });
    await update(plan.id, { price: 112 });
    const updated = await update(plan.id, { price: 113 });
    expect(updated.version).toBe(plan.version + 3);
  });
});
