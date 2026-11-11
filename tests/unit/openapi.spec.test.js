const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { AppErrors } = require('../../src/constants/errors');

const authRoutes = require('../../src/routes/auth.routes');
const uploadsRoutes = require('../../src/routes/uploads.routes');
const staffRoutes = require('../../src/routes/staff.routes');
const coachRoutes = require('../../src/routes/coach.routes');
const planRoutes = require('../../src/routes/plan.routes');
const membershipRoutes = require('../../src/routes/membership.routes');
const classRoutes = require('../../src/routes/class.routes');
const sessionRoutes = require('../../src/routes/session.routes');
const cafeRoutes = require('../../src/routes/cafe.routes');
const bookingRuleRoutes = require('../../src/routes/bookingRule.routes');
const appointmentTypeRoutes = require('../../src/routes/appointmentType.routes');
const appointmentRoutes = require('../../src/routes/appointment.routes');
const healthRoutes = require('../../src/routes/health.routes');

const SPEC_PATH = path.join(__dirname, '../../docs/openapi.yaml');
const text = fs.readFileSync(SPEC_PATH, 'utf8');
const spec = YAML.parse(text);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const DOCS_PATHS = ['/api-docs/', '/api-docs/openapi.yaml', '/api-docs/openapi.json'];
const PUBLIC_PATHS = new Set([
  '/health',
  '/health/ready',
  '/api/v1/auth/register',
  '/api/v1/auth/register/complete',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/verify-otp',
  '/api/v1/auth/reset-password',
  '/api/v1/uploads/profile-image/token',
  ...DOCS_PATHS,
]);

const MOUNTS = [
  [authRoutes, '/api/v1/auth'],
  [staffRoutes, '/api/v1/admin/staff'],
  [coachRoutes, '/api/v1/coaches'],
  [uploadsRoutes, '/api/v1/uploads'],
  [membershipRoutes, '/api/v1/memberships'],
  [planRoutes, '/api/v1/plans'],
  [classRoutes, '/api/v1/classes'],
  [sessionRoutes, '/api/v1/sessions'],
  [cafeRoutes, '/api/v1/cafe'],
  [bookingRuleRoutes, '/api/v1/settings/booking-rules'],
  [appointmentTypeRoutes, '/api/v1/appointment-types'],
  [appointmentRoutes, '/api/v1/appointments'],
  [healthRoutes, '/health'],
];

// path -> Set of lowercase methods that have a real handler (the 405 catch-alls are not counted)
const routerMethods = () => {
  const found = {};
  for (const [router, prefix] of MOUNTS) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const full = (prefix + (layer.route.path === '/' ? '' : layer.route.path)).replace(
        /:(\w+)/g,
        '{$1}',
      );
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        (found[full] ||= new Set()).add(method);
      }
    }
  }
  return found;
};

const isStub = (op) => Object.keys(op.responses || {}).join() === '405';
const operations = () =>
  Object.entries(spec.paths).flatMap(([p, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ path: p, method: m, op: item[m] })),
  );

describe('docs/openapi.yaml is the client contract and matches the code', () => {
  it('has no broken $ref', () => {
    const broken = [];
    const resolve = (ref) =>
      ref
        .replace(/^#\//, '')
        .split('/')
        .reduce((o, k) => (o ? o[k] : undefined), spec);
    const walk = (value, where) => {
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${where}[${i}]`));
      if (value && typeof value === 'object') {
        if (typeof value.$ref === 'string' && resolve(value.$ref) === undefined) {
          broken.push(`${value.$ref} at ${where}`);
        }
        Object.entries(value).forEach(([k, v]) => walk(v, `${where}.${k}`));
      }
      return undefined;
    };
    walk(spec, '');
    expect(broken).toEqual([]);
  });

  it('documents every real route, and only real routes', () => {
    const real = routerMethods();
    const problems = [];
    for (const { path: p, method, op } of operations()) {
      if (DOCS_PATHS.includes(p) || isStub(op)) continue;
      if (!real[p] || !real[p].has(method))
        problems.push(`documented but not routed: ${method} ${p}`);
    }
    for (const [p, methods] of Object.entries(real)) {
      for (const method of methods) {
        const op = spec.paths[p] && spec.paths[p][method];
        if (!op || isStub(op)) problems.push(`routed but not documented: ${method} ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('documents a 405 stub with the right Allow list for every path', () => {
    const real = routerMethods();
    const problems = [];
    for (const [p, methods] of Object.entries(real)) {
      const allow = [...methods].map((m) => m.toUpperCase()).sort();
      const stubs = METHODS.filter((m) => spec.paths[p][m] && isStub(spec.paths[p][m]));
      if (stubs.length === 0) problems.push(`no 405 stub for ${p}`);
      for (const m of stubs) {
        const example = spec.paths[p][m].responses['405'].headers.Allow.schema.example;
        const documented = example
          .split(',')
          .map((s) => s.trim())
          .sort();
        if (documented.join() !== allow.join()) {
          problems.push(`${p}: stub says Allow ${example}, router has ${allow.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('documents 429 on every limited operation and 401 on every protected one', () => {
    const problems = [];
    for (const { path: p, method, op } of operations()) {
      if (isStub(op)) continue;
      if (p !== '/health' && !op.responses['429']) problems.push(`${method} ${p}: no 429`);
      if (!PUBLIC_PATHS.has(p) && !op.responses['401']) problems.push(`${method} ${p}: no 401`);
    }
    expect(problems).toEqual([]);
  });

  it('documents 400 (never 422) for validation, and no old list shape', () => {
    expect(text).not.toMatch(/\b422\b/);
    expect(text).not.toMatch(/pageSize/);
    expect(spec.components.schemas.PlanListMeta).toBeUndefined();
    expect(spec.components.responses.ValidationFailed).toBeUndefined();
  });

  it('gives every list the shared page and limit query and a pagination envelope', () => {
    const lists = [
      '/api/v1/coaches',
      '/api/v1/plans',
      '/api/v1/classes',
      '/api/v1/sessions',
      '/api/v1/cafe/items',
      '/api/v1/cafe/inventory',
      '/api/v1/cafe/orders',
    ];
    for (const p of lists) {
      const op = spec.paths[p].get;
      const names = op.parameters.map((x) =>
        x.$ref ? x.$ref.split('/').pop().toLowerCase() : x.name,
      );
      expect(names).toEqual(expect.arrayContaining(['page', 'limit']));
      const body = JSON.stringify(op.responses['200']);
      expect(body).not.toContain('"meta"');
      expect(body).toMatch(/Pagination|pagination|CoachListResponse/);
    }
    expect(spec.components.parameters.Limit.schema).toMatchObject({
      minimum: 1,
      maximum: 100,
      default: 20,
    });
  });

  it('only uses error codes that exist in the code', () => {
    const known = new Set(Object.values(AppErrors).map((e) => e.code));
    ['VALIDATION_ERROR', 'ROUTE_NOT_FOUND', 'TOO_MANY_REQUESTS'].forEach((c) => known.add(c));
    const unknown = [...text.matchAll(/\bcode: ([A-Z][A-Z0-9_]{3,})\b/g)]
      .map((m) => m[1])
      .filter((code) => !known.has(code));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('describes the error envelope with a code on every error', () => {
    expect(spec.components.schemas.ErrorEnvelope.properties.code.description).toMatch(
      /every error/i,
    );
  });
});
