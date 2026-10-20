jest.mock('../../src/services/staff.service', () => ({
  createStaff: jest.fn(),
  createCoach: jest.fn(),
}));

const { createStaff, createCoach } = require('../../src/controllers/staff.controller');
const staffService = require('../../src/services/staff.service');
const { Messages } = require('../../src/constants/messages');
const { Role } = require('../../src/constants/roles');

const TEMP_PASSWORD = 'Tmp-Secret-Password-123!';
const STAFF_USER = {
  id: 'staff-id',
  fullName: 'Sam Coach',
  email: 'sam@test.invalid',
  phone: '+12025551234',
  role: Role.COACH,
  status: 'ACTIVE',
};

const buildReq = () => ({
  user: { id: 'actor-id', role: Role.ADMIN, status: 'ACTIVE' },
  body: { fullName: 'Sam Coach', email: 'sam@test.invalid', phone: '+12025551234', role: 'COACH' },
  ip: '203.0.113.7',
  get: jest.fn().mockReturnValue('jest-staff/1.0'),
});

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('staff.controller - createStaff', () => {
  beforeEach(() => {
    staffService.createStaff.mockResolvedValue({
      user: STAFF_USER,
      tempPassword: TEMP_PASSWORD,
      emailSent: true,
    });
  });

  it('responds 201 with the staff user and emailSent in the standard shape', async () => {
    const res = buildRes();

    await createStaff(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: Messages.STAFF_CREATED_SUCCESS,
      data: { ...STAFF_USER, emailSent: true },
    });
  });

  it('reports emailSent false when the invitation email failed', async () => {
    staffService.createStaff.mockResolvedValue({
      user: STAFF_USER,
      tempPassword: 'x',
      emailSent: false,
    });
    const res = buildRes();

    await createStaff(buildReq(), res, jest.fn());

    expect(res.json.mock.calls[0][0].data.emailSent).toBe(false);
  });

  it('never includes the temporary password in the response', async () => {
    const res = buildRes();

    await createStaff(buildReq(), res, jest.fn());

    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain(TEMP_PASSWORD);
    expect(body).not.toContain('tempPassword');
  });

  it('passes only id and role as actor, the body as payload and the request meta', async () => {
    const req = buildReq();

    await createStaff(req, buildRes(), jest.fn());

    expect(staffService.createStaff).toHaveBeenCalledWith(
      { id: 'actor-id', role: Role.ADMIN },
      req.body,
      { ipAddress: '203.0.113.7', userAgent: 'jest-staff/1.0' },
    );
  });

  it('forwards service errors to next and sends no response', async () => {
    const error = new Error('boom');
    staffService.createStaff.mockRejectedValue(error);
    const res = buildRes();
    const next = jest.fn();

    await createStaff(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('staff.controller - createCoach', () => {
  const COACH = {
    id: 'coach-id',
    userId: 'staff-id',
    fullName: 'Sam Coach',
    coachType: 'FREELANCE',
  };

  beforeEach(() => {
    staffService.createCoach.mockResolvedValue({ coach: COACH, emailSent: true });
  });

  it('responds 201 with the coach and emailSent in the standard shape', async () => {
    const res = buildRes();

    await createCoach(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: Messages.COACH_CREATED_SUCCESS,
      data: { ...COACH, emailSent: true },
    });
  });

  it('passes only id and role as actor, the body as payload and the request meta', async () => {
    const req = buildReq();

    await createCoach(req, buildRes(), jest.fn());

    expect(staffService.createCoach).toHaveBeenCalledWith(
      { id: 'actor-id', role: Role.ADMIN },
      req.body,
      { ipAddress: '203.0.113.7', userAgent: 'jest-staff/1.0' },
    );
  });

  it('forwards service errors to next and sends no response', async () => {
    const error = new Error('boom');
    staffService.createCoach.mockRejectedValue(error);
    const res = buildRes();
    const next = jest.fn();

    await createCoach(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
