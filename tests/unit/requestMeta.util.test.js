const { getRequestMeta } = require('../../src/utils/requestMeta.util');

describe('requestMeta.util - getRequestMeta', () => {
  it('returns the request ip and the user-agent header', () => {
    const req = { ip: '203.0.113.7', get: jest.fn().mockReturnValue('jest/1.0') };

    expect(getRequestMeta(req)).toEqual({ ipAddress: '203.0.113.7', userAgent: 'jest/1.0' });
    expect(req.get).toHaveBeenCalledWith('user-agent');
  });

  it('leaves userAgent undefined when the header is absent', () => {
    const req = { ip: '203.0.113.7', get: jest.fn().mockReturnValue(undefined) };

    expect(getRequestMeta(req)).toEqual({ ipAddress: '203.0.113.7', userAgent: undefined });
  });
});
