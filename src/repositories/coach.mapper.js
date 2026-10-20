// Full view: name, email, phone and image live on the linked user, the rest on the coach profile.
const toCoachResponse = (user, coach) => ({
  id: coach.id,
  userId: user.id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  profileImageUrl: user.profileImageUrl ?? null,
  bio: coach.bio ?? null,
  coachType: coach.coachType,
  status: coach.status,
  createdAt: coach.createdAt,
  updatedAt: coach.updatedAt,
});

// Public view: nothing that identifies the account or how to contact the coach.
const toPublicCoachResponse = (user, coach) => ({
  id: coach.id,
  fullName: user.fullName,
  profileImageUrl: user.profileImageUrl ?? null,
  bio: coach.bio ?? null,
});

module.exports = { toCoachResponse, toPublicCoachResponse };
