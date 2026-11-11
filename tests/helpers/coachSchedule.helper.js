const crypto = require('crypto');
const prisma = require('../../src/config/prisma');

// Weekly hours written straight into the database (the API is covered by coaches.availability.test).
// A coach's rows go with the coach (ON DELETE CASCADE), so testData.cleanup() removes them.

const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00.000Z`);

// Replaces the coach's whole week. `week` maps ISO weekday (1 = Monday ... 7) to:
//   - an array of ['HH:mm', 'HH:mm'] ranges (an available day), or
//   - null (a saved day off, isAvailable = false).
// A weekday that is not in `week` gets no row ("no hours saved").
const setCoachWeek = async (coachId, week) => {
  await prisma.coachAvailabilityDay.deleteMany({ where: { coachId } });
  const days = Object.entries(week).map(([dayOfWeek, ranges]) => ({
    dayOfWeek: Number(dayOfWeek),
    ranges,
  }));
  await prisma.coachAvailabilityDay.createMany({
    data: days.map(({ dayOfWeek, ranges }) => ({
      coachId,
      dayOfWeek,
      isAvailable: ranges !== null,
      updatedAt: new Date(),
    })),
  });
  const slots = days.flatMap(({ dayOfWeek, ranges }) =>
    (ranges ?? []).map(([start, end]) => ({
      id: crypto.randomUUID(),
      coachId,
      dayOfWeek,
      startTime: time(start),
      endTime: time(end),
      updatedAt: new Date(),
    })),
  );
  if (slots.length > 0) await prisma.coachAvailabilitySlot.createMany({ data: slots });
};

// Available every day from 00:00 to 23:59 facility time (nothing blocks except the other rules).
const openAllWeek = (coachId, range = ['00:00', '23:59']) =>
  setCoachWeek(coachId, Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [range]])));

module.exports = { setCoachWeek, openAllWeek };
