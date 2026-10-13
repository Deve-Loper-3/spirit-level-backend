jest.mock('../../src/services/coach.service', () => ({
  listCoaches: jest.fn(),
  getCoach: jest.fn(),
  getMyCoach: jest.fn(),
  updateCoach: jest.fn(),
  setCoachStatus: jest.fn(),
}));

const {
  listCoaches,
  getCoach,
  getMyCoach,
  createUpdateCoachHandler,
  setCoachStatus,
} = require('../../src/controllers/coach.controller');
const coachService = require('../../src/services/coach.service');
const { Messages } = require('../../src/constants/messages');
const { Role } = require('../../src/constants/roles');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const buildReq = (overrides = {}) => ({
  user: { id: 'actor-1', role: Role.ADMIN, status: 'ACTIVE' },
  params: { coachId: 'c1' },
  body: {},
  ip: '203.0.113.7',
  get: jest.fn().mockReturnValue('jest-coach/1.0'),
  ...overrides,
});

const META = { ipAddress: '203.0.113.7', userAgent: 'jest-coach/1.0' };
const CALLER = { id: 'actor-1', role: Role.ADMIN };

describe('coach.controller', () => {
  describe('listCoaches', () => {
    it('responds 200 with data and pagination, using the validated query', async () => {
      const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
      coachService.listCoaches.mockResolvedValue({ coaches: [{ id: 'c1' }], pagination });
      const req = buildReq({ validatedQuery: { page: 1, limit: 20 }, query: { page: 'raw' } });
      const res = buildRes();

      await listCoaches(req, res, jest.fn());

      expect(coachService.listCoaches).toHaveBeenCalledWith({
        caller: CALLER,
        query: { page: 1, limit: 20 },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: undefined,
        data: [{ id: 'c1' }],
        pagination,
      });
    });

    it('forwards service errors to next', async () => {
      const error = new Error('boom');
      coachService.listCoaches.mockRejectedValue(error);
      const res = buildRes();
      const next = jest.fn();

      await listCoaches(buildReq({ validatedQuery: {} }), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('getCoach', () => {
    it('responds 200 with the coach and no pagination key', async () => {
      coachService.getCoach.mockResolvedValue({ id: 'c1' });
      const res = buildRes();

      await getCoach(buildReq(), res, jest.fn());

      expect(coachService.getCoach).toHaveBeenCalledWith({ caller: CALLER, coachId: 'c1' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0]).toEqual({ success: true, data: { id: 'c1' } });
      expect(res.json.mock.calls[0][0]).not.toHaveProperty('pagination');
    });

    it('forwards service errors to next', async () => {
      const error = new Error('not found');
      coachService.getCoach.mockRejectedValue(error);
      const next = jest.fn();

      await getCoach(buildReq({ params: { coachId: 'x' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getMyCoach', () => {
    it('passes the caller to the service and responds 200 with the coach', async () => {
      coachService.getMyCoach.mockResolvedValue({ id: 'c1' });
      const res = buildRes();

      await getMyCoach(buildReq({ user: { id: 'u9', role: Role.COACH } }), res, jest.fn());

      expect(coachService.getMyCoach).toHaveBeenCalledWith({ id: 'u9', role: Role.COACH });
      expect(res.json.mock.calls[0][0]).toEqual({ success: true, data: { id: 'c1' } });
    });

    it('forwards service errors to next', async () => {
      const error = new Error('boom');
      coachService.getMyCoach.mockRejectedValue(error);
      const next = jest.fn();

      await getMyCoach(buildReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('createUpdateCoachHandler', () => {
    const FIELDS_BY_ROLE = new Map([
      [Role.ADMIN, ['bio', 'coachType']],
      [Role.COACH, ['bio']],
    ]);

    it('calls the service with the actor, id, body, its own allowedFields and the request meta', async () => {
      coachService.updateCoach.mockResolvedValue({ id: 'c1', bio: 'x' });
      const handler = createUpdateCoachHandler(FIELDS_BY_ROLE);
      const req = buildReq({ body: { bio: 'x' } });
      const res = buildRes();

      await handler(req, res, jest.fn());

      expect(coachService.updateCoach).toHaveBeenCalledWith({
        actor: { id: 'actor-1', role: Role.ADMIN },
        coachId: 'c1',
        changes: { bio: 'x' },
        allowedFields: ['bio', 'coachType'],
        meta: META,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: Messages.COACH_UPDATED_SUCCESS,
        data: { id: 'c1', bio: 'x' },
      });
    });

    it('picks the allowed fields by the caller role', async () => {
      coachService.updateCoach.mockResolvedValue({});
      const handler = createUpdateCoachHandler(FIELDS_BY_ROLE);

      await handler(buildReq({ user: { id: 'u1', role: Role.COACH } }), buildRes(), jest.fn());
      await handler(buildReq({ user: { id: 'u2', role: Role.ADMIN } }), buildRes(), jest.fn());

      expect(coachService.updateCoach.mock.calls[0][0].allowedFields).toEqual(['bio']);
      expect(coachService.updateCoach.mock.calls[1][0].allowedFields).toEqual(['bio', 'coachType']);
    });

    it('passes no fields for a role without an entry', async () => {
      coachService.updateCoach.mockResolvedValue({});

      await createUpdateCoachHandler(FIELDS_BY_ROLE)(
        buildReq({ user: { id: 'u3', role: Role.MEMBER } }),
        buildRes(),
        jest.fn(),
      );

      expect(coachService.updateCoach.mock.calls[0][0].allowedFields).toEqual([]);
    });

    it('forwards service errors to next and sends no response', async () => {
      const error = new Error('boom');
      coachService.updateCoach.mockRejectedValue(error);
      const res = buildRes();
      const next = jest.fn();

      await createUpdateCoachHandler(FIELDS_BY_ROLE)(buildReq(), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('setCoachStatus', () => {
    it('calls the service with the actor, id, status and meta and responds 200', async () => {
      coachService.setCoachStatus.mockResolvedValue({ id: 'c1', status: 'INACTIVE' });
      const res = buildRes();

      await setCoachStatus(buildReq({ body: { status: 'INACTIVE' } }), res, jest.fn());

      expect(coachService.setCoachStatus).toHaveBeenCalledWith({
        actor: { id: 'actor-1', role: Role.ADMIN },
        coachId: 'c1',
        status: 'INACTIVE',
        meta: META,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: Messages.COACH_STATUS_UPDATED_SUCCESS,
        data: { id: 'c1', status: 'INACTIVE' },
      });
    });

    it('forwards service errors to next', async () => {
      const error = new Error('boom');
      coachService.setCoachStatus.mockRejectedValue(error);
      const next = jest.fn();

      await setCoachStatus(buildReq({ body: { status: 'ACTIVE' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
