const prisma = require('../../src/config/prisma');
const {
  createCoachProfile,
  findCoachById,
  findCoachByUserId,
  updateCoachWithUser,
  updateCoachStatus,
  listCoaches,
} = require('../../src/repositories/coach.repository');

jest.mock('../../src/config/prisma', () => ({
  coach: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
}));

describe('coach.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.coach.findMany.mockReturnValue('findManyQuery');
    prisma.coach.count.mockReturnValue('countQuery');
    prisma.$transaction.mockResolvedValue([[{ id: 'c1' }], 7]);
  });

  describe('createCoachProfile', () => {
    const data = { id: 'c-1', userId: 'u-1', coachType: 'SALARIED', bio: 'Bio', status: 'ACTIVE' };

    it('uses the default prisma client when no transaction is given', async () => {
      prisma.coach.create.mockResolvedValue(data);

      const result = await createCoachProfile(data);

      expect(prisma.coach.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(data);
    });

    it('uses the transaction client when it is given', async () => {
      const tx = { coach: { create: jest.fn().mockResolvedValue(data) } };

      await createCoachProfile(data, tx);

      expect(tx.coach.create).toHaveBeenCalledWith({ data });
      expect(prisma.coach.create).not.toHaveBeenCalled();
    });
  });

  describe('findCoachById', () => {
    it('selects the coach with only the safe user columns', async () => {
      prisma.coach.findUnique.mockResolvedValue({ id: 'c1' });

      const result = await findCoachById('c1');

      const args = prisma.coach.findUnique.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'c1' });
      expect(Object.keys(args.select.user.select).sort()).toEqual(
        ['email', 'fullName', 'id', 'phone', 'profileImageUrl'].sort(),
      );
      expect(result).toEqual({ id: 'c1' });
    });
  });

  describe('findCoachByUserId', () => {
    it('looks the coach up by the unique userId with the safe select', async () => {
      prisma.coach.findUnique.mockResolvedValue({ id: 'c1' });

      const result = await findCoachByUserId('u1');

      const args = prisma.coach.findUnique.mock.calls[0][0];
      expect(args.where).toEqual({ userId: 'u1' });
      expect(args.select.user.select).not.toHaveProperty('passwordHash');
      expect(result).toEqual({ id: 'c1' });
    });

    it('returns null when the user has no coach profile', async () => {
      prisma.coach.findUnique.mockResolvedValue(null);

      expect(await findCoachByUserId('u2')).toBeNull();
    });
  });

  describe('updateCoachWithUser', () => {
    it('sends the user columns as one nested update together with the coach columns', async () => {
      prisma.coach.update.mockResolvedValue({ id: 'c1' });

      const result = await updateCoachWithUser('c1', {
        userFields: { fullName: 'New' },
        coachFields: { bio: 'Bio' },
      });

      const args = prisma.coach.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'c1' });
      expect(args.data).toEqual({
        bio: 'Bio',
        updatedAt: expect.any(Date),
        user: { update: { fullName: 'New' } },
      });
      expect(args.select.user.select).not.toHaveProperty('passwordHash');
      expect(result).toEqual({ id: 'c1' });
    });

    it('omits the nested user write when no user column changes', async () => {
      prisma.coach.update.mockResolvedValue({ id: 'c1' });

      await updateCoachWithUser('c1', { userFields: {}, coachFields: { coachType: 'FREELANCE' } });

      expect(prisma.coach.update.mock.calls[0][0].data).toEqual({
        coachType: 'FREELANCE',
        updatedAt: expect.any(Date),
      });
    });

    it('stamps updatedAt on the coach row when only user columns change', async () => {
      prisma.coach.update.mockResolvedValue({ id: 'c1' });

      await updateCoachWithUser('c1', { userFields: { phone: '+1555' }, coachFields: {} });

      expect(prisma.coach.update.mock.calls[0][0].data).toEqual({
        updatedAt: expect.any(Date),
        user: { update: { phone: '+1555' } },
      });
    });

    it('uses the transaction client when it is given', async () => {
      const tx = { coach: { update: jest.fn().mockResolvedValue({ id: 'c1' }) } };

      await updateCoachWithUser('c1', { userFields: {}, coachFields: { bio: 'x' } }, tx);

      expect(tx.coach.update).toHaveBeenCalledTimes(1);
      expect(prisma.coach.update).not.toHaveBeenCalled();
    });
  });

  describe('updateCoachStatus', () => {
    it('only matches a coach whose status differs and reports whether it changed', async () => {
      prisma.coach.updateMany.mockResolvedValue({ count: 1 });

      const changed = await updateCoachStatus('c1', 'INACTIVE');

      expect(prisma.coach.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', status: { not: 'INACTIVE' } },
        data: { status: 'INACTIVE' },
      });
      expect(changed).toBe(true);
    });

    it('returns false when the coach already has that status', async () => {
      prisma.coach.updateMany.mockResolvedValue({ count: 0 });

      expect(await updateCoachStatus('c1', 'ACTIVE')).toBe(false);
    });

    it('uses the transaction client when it is given', async () => {
      const tx = { coach: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };

      await updateCoachStatus('c1', 'ACTIVE', tx);

      expect(tx.coach.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.coach.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listCoaches', () => {
    it('runs the page and the count with the same where in one transaction', async () => {
      const result = await listCoaches({
        status: 'ACTIVE',
        coachType: 'FREELANCE',
        search: 'ann',
        skip: 20,
        take: 10,
      });

      const where = {
        status: 'ACTIVE',
        coachType: 'FREELANCE',
        user: {
          OR: [
            { fullName: { contains: 'ann', mode: 'insensitive' } },
            { email: { contains: 'ann', mode: 'insensitive' } },
          ],
        },
      };
      expect(prisma.$transaction).toHaveBeenCalledWith(['findManyQuery', 'countQuery']);
      expect(prisma.coach.count).toHaveBeenCalledWith({ where });
      expect(prisma.coach.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          skip: 20,
          take: 10,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );
      expect(result).toEqual({ rows: [{ id: 'c1' }], total: 7 });
    });

    it('escapes backslash, % and _ in the search term', async () => {
      await listCoaches({ search: 'a%b_c\\d', skip: 0, take: 20 });

      const [{ where }] = prisma.coach.count.mock.calls[0];
      expect(where.user.OR[0].fullName.contains).toBe('a\\%b\\_c\\\\d');
      expect(where.user.OR[1].email.contains).toBe('a\\%b\\_c\\\\d');
    });

    it('searches only the listed fields (a name-only search never touches the email)', async () => {
      await listCoaches({ search: 'ann', searchFields: ['fullName'], skip: 0, take: 20 });

      const { where } = prisma.coach.count.mock.calls[0][0];
      expect(where.user.OR).toEqual([{ fullName: { contains: 'ann', mode: 'insensitive' } }]);
      expect(JSON.stringify(where)).not.toContain('email');
    });

    it('uses an empty where when no filter and no search is given', async () => {
      await listCoaches({ skip: 0, take: 20 });

      expect(prisma.coach.count).toHaveBeenCalledWith({ where: {} });
    });

    it('adds no user clause without a search term', async () => {
      await listCoaches({ status: 'INACTIVE', skip: 0, take: 20 });

      expect(prisma.coach.count).toHaveBeenCalledWith({ where: { status: 'INACTIVE' } });
    });
  });
});
