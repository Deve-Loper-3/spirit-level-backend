jest.mock('../../src/repositories/membership.repository');

const membershipRepository = require('../../src/repositories/membership.repository');
const {
  createMembership,
  listMemberships,
  getMembership,
} = require('../../src/services/membership.service');
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

describe('membership.service - createMembership', () => {
  const actor = { id: 'admin-1', role: Role.ADMIN, email: 'admin@test.invalid' };
  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    jest.clearAllMocks();
    membershipRepository.findByName.mockResolvedValue(null);
    membershipRepository.createWithAudit.mockResolvedValue({
      id: 'm-1',
      name: 'Gold',
      description: null,
      createdAt: new Date('2026-11-12T10:00:00.000Z'),
    });
  });

  it('creates the membership and its MEMBERSHIP_CREATED audit data in one repository call', async () => {
    const result = await createMembership({ actor, payload: { name: '  Gold  ' }, meta });

    expect(membershipRepository.createWithAudit).toHaveBeenCalledTimes(1);
    expect(membershipRepository.createWithAudit).toHaveBeenCalledWith({
      data: { name: 'Gold', description: undefined },
      auditData: {
        action: AuditAction.MEMBERSHIP_CREATED,
        actorId: 'admin-1',
        actorRole: Role.ADMIN,
        email: 'admin@test.invalid',
        userId: null,
        meta,
      },
    });
    expect(result).toMatchObject({ id: 'm-1', name: 'Gold', planCount: 0, plans: [] });
  });

  it('rejects a duplicate name with 409 and writes nothing', async () => {
    membershipRepository.findByName.mockResolvedValue({ id: 'm-0', name: 'Gold' });

    await expect(
      createMembership({ actor, payload: { name: 'gold' }, meta }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'MEMBERSHIP_EXISTS' });
    expect(membershipRepository.createWithAudit).not.toHaveBeenCalled();
  });

  it('maps a unique-index race to 409 MEMBERSHIP_EXISTS', async () => {
    membershipRepository.createWithAudit.mockRejectedValue(
      Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: 'memberships_name_lower_idx' },
      }),
    );

    await expect(
      createMembership({ actor, payload: { name: 'Gold' }, meta }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'MEMBERSHIP_EXISTS' });
  });
});

describe('membership.service - listMemberships and getMembership', () => {
  const planRow = (overrides = {}) => ({
    id: 'plan-1',
    name: 'Gold Class',
    kind: 'SUBSCRIPTION',
    price: 350,
    billingCycle: 'MONTH',
    creditType: 'CLASS',
    creditsIncluded: 15,
    creditRefill: 'MONTHLY',
    validityValue: 1,
    validityUnit: 'MONTH',
    startsOn: 'PURCHASE_DATE',
    oneTimePurchasePerClient: false,
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    description: null,
    version: 1,
    membershipId: 'm-1',
    ...overrides,
  });
  const membershipRow = (overrides = {}) => ({
    id: 'm-1',
    name: 'Gold',
    description: null,
    createdAt: new Date('2026-11-12T10:00:00.000Z'),
    plans: [planRow(), planRow({ id: 'plan-2', name: 'Gold Plus' })],
    _count: { plans: 2 },
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it('asks the repository for exactly the requested page and returns the pagination', async () => {
    membershipRepository.listPage.mockResolvedValue({ rows: [membershipRow()], total: 45 });

    const result = await listMemberships({ query: { page: 3, limit: 10 } });

    expect(membershipRepository.listPage).toHaveBeenCalledWith({ skip: 20, take: 10 });
    expect(result.pagination).toEqual({ page: 3, limit: 10, total: 45, totalPages: 5 });
    expect(result.memberships).toHaveLength(1);
  });

  it('takes planCount from the database count, not from the loaded plans', async () => {
    membershipRepository.listPage.mockResolvedValue({
      rows: [membershipRow({ plans: [planRow()], _count: { plans: 7 } })],
      total: 1,
    });

    const { memberships } = await listMemberships({ query: { page: 1, limit: 20 } });

    expect(memberships[0].planCount).toBe(7);
  });

  it('maps every plan to the full plan view with its membership, and has no creditNote', async () => {
    membershipRepository.findByIdWithPlans.mockResolvedValue(membershipRow());

    const result = await getMembership('m-1');

    expect(result).toMatchObject({ id: 'm-1', name: 'Gold', description: null, planCount: 2 });
    expect(result.plans[0]).toMatchObject({
      id: 'plan-1',
      kind: 'subscription',
      membershipId: 'm-1',
      membership: { id: 'm-1', name: 'Gold', description: null },
    });
    expect(result.plans[0]).not.toHaveProperty('creditNote');
  });

  it('getMembership gives a list item and a get-by-id result of the same shape', async () => {
    membershipRepository.listPage.mockResolvedValue({ rows: [membershipRow()], total: 1 });
    membershipRepository.findByIdWithPlans.mockResolvedValue(membershipRow());

    const { memberships } = await listMemberships({ query: { page: 1, limit: 20 } });
    const single = await getMembership('m-1');

    expect(single).toEqual(memberships[0]);
  });

  it('getMembership is 404 MEMBERSHIP_NOT_FOUND for an unknown id', async () => {
    membershipRepository.findByIdWithPlans.mockResolvedValue(null);

    await expect(getMembership('missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'MEMBERSHIP_NOT_FOUND',
    });
  });
});
