const { Role } = require('../../src/constants/roles');
const { ClassVisibility } = require('../../src/constants/class');
const { Messages } = require('../../src/constants/messages');
const {
  buildClassWhere,
  createClass,
  updateClass,
  deactivateClass,
  activateClass,
  archiveClass,
  updateClassEligibility,
} = require('../../src/services/class.service');
const repository = require('../../src/repositories/class.repository');

jest.mock('../../src/repositories/class.repository');

describe('Class Service Unit Tests', () => {
  const planId = 'b0000000-0000-4000-8000-000000000001';

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buildClassWhere', () => {
    it('scopes MEMBER to status=ACTIVE and visibility=PUBLIC only', () => {
      const user = { role: Role.MEMBER, id: 'm1' };
      const where = buildClassWhere({ user, query: { visibility: 'private', active: 'all' } });
      expect(where).toEqual({
        status: 'ACTIVE',
        visibility: ClassVisibility.PUBLIC,
      });
    });

    it('scopes COACH to active public OR classes where coach is assigned', () => {
      const user = { role: Role.COACH, id: 'coach-user-1' };
      const where = buildClassWhere({ user, query: {} });
      expect(where).toEqual({
        OR: [
          { status: 'ACTIVE', visibility: ClassVisibility.PUBLIC },
          { coaches: { some: { coach: { userId: 'coach-user-1' } } } },
        ],
      });
    });

    it('scopes STAFF (OWNER/ADMIN) with default excluding archived, and supports active, status', () => {
      const admin = { role: Role.ADMIN, id: 'admin-1' };
      expect(buildClassWhere({ user: admin, query: {} })).toEqual({
        status: { in: ['ACTIVE', 'DEACTIVATED'] },
      });
      expect(buildClassWhere({ user: admin, query: { active: 'false' } })).toEqual({
        status: 'DEACTIVATED',
      });
      expect(buildClassWhere({ user: admin, query: { status: 'archived' } })).toEqual({
        status: 'ARCHIVED',
      });
      expect(
        buildClassWhere({ user: admin, query: { active: 'all', visibility: 'public' } }),
      ).toEqual({
        visibility: 'PUBLIC',
      });
    });
  });

  describe('createClass', () => {
    it('throws 400 if public class has no eligible plan IDs', async () => {
      await expect(
        createClass({
          payload: {
            name: 'Hyrox Engine',
            visibility: ClassVisibility.PUBLIC,
            eligiblePlanIds: [],
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: Messages.CLASS_PUBLIC_REQUIRES_PLANS,
      });
    });

    it('throws 400 if an unknown plan ID is provided', async () => {
      repository.validatePlanIds.mockResolvedValueOnce({
        valid: false,
        unknownIds: ['bad-id'],
        archivedIds: [],
      });

      await expect(
        createClass({
          payload: {
            name: 'Hyrox Engine',
            visibility: ClassVisibility.PUBLIC,
            eligiblePlanIds: ['bad-id'],
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: Messages.CLASS_PLAN_NOT_FOUND,
      });
    });

    it('throws 400 if an archived plan ID is provided', async () => {
      repository.validatePlanIds.mockResolvedValueOnce({
        valid: false,
        unknownIds: [],
        archivedIds: [planId],
      });

      await expect(
        createClass({
          payload: {
            name: 'Hyrox Engine',
            visibility: ClassVisibility.PUBLIC,
            eligiblePlanIds: [planId],
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: Messages.CLASS_PLAN_ARCHIVED,
      });
    });

    it('throws 409 CLASS_DUPLICATE_NAME if active class with same name already exists', async () => {
      repository.validatePlanIds.mockResolvedValueOnce({
        valid: true,
        unknownIds: [],
        archivedIds: [],
      });
      repository.findActiveByName.mockResolvedValueOnce({
        id: 'existing-id',
        name: 'Hyrox Engine',
      });

      await expect(
        createClass({
          payload: {
            name: 'Hyrox Engine',
            visibility: ClassVisibility.PUBLIC,
            eligiblePlanIds: [planId],
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CLASS_DUPLICATE_NAME',
      });
    });
  });

  describe('updateClass', () => {
    it('throws 409 CLASS_INACTIVE if attempting to update an inactive class', async () => {
      await expect(
        updateClass({
          classRecord: { id: 'c1', active: false },
          payload: { description: 'new' },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CLASS_INACTIVE',
      });
    });

    it('throws 409 CLASS_VERSION_CONFLICT on version mismatch', async () => {
      await expect(
        updateClass({
          classRecord: { id: 'c1', active: true, version: 1 },
          payload: { description: 'new', version: 2 },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CLASS_VERSION_CONFLICT',
      });
    });
  });

  describe('deactivateClass', () => {
    it('returns 200 { id, status: "deactivated", active: false } idempotently if already inactive', async () => {
      const res = await deactivateClass({
        classRecord: { id: 'c1', status: 'DEACTIVATED', active: false },
      });
      expect(res).toEqual({ id: 'c1', status: 'deactivated', active: false });
      expect(repository.countFutureBookedSessions).not.toHaveBeenCalled();
    });

    it('throws 409 CLASS_HAS_FUTURE_BOOKINGS with details.sessionCount when future bookings exist', async () => {
      repository.countFutureBookedSessions.mockResolvedValueOnce(3);

      await expect(
        deactivateClass({
          classRecord: { id: 'c1', status: 'ACTIVE', active: true },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CLASS_HAS_FUTURE_BOOKINGS',
        details: { sessionCount: 3 },
      });
      expect(repository.deactivateClass).not.toHaveBeenCalled();
    });

    it('deactivates class when 0 future bookings exist', async () => {
      repository.countFutureBookedSessions.mockResolvedValueOnce(0);
      repository.deactivateClass.mockResolvedValueOnce({
        id: 'c1',
        status: 'deactivated',
        active: false,
      });

      const res = await deactivateClass({
        classRecord: { id: 'c1', status: 'ACTIVE', active: true },
      });
      expect(res).toEqual({ id: 'c1', status: 'deactivated', active: false });
      expect(repository.deactivateClass).toHaveBeenCalledWith('c1');
    });
  });

  describe('activateClass', () => {
    it('returns 200 { id, status: "active", active: true } idempotently if already active', async () => {
      const res = await activateClass({
        classRecord: { id: 'c1', status: 'ACTIVE', active: true },
      });
      expect(res).toEqual({ id: 'c1', status: 'active', active: true });
      expect(repository.activateClass).not.toHaveBeenCalled();
    });

    it('activates class when inactive', async () => {
      repository.activateClass.mockResolvedValueOnce({
        id: 'c1',
        status: 'active',
        active: true,
      });

      const res = await activateClass({
        classRecord: { id: 'c1', status: 'DEACTIVATED', active: false },
      });
      expect(res).toEqual({ id: 'c1', status: 'active', active: true });
      expect(repository.activateClass).toHaveBeenCalledWith('c1');
    });
  });

  describe('archiveClass', () => {
    it('returns 200 { id, status: "archived", active: false } idempotently if already archived', async () => {
      const res = await archiveClass({
        classRecord: { id: 'c1', status: 'ARCHIVED', active: false },
      });
      expect(res).toEqual({ id: 'c1', status: 'archived', active: false });
      expect(repository.countFutureBookedSessions).not.toHaveBeenCalled();
    });

    it('archives class when 0 future bookings exist', async () => {
      repository.countFutureBookedSessions.mockResolvedValueOnce(0);
      repository.archiveClass.mockResolvedValueOnce({
        id: 'c1',
        status: 'archived',
        active: false,
      });

      const res = await archiveClass({
        classRecord: { id: 'c1', status: 'ACTIVE', active: true },
      });
      expect(res).toEqual({ id: 'c1', status: 'archived', active: false });
      expect(repository.archiveClass).toHaveBeenCalledWith('c1');
    });
  });

  describe('updateClassEligibility', () => {
    it('throws 409 CLASS_INACTIVE if class is inactive', async () => {
      await expect(
        updateClassEligibility({
          classRecord: { id: 'c1', active: false },
          planIds: [planId],
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CLASS_INACTIVE',
      });
    });

    it('throws 400 if public class is submitted with empty planIds', async () => {
      await expect(
        updateClassEligibility({
          classRecord: { id: 'c1', active: true, visibility: ClassVisibility.PUBLIC },
          planIds: [],
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: Messages.CLASS_PUBLIC_REQUIRES_PLANS,
      });
    });

    it('allows private class to be updated with empty planIds', async () => {
      repository.replaceEligiblePlans.mockResolvedValueOnce([]);

      const res = await updateClassEligibility({
        classRecord: { id: 'c1', active: true, visibility: ClassVisibility.PRIVATE },
        planIds: [],
      });
      expect(res).toEqual({ classId: 'c1', planIds: [] });
    });
  });
});
