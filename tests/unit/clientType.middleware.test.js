const mockEnv = { corsOrigins: ['https://app.example.com'] };
jest.mock('../../src/config/env', () => mockEnv);

const clientType = require('../../src/middlewares/clientType.middleware');

const makeReq = (headers) => ({
  get: (name) => headers[name.toLowerCase()],
});

describe('clientType middleware', () => {
  it('sets req.clientType from user-agent and origin and calls next', () => {
    const next = jest.fn();
    const req = makeReq({ 'user-agent': 'okhttp/4.12.0' });

    clientType(req, {}, next);

    expect(req.clientType).toBe('mobile');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('classifies an allowed browser origin as web', () => {
    const req = makeReq({ 'user-agent': 'Mozilla/5.0', origin: 'https://app.example.com' });
    clientType(req, {}, jest.fn());
    expect(req.clientType).toBe('web');
  });

  it('sets unknown when headers are missing', () => {
    const req = makeReq({});
    clientType(req, {}, jest.fn());
    expect(req.clientType).toBe('unknown');
  });
});
