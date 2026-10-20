const { toCoachResponse, toPublicCoachResponse } = require('../../src/repositories/coach.mapper');

describe('coach.mapper - toCoachResponse', () => {
  const createdAt = new Date('2026-10-13T00:00:00.000Z');
  const updatedAt = new Date('2026-10-14T00:00:00.000Z');
  const user = {
    id: 'user-1',
    fullName: 'Casey Coach',
    email: 'casey@example.com',
    phone: '+15551234567',
    profileImageUrl: 'https://example.public.blob.vercel-storage.com/a.jpg',
    passwordHash: 'secret-hash',
    role: 'COACH',
    status: 'ACTIVE',
  };
  const coach = {
    id: 'coach-1',
    userId: 'user-1',
    coachType: 'SALARIED',
    bio: 'Bio',
    status: 'INACTIVE',
    createdAt,
    updatedAt,
  };

  it('merges user and coach into the full view with the coach status', () => {
    expect(toCoachResponse(user, coach)).toEqual({
      id: 'coach-1',
      userId: 'user-1',
      fullName: 'Casey Coach',
      email: 'casey@example.com',
      phone: '+15551234567',
      profileImageUrl: user.profileImageUrl,
      bio: 'Bio',
      coachType: 'SALARIED',
      status: 'INACTIVE',
      createdAt,
      updatedAt,
    });
  });

  it('returns null for a missing image and bio, and never leaks user secrets or role', () => {
    const result = toCoachResponse(
      { ...user, profileImageUrl: null },
      { ...coach, bio: undefined },
    );

    expect(result.profileImageUrl).toBeNull();
    expect(result.bio).toBeNull();
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('role');
  });
});

describe('coach.mapper - toPublicCoachResponse', () => {
  const user = {
    id: 'user-1',
    fullName: 'Casey Coach',
    email: 'casey@example.com',
    phone: '+15551234567',
    profileImageUrl: 'https://example.public.blob.vercel-storage.com/a.jpg',
  };
  const coach = {
    id: 'coach-1',
    userId: 'user-1',
    coachType: 'SALARIED',
    bio: 'Bio',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('exposes only id, fullName, profileImageUrl and bio', () => {
    expect(toPublicCoachResponse(user, coach)).toEqual({
      id: 'coach-1',
      fullName: 'Casey Coach',
      profileImageUrl: user.profileImageUrl,
      bio: 'Bio',
    });
  });

  it('returns null for a missing image and bio', () => {
    const result = toPublicCoachResponse(
      { ...user, profileImageUrl: null },
      { ...coach, bio: null },
    );

    expect(result.profileImageUrl).toBeNull();
    expect(result.bio).toBeNull();
  });
});
