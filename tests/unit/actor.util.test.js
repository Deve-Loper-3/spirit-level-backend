const { toAuditActor, toActor } = require('../../src/utils/actor.util');

describe('actor.util', () => {
  const user = { id: 'u1', role: 'ADMIN', email: 'a@test.invalid', status: 'ACTIVE' };

  it('toAuditActor maps the caller to the audit columns', () => {
    expect(toAuditActor(user)).toEqual({
      actorId: 'u1',
      actorRole: 'ADMIN',
      email: 'a@test.invalid',
    });
  });

  it('toAuditActor never throws and gives a null email when there is no actor', () => {
    expect(toAuditActor(undefined)).toEqual({
      actorId: undefined,
      actorRole: undefined,
      email: null,
    });
  });

  it('toActor keeps only id, role and email of req.user', () => {
    expect(toActor({ user })).toEqual({ id: 'u1', role: 'ADMIN', email: 'a@test.invalid' });
  });
});
