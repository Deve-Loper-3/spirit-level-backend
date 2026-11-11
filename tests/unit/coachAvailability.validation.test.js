const {
  saveWeeklyAvailabilityBodySchema,
  createUnavailabilityBodySchema,
  updateUnavailabilityBodySchema,
  unavailabilityParamsSchema,
  listUnavailabilityQuerySchema,
} = require('../../src/validators/coachAvailability.validation');
const { Messages } = require('../../src/constants/messages');
const {
  MAX_SLOTS_PER_DAY,
  UNAVAILABILITY_REASON_MAX_LENGTH,
  UNAVAILABILITY_NOTE_MAX_LENGTH,
} = require('../../src/constants/availability');

// Every issue as "path: message", so a test can assert exactly what a client would see.
const issuesOf = (schema, input) => {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
};

const OFFICE_HOURS = [{ startTime: '09:00', endTime: '17:00' }];

const day = (dayOfWeek, slots = OFFICE_HOURS, isAvailable = true) => ({
  dayOfWeek,
  isAvailable,
  slots,
});

const offDay = (dayOfWeek) => day(dayOfWeek, [], false);

// A valid full week (Monday to Sunday, in order). `overrides` replaces days by their dayOfWeek, so a
// test only spells out the day it is about and the other six stay valid.
const fullWeek = (...overrides) =>
  [1, 2, 3, 4, 5, 6, 7].map(
    (dayOfWeek) => overrides.find((d) => d.dayOfWeek === dayOfWeek) ?? day(dayOfWeek),
  );

const saveBody = (...overrides) => ({ days: fullWeek(...overrides) });

describe('coachAvailability.validation', () => {
  describe('saveWeeklyAvailabilityBodySchema', () => {
    describe('the week must have exactly 7 days', () => {
      it('accepts 7 days, dayOfWeek 1 to 7 once each', () => {
        expect(saveWeeklyAvailabilityBodySchema.safeParse(saveBody()).success).toBe(true);
      });

      it('accepts the 7 days in any order', () => {
        const shuffled = [4, 7, 1, 6, 2, 5, 3].map((d) => day(d));
        const result = saveWeeklyAvailabilityBodySchema.parse({ days: shuffled });
        expect(result.days.map((d) => d.dayOfWeek)).toEqual([4, 7, 1, 6, 2, 5, 3]);
      });

      it('accepts a week where every day is unavailable', () => {
        const days = [1, 2, 3, 4, 5, 6, 7].map(offDay);
        const result = saveWeeklyAvailabilityBodySchema.parse({ days });
        expect(result.days).toHaveLength(7);
        expect(result.days.every((d) => d.isAvailable === false && d.slots.length === 0)).toBe(
          true,
        );
      });

      it('rejects 6 days: count on days, and the missing weekday named', () => {
        const days = fullWeek().slice(0, 6); // Sunday (7) is missing
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, { days });
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_INVALID}`);
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_MISSING([7])}`);
        expect(issues).toHaveLength(2);
      });

      it('rejects a missing day in the middle and names it', () => {
        const days = fullWeek().filter((d) => d.dayOfWeek !== 4);
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, { days });
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_INVALID}`);
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_MISSING([4])}`);
      });

      it('rejects 8 days (a repeated weekday): count, the repeat on its own entry', () => {
        const days = [...fullWeek(), day(3)];
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, { days });
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_INVALID}`);
        expect(issues).toContain(`days.7.dayOfWeek: ${Messages.AVAILABILITY_DAY_DUPLICATE}`);
        expect(issues).toHaveLength(2);
      });

      it('rejects 7 entries with a duplicate dayOfWeek: the repeat and the missing weekday', () => {
        const days = fullWeek();
        days[3] = day(3); // entries 2 and 3 are both Wednesday, Thursday (4) is missing
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { days })).toEqual([
          `days.3.dayOfWeek: ${Messages.AVAILABILITY_DAY_DUPLICATE}`,
          `days: ${Messages.AVAILABILITY_DAYS_MISSING([4])}`,
        ]);
      });

      it('names every missing weekday', () => {
        const days = [day(1), day(2), day(3)];
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { days })).toContain(
          `days: ${Messages.AVAILABILITY_DAYS_MISSING([4, 5, 6, 7])}`,
        );
      });

      it.each([undefined, null, 'x', {}])('rejects days = %p', (days) => {
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { days })).toEqual([
          `days: ${Messages.AVAILABILITY_DAYS_INVALID}`,
        ]);
      });

      it('rejects an empty days array', () => {
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, { days: [] });
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_INVALID}`);
        expect(issues).toContain(
          `days: ${Messages.AVAILABILITY_DAYS_MISSING([1, 2, 3, 4, 5, 6, 7])}`,
        );
      });

      it('rejects a single day (the request replaces the whole week)', () => {
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, { days: [day(3)] });
        expect(issues).toContain(`days: ${Messages.AVAILABILITY_DAYS_INVALID}`);
      });
    });

    describe('day entries', () => {
      it('accepts an unavailable day sent with slots omitted', () => {
        const days = fullWeek({ dayOfWeek: 6, isAvailable: false });
        expect(saveWeeklyAvailabilityBodySchema.parse({ days }).days[5]).toEqual({
          dayOfWeek: 6,
          isAvailable: false,
          slots: [],
        });
      });

      it.each([0, 8, -1, 1.5, '1', null])('rejects dayOfWeek %p', (dayOfWeek) => {
        const days = fullWeek();
        days[0] = { dayOfWeek, isAvailable: false, slots: [] };
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, { days });
        expect(issues.some((i) => i.startsWith('days.0.dayOfWeek:'))).toBe(true);
      });

      it('reports a missing dayOfWeek as required', () => {
        const days = fullWeek();
        days[0] = { isAvailable: false, slots: [] };
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { days })).toContain(
          `days.0.dayOfWeek: ${Messages.DAY_OF_WEEK_REQUIRED}`,
        );
      });

      it.each([undefined, 'true', 1, null])('rejects isAvailable %p', (isAvailable) => {
        const days = fullWeek();
        days[0] = { dayOfWeek: 1, isAvailable, slots: [] };
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { days })).toContain(
          `days.0.isAvailable: ${Messages.AVAILABILITY_IS_AVAILABLE_INVALID}`,
        );
      });

      it('requires at least one slot on an available day', () => {
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, saveBody(day(1, [], true)))).toEqual([
          `days.0.slots: ${Messages.AVAILABILITY_SLOTS_REQUIRED}`,
        ]);
      });

      it('rejects slots on an unavailable day', () => {
        expect(
          issuesOf(
            saveWeeklyAvailabilityBodySchema,
            saveBody(day(1, [{ startTime: '09:00', endTime: '10:00' }], false)),
          ),
        ).toEqual([`days.0.slots: ${Messages.AVAILABILITY_SLOTS_NOT_ALLOWED}`]);
      });
    });

    describe('slots', () => {
      it('accepts several slots a day, touching slots and the day edges', () => {
        const result = saveWeeklyAvailabilityBodySchema.parse(
          saveBody(
            day(1, [
              { startTime: '00:00', endTime: '06:00' },
              { startTime: '06:00', endTime: '12:00' },
              { startTime: '17:00', endTime: '23:59' },
            ]),
          ),
        );
        expect(result.days[0].slots).toHaveLength(3);
      });

      it('returns slots sorted by start time', () => {
        const result = saveWeeklyAvailabilityBodySchema.parse(
          saveBody(
            day(1, [
              { startTime: '17:00', endTime: '20:00' },
              { startTime: '06:00', endTime: '09:00' },
              { startTime: '12:00', endTime: '14:00' },
            ]),
          ),
        );
        expect(result.days[0].slots.map((s) => s.startTime)).toEqual(['06:00', '12:00', '17:00']);
      });

      it('allows at most MAX_SLOTS_PER_DAY ranges a day', () => {
        const slots = (n) =>
          Array.from({ length: n }, (_, i) => ({
            startTime: `${String(i).padStart(2, '0')}:00`,
            endTime: `${String(i).padStart(2, '0')}:30`,
          }));
        expect(
          saveWeeklyAvailabilityBodySchema.safeParse(saveBody(day(1, slots(MAX_SLOTS_PER_DAY))))
            .success,
        ).toBe(true);
        expect(
          issuesOf(
            saveWeeklyAvailabilityBodySchema,
            saveBody(day(1, slots(MAX_SLOTS_PER_DAY + 1))),
          ),
        ).toContain(`days.0.slots: ${Messages.AVAILABILITY_SLOTS_INVALID(MAX_SLOTS_PER_DAY)}`);
      });

      it.each(['9:00', '09:0', '24:00', '09:60', '9am', '09-00', '09:00:00', ' 09:00', 900, null])(
        'rejects startTime %p',
        (startTime) => {
          expect(
            issuesOf(
              saveWeeklyAvailabilityBodySchema,
              saveBody(day(1, [{ startTime, endTime: '17:00' }])),
            ),
          ).toContain(`days.0.slots.0.startTime: ${Messages.SLOT_START_TIME_INVALID}`);
        },
      );

      it('rejects an invalid endTime', () => {
        expect(
          issuesOf(
            saveWeeklyAvailabilityBodySchema,
            saveBody(day(1, [{ startTime: '09:00', endTime: '24:00' }])),
          ),
        ).toContain(`days.0.slots.0.endTime: ${Messages.SLOT_END_TIME_INVALID}`);
      });

      it('reports missing start and end times as required', () => {
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, saveBody(day(1, [{}])));
        expect(issues).toContain(`days.0.slots.0.startTime: ${Messages.SLOT_START_TIME_REQUIRED}`);
        expect(issues).toContain(`days.0.slots.0.endTime: ${Messages.SLOT_END_TIME_REQUIRED}`);
      });

      it.each([
        ['17:00', '09:00'],
        ['09:00', '09:00'],
        ['23:00', '00:00'],
      ])('rejects start %s with end %s (end must be later, no midnight crossing)', (s, e) => {
        expect(
          issuesOf(
            saveWeeklyAvailabilityBodySchema,
            saveBody(day(1, [{ startTime: s, endTime: e }])),
          ),
        ).toEqual([`days.0.slots.0.endTime: ${Messages.SLOT_END_BEFORE_START}`]);
      });

      it.each([
        [
          'partial overlap',
          [
            { startTime: '09:00', endTime: '12:00' },
            { startTime: '11:00', endTime: '14:00' },
          ],
        ],
        [
          'containment',
          [
            { startTime: '09:00', endTime: '17:00' },
            { startTime: '10:00', endTime: '11:00' },
          ],
        ],
        [
          'identical ranges',
          [
            { startTime: '09:00', endTime: '10:00' },
            { startTime: '09:00', endTime: '10:00' },
          ],
        ],
        [
          'out of order input',
          [
            { startTime: '14:00', endTime: '18:00' },
            { startTime: '08:00', endTime: '15:00' },
          ],
        ],
      ])('rejects overlapping slots: %s', (_name, slots) => {
        const issues = issuesOf(saveWeeklyAvailabilityBodySchema, saveBody(day(1, slots)));
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/^days\.0\.slots\.\d\.startTime: /);
        expect(issues[0]).toContain(Messages.AVAILABILITY_SLOTS_OVERLAP);
      });

      it('does not flag the same hours on different days', () => {
        expect(saveWeeklyAvailabilityBodySchema.safeParse(saveBody()).success).toBe(true);
      });
    });

    describe('unknown keys and combined errors', () => {
      it('rejects unknown keys at every level', () => {
        const unknown = Messages.ORDER_BODY_UNKNOWN_FIELD;
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { ...saveBody(), coachId: 'x' })).toEqual(
          [`body: ${unknown}`],
        );
        expect(
          issuesOf(saveWeeklyAvailabilityBodySchema, {
            days: fullWeek({ ...day(1), extra: 1 }),
          }),
        ).toEqual([`days.0: ${unknown}`]);
        expect(
          issuesOf(
            saveWeeklyAvailabilityBodySchema,
            saveBody(day(1, [{ startTime: '09:00', endTime: '10:00', id: 'x' }])),
          ),
        ).toEqual([`days.0.slots.0: ${unknown}`]);
      });

      it('reports every failing field together', () => {
        const days = fullWeek();
        days[0] = day(9);
        days[1] = day(2, [{ startTime: 'bad', endTime: '10:00' }]);
        expect(issuesOf(saveWeeklyAvailabilityBodySchema, { days }).length).toBeGreaterThanOrEqual(
          2,
        );
      });
    });
  });

  describe('createUnavailabilityBodySchema', () => {
    const valid = { startDate: '2026-12-01', endDate: '2026-12-05', reason: 'Holiday' };

    it('accepts the required fields and returns note as explicit null', () => {
      expect(createUnavailabilityBodySchema.parse(valid)).toEqual({ ...valid, note: null });
    });

    it('accepts a one-day range (end equals start)', () => {
      expect(
        createUnavailabilityBodySchema.safeParse({ ...valid, endDate: valid.startDate }).success,
      ).toBe(true);
    });

    it('trims the reason and the note, and keeps a note', () => {
      expect(
        createUnavailabilityBodySchema.parse({ ...valid, reason: '  Sick leave ', note: ' flu ' }),
      ).toEqual({ ...valid, reason: 'Sick leave', note: 'flu' });
    });

    it.each([undefined, null, '', '   '])('stores note %p as null', (note) => {
      expect(createUnavailabilityBodySchema.parse({ ...valid, note }).note).toBeNull();
    });

    it('accepts a reason and a note of exactly the maximum length', () => {
      expect(
        createUnavailabilityBodySchema.safeParse({
          ...valid,
          reason: 'r'.repeat(UNAVAILABILITY_REASON_MAX_LENGTH),
          note: 'n'.repeat(UNAVAILABILITY_NOTE_MAX_LENGTH),
        }).success,
      ).toBe(true);
    });

    it('rejects a reason and a note one character too long', () => {
      expect(
        issuesOf(createUnavailabilityBodySchema, {
          ...valid,
          reason: 'r'.repeat(UNAVAILABILITY_REASON_MAX_LENGTH + 1),
          note: 'n'.repeat(UNAVAILABILITY_NOTE_MAX_LENGTH + 1),
        }),
      ).toEqual([
        `reason: ${Messages.UNAVAILABILITY_REASON_INVALID(UNAVAILABILITY_REASON_MAX_LENGTH)}`,
        `note: ${Messages.UNAVAILABILITY_NOTE_INVALID(UNAVAILABILITY_NOTE_MAX_LENGTH)}`,
      ]);
    });

    it('requires both dates and the reason', () => {
      expect(issuesOf(createUnavailabilityBodySchema, {})).toEqual([
        `startDate: ${Messages.START_DATE_REQUIRED}`,
        `endDate: ${Messages.UNAVAILABILITY_END_DATE_REQUIRED}`,
        `reason: ${Messages.UNAVAILABILITY_REASON_REQUIRED}`,
      ]);
    });

    it.each(['', '   '])('rejects a blank reason %p', (reason) => {
      expect(issuesOf(createUnavailabilityBodySchema, { ...valid, reason })).toEqual([
        `reason: ${Messages.UNAVAILABILITY_REASON_REQUIRED}`,
      ]);
    });

    it.each([
      '2026-13-01',
      '2026-02-30',
      '2026-1-5',
      '05/12/2026',
      '2026-12-05T00:00:00Z',
      20261205,
    ])('rejects invalid start date %p', (startDate) => {
      expect(issuesOf(createUnavailabilityBodySchema, { ...valid, startDate })).toEqual([
        `startDate: ${Messages.START_DATE_INVALID}`,
      ]);
    });

    it('rejects an invalid end date', () => {
      expect(issuesOf(createUnavailabilityBodySchema, { ...valid, endDate: '2026-02-30' })).toEqual(
        [`endDate: ${Messages.UNAVAILABILITY_END_DATE_INVALID}`],
      );
    });

    it('rejects an end date before the start date, across month and year ends', () => {
      const expected = [`endDate: ${Messages.UNAVAILABILITY_END_BEFORE_START}`];
      expect(issuesOf(createUnavailabilityBodySchema, { ...valid, endDate: '2026-11-30' })).toEqual(
        expected,
      );
      expect(
        issuesOf(createUnavailabilityBodySchema, {
          ...valid,
          startDate: '2027-01-02',
          endDate: '2026-12-31',
        }),
      ).toEqual(expected);
    });

    it('rejects unknown keys', () => {
      expect(issuesOf(createUnavailabilityBodySchema, { ...valid, coachId: 'x' })).toEqual([
        `body: ${Messages.ORDER_BODY_UNKNOWN_FIELD}`,
      ]);
    });
  });

  describe('updateUnavailabilityBodySchema', () => {
    it('accepts any single field and returns only the fields that were sent', () => {
      expect(updateUnavailabilityBodySchema.parse({ reason: ' Sick ' })).toEqual({
        reason: 'Sick',
      });
      expect(updateUnavailabilityBodySchema.parse({ startDate: '2026-12-01' })).toEqual({
        startDate: '2026-12-01',
      });
      expect(updateUnavailabilityBodySchema.parse({ endDate: '2026-12-09' })).toEqual({
        endDate: '2026-12-09',
      });
    });

    it('clears the note with null or a blank string, and sets it when given text', () => {
      expect(updateUnavailabilityBodySchema.parse({ note: null })).toEqual({ note: null });
      expect(updateUnavailabilityBodySchema.parse({ note: '  ' })).toEqual({ note: null });
      expect(updateUnavailabilityBodySchema.parse({ note: ' back soon ' })).toEqual({
        note: 'back soon',
      });
    });

    it('rejects an empty body', () => {
      expect(issuesOf(updateUnavailabilityBodySchema, {})).toEqual([
        `body: ${Messages.UNAVAILABILITY_UPDATE_EMPTY}`,
      ]);
    });

    it('rejects unknown keys, including coachId', () => {
      expect(issuesOf(updateUnavailabilityBodySchema, { coachId: 'x', reason: 'a' })).toEqual([
        `body: ${Messages.ORDER_BODY_UNKNOWN_FIELD}`,
      ]);
    });

    it('validates each sent field', () => {
      expect(
        issuesOf(updateUnavailabilityBodySchema, {
          startDate: 'nope',
          endDate: 'nope',
          reason: ' ',
        }),
      ).toEqual([
        `startDate: ${Messages.START_DATE_INVALID}`,
        `endDate: ${Messages.UNAVAILABILITY_END_DATE_INVALID}`,
        `reason: ${Messages.UNAVAILABILITY_REASON_REQUIRED}`,
      ]);
    });

    it('checks the date order only when both dates are sent', () => {
      expect(
        updateUnavailabilityBodySchema.safeParse({
          startDate: '2026-12-09',
          endDate: '2026-12-09',
        }).success,
      ).toBe(true);
      expect(
        issuesOf(updateUnavailabilityBodySchema, {
          startDate: '2026-12-09',
          endDate: '2026-12-01',
        }),
      ).toEqual([`endDate: ${Messages.UNAVAILABILITY_END_BEFORE_START}`]);
      // A single date is compared with the stored row by the service, not here.
      expect(updateUnavailabilityBodySchema.safeParse({ endDate: '2000-01-01' }).success).toBe(
        true,
      );
    });
  });

  describe('listUnavailabilityQuerySchema', () => {
    it('accepts no query and applies the page defaults', () => {
      expect(listUnavailabilityQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    });

    it('accepts from, to, page and limit (strings are coerced)', () => {
      expect(
        listUnavailabilityQuerySchema.parse({
          from: '2026-12-01',
          to: '2026-12-31',
          page: '2',
          limit: '5',
        }),
      ).toEqual({ from: '2026-12-01', to: '2026-12-31', page: 2, limit: 5 });
    });

    it('accepts from equal to to', () => {
      expect(
        listUnavailabilityQuerySchema.safeParse({ from: '2026-12-01', to: '2026-12-01' }).success,
      ).toBe(true);
    });

    it('rejects a date that is not a calendar date', () => {
      expect(issuesOf(listUnavailabilityQuerySchema, { from: '2026-02-30' })).toEqual([
        `from: ${Messages.ORDER_DATE_INVALID}`,
      ]);
      expect(issuesOf(listUnavailabilityQuerySchema, { to: 'tomorrow' })).toEqual([
        `to: ${Messages.ORDER_DATE_INVALID}`,
      ]);
    });

    it('rejects from after to', () => {
      expect(
        issuesOf(listUnavailabilityQuerySchema, { from: '2026-12-31', to: '2026-12-01' }),
      ).toEqual([`from: ${Messages.ORDER_DATE_RANGE_INVALID}`]);
    });

    it('rejects an unknown query parameter', () => {
      expect(issuesOf(listUnavailabilityQuerySchema, { status: 'x' })).toEqual([
        `body: ${Messages.ORDER_QUERY_UNKNOWN_FIELD}`,
      ]);
    });

    it('rejects a bad page or limit', () => {
      expect(issuesOf(listUnavailabilityQuerySchema, { page: '0', limit: '101' })).toEqual([
        `page: ${Messages.PAGE_INVALID}`,
        `limit: ${Messages.LIMIT_INVALID}`,
      ]);
    });
  });

  describe('unavailabilityParamsSchema', () => {
    const uuid = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';

    it('accepts two UUIDs', () => {
      expect(
        unavailabilityParamsSchema.safeParse({ coachId: uuid, unavailabilityId: uuid }).success,
      ).toBe(true);
    });

    it('rejects a malformed coach id and a malformed unavailability id', () => {
      expect(issuesOf(unavailabilityParamsSchema, { coachId: 'x', unavailabilityId: 'y' })).toEqual(
        [
          `coachId: ${Messages.COACH_ID_INVALID}`,
          `unavailabilityId: ${Messages.UNAVAILABILITY_ID_INVALID}`,
        ],
      );
    });
  });
});
