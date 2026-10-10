const request = require('supertest');

const ALLOWED = 'https://app.example.com';
const OTHER = 'https://evil.example.com';

// env.js reads process.env once at load time (dotenv never overrides existing vars), so the app
// is built in an isolated module registry with CORS_ORIGINS set first. No DB access is needed:
// only /health (liveness) and an unknown route are hit.
const buildApp = (corsOrigins) => {
  const previous = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = corsOrigins;
  let app;
  jest.isolateModules(() => {
    app = require('../../src/app').createApp();
  });
  if (previous === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = previous;
  return app;
};

describe('CORS with an explicit origin list', () => {
  let app;
  beforeAll(() => {
    app = buildApp(`${ALLOWED}, http://localhost:3000`);
  });

  it('echoes an allowed origin', async () => {
    const res = await request(app).get('/health').set('Origin', ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('sends no CORS headers for an origin that is not listed', async () => {
    const res = await request(app).get('/health').set('Origin', OTHER);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not treat the wildcard as a listed origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'null');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests without an Origin header (mobile / server-to-server)', async () => {
    const res = await request(app).get('/health').set('User-Agent', 'okhttp/4.12.0');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight from an allowed origin with methods, headers and max-age', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('gives a preflight from an unlisted origin no allow-origin header', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', OTHER)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS with the development wildcard', () => {
  it('allows any origin', async () => {
    const app = buildApp('*');
    const res = await request(app).get('/health').set('Origin', OTHER);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
