const request = require('supertest');
const { createApp } = require('../../src/app');
const authService = require('../../src/services/auth.service');
const { Messages } = require('../../src/constants/messages');
const { AccountStatus } = require('../../src/constants/status');

jest.mock('../../src/services/auth.service');

describe('POST /api/v1/auth/register/complete (smoke test)', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('responds 200 with completion data on valid payload', async () => {
    const validPayload = {
      registrationId: '123e4567-e89b-12d3-a456-426614174000',
      emergencyContact: {
        name: 'Jane Doe',
        phone: '+1 (202) 555-0199',
        relationship: 'SPOUSE',
      },
      waiverAccepted: true,
    };

    const mockResult = {
      id: validPayload.registrationId,
      status: AccountStatus.ACTIVE,
      registrationCompletedAt: '2026-10-04T09:00:00.000Z',
    };

    authService.completeMemberRegistration.mockResolvedValue(mockResult);

    const res = await request(app)
      .post('/api/v1/auth/register/complete')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(Messages.REGISTRATION_COMPLETE_SUCCESS);
    expect(res.body.data).toEqual(mockResult);
    expect(authService.completeMemberRegistration).toHaveBeenCalledWith({
      registrationId: validPayload.registrationId,
      emergencyContact: {
        name: 'Jane Doe',
        phone: '+12025550199',
        relationship: 'SPOUSE',
      },
      waiverAccepted: true,
    });
  });

  it('responds 200 when emergencyContact has phone only (name and relationship omitted)', async () => {
    const payload = {
      registrationId: '123e4567-e89b-12d3-a456-426614174000',
      emergencyContact: {
        phone: '+1 (202) 555-0199',
      },
      waiverAccepted: true,
    };

    const mockResult = {
      id: payload.registrationId,
      status: AccountStatus.ACTIVE,
      registrationCompletedAt: '2026-10-04T09:00:00.000Z',
    };

    authService.completeMemberRegistration.mockResolvedValue(mockResult);

    const res = await request(app)
      .post('/api/v1/auth/register/complete')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(Messages.REGISTRATION_COMPLETE_SUCCESS);
    expect(res.body.data).toEqual(mockResult);
    expect(authService.completeMemberRegistration).toHaveBeenCalledWith({
      registrationId: payload.registrationId,
      emergencyContact: {
        phone: '+12025550199',
      },
      waiverAccepted: true,
    });
  });

  it('responds 400 when validation fails (missing waiverAccepted)', async () => {
    const invalidPayload = {
      registrationId: '123e4567-e89b-12d3-a456-426614174000',
      emergencyContact: {
        name: 'Jane Doe',
        phone: '+1 (202) 555-0199',
        relationship: 'SPOUSE',
      },
    };

    const res = await request(app)
      .post('/api/v1/auth/register/complete')
      .send(invalidPayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
    expect(authService.completeMemberRegistration).not.toHaveBeenCalled();
  });
});
