const prisma = require('../config/prisma');

// Coach columns plus only the user columns the mappers need (never passwordHash).
const COACH_WITH_USER_SELECT = {
  id: true,
  coachType: true,
  bio: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: { id: true, fullName: true, email: true, phone: true, profileImageUrl: true },
  },
};

// `client` is the prisma client or a transaction client, so callers can join their transaction.
const createCoachProfile = (data, client = prisma) => client.coach.create({ data });

const findCoachById = (id) =>
  prisma.coach.findUnique({ where: { id }, select: COACH_WITH_USER_SELECT });

const findCoachByUserId = (userId) =>
  prisma.coach.findUnique({ where: { userId }, select: COACH_WITH_USER_SELECT });

// One nested write: the coach columns and the linked user's columns change together or not at all.
// updatedAt is set explicitly: Prisma only bumps it when a coach column is written, and the
// coach must also count as updated when only the user's columns change.
const updateCoachWithUser = (id, { userFields, coachFields }, client = prisma) => {
  const data = { ...coachFields, updatedAt: new Date() };
  if (Object.keys(userFields).length > 0) data.user = { update: userFields };
  return client.coach.update({ where: { id }, data, select: COACH_WITH_USER_SELECT });
};

// Only changes a coach whose status differs, so a repeated call writes nothing.
// Returns true when the status changed.
const updateCoachStatus = async (id, status, client = prisma) => {
  const { count } = await client.coach.updateMany({
    where: { id, status: { not: status } },
    data: { status },
  });
  return count === 1;
};

// Prisma `contains` does not escape LIKE wildcards, so "%" and "_" typed by a user would
// otherwise match anything. PostgreSQL's default LIKE escape character is the backslash.
const escapeLikePattern = (text) => text.replace(/[\\%_]/g, '\\$&');

const DEFAULT_SEARCH_FIELDS = ['fullName', 'email'];

// `searchFields` are columns of the linked user; a caller that must not probe emails passes
// only ['fullName'].
const buildListWhere = ({ status, coachType, search, searchFields = DEFAULT_SEARCH_FIELDS }) => {
  const where = {};
  if (status) where.status = status;
  if (coachType) where.coachType = coachType;
  if (search) {
    const contains = escapeLikePattern(search);
    where.user = {
      OR: searchFields.map((field) => ({ [field]: { contains, mode: 'insensitive' } })),
    };
  }
  return where;
};

// The page and the total use the same filter and run in one database round trip.
const listCoaches = async ({ status, coachType, search, searchFields, skip, take }) => {
  const where = buildListWhere({ status, coachType, search, searchFields });
  const [rows, total] = await prisma.$transaction([
    prisma.coach.findMany({
      where,
      select: COACH_WITH_USER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.coach.count({ where }),
  ]);
  return { rows, total };
};

module.exports = {
  createCoachProfile,
  findCoachById,
  findCoachByUserId,
  updateCoachWithUser,
  updateCoachStatus,
  listCoaches,
};
