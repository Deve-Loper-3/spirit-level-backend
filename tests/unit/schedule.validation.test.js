const {
  createSlotsBodySchema,
  updateSlotBodySchema,
  listSessionsQuerySchema,
  createSessionBodySchema,
  patchSessionBodySchema,
  cancelSessionBodySchema,
} = require('../../src/validators/schedule.validation');

describe('Schedule Validation Unit Tests', () => {
  describe('createSlotsBodySchema', () => {
    const validPayload = {
      startDate: '2026-11-01',
      days: [
        {
          dayOfWeek: 1,
          times: [
            {
              startTime: '09:00',
              endTime: '10:00',
              capacity: 15,
              coachIds: ['a0000000-0000-4000-8000-000000000001'],
            },
          ],
        },
      ],
    };

    it('passes for valid slot payload', () => {
      const result = createSlotsBodySchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('rejects invalid startDate format', () => {
      const result = createSlotsBodySchema.safeParse({
        ...validPayload,
        startDate: 'invalid-date',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('startDate');
    });

    it('rejects non-existent calendar date (e.g. Feb 31)', () => {
      const result = createSlotsBodySchema.safeParse({
        ...validPayload,
        startDate: '2026-02-31',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('startDate');
    });

    it('rejects duplicate dayOfWeek in days array', () => {
      const result = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [
          {
            dayOfWeek: 1,
            times: [{ startTime: '09:00', endTime: '10:00' }],
          },
          {
            dayOfWeek: 1,
            times: [{ startTime: '11:00', endTime: '12:00' }],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes('Duplicate dayOfWeek'))).toBe(true);
    });

    it('rejects duplicate startTime on the same day', () => {
      const result = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [
          {
            dayOfWeek: 2,
            times: [
              { startTime: '10:00', endTime: '11:00' },
              { startTime: '10:00', endTime: '11:30' },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes('Duplicate startTime'))).toBe(true);
    });

    it('rejects endTime <= startTime', () => {
      const result = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [
          {
            dayOfWeek: 3,
            times: [{ startTime: '10:00', endTime: '10:00' }],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.path.includes('endTime'))).toBe(true);
    });

    it('rejects capacity below 1 or above 200', () => {
      const zeroCap = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [{ dayOfWeek: 1, times: [{ startTime: '09:00', endTime: '10:00', capacity: 0 }] }],
      });
      expect(zeroCap.success).toBe(false);

      const highCap = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [{ dayOfWeek: 1, times: [{ startTime: '09:00', endTime: '10:00', capacity: 201 }] }],
      });
      expect(highCap.success).toBe(false);
    });

    it('allows null capacity', () => {
      const nullCap = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [{ dayOfWeek: 1, times: [{ startTime: '09:00', endTime: '10:00', capacity: null }] }],
      });
      expect(nullCap.success).toBe(true);
      expect(nullCap.data.days[0].times[0].capacity).toBeNull();
    });

    it('rejects duplicate coachIds within a time entry', () => {
      const result = createSlotsBodySchema.safeParse({
        ...validPayload,
        days: [
          {
            dayOfWeek: 1,
            times: [
              {
                startTime: '09:00',
                endTime: '10:00',
                coachIds: [
                  'a0000000-0000-4000-8000-000000000001',
                  'a0000000-0000-4000-8000-000000000001',
                ],
              },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.path.includes('coachIds'))).toBe(true);
    });
  });

  describe('updateSlotBodySchema', () => {
    it('rejects empty update body', () => {
      const result = updateSlotBodySchema.safeParse({});
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe('Provide at least one field to update');
    });

    it('rejects endTime <= startTime when both provided', () => {
      const result = updateSlotBodySchema.safeParse({
        startTime: '14:00',
        endTime: '13:00',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('endTime');
    });
  });

  describe('listSessionsQuerySchema', () => {
    it('requires both from and to', () => {
      const noFrom = listSessionsQuerySchema.safeParse({ to: '2026-11-01T00:00:00.000Z' });
      expect(noFrom.success).toBe(false);

      const noTo = listSessionsQuerySchema.safeParse({ from: '2026-11-01T00:00:00.000Z' });
      expect(noTo.success).toBe(false);
    });

    it('rejects to < from', () => {
      const result = listSessionsQuerySchema.safeParse({
        from: '2026-11-10T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.path.includes('to'))).toBe(true);
    });

    it('rejects range exceeding 92 days', () => {
      const result = listSessionsQuerySchema.safeParse({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-05-01T00:00:00.000Z', // 120 days
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes('92 days'))).toBe(true);
    });

    it('accepts valid range within 92 days', () => {
      const result = listSessionsQuerySchema.safeParse({
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-21T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createSessionBodySchema', () => {
    const validOneOff = {
      classId: 'a0000000-0000-4000-8000-000000000001',
      startAt: '2026-12-01T10:00:00.000Z',
      endAt: '2026-12-01T11:00:00.000Z',
    };

    it('passes for minimal one-off creation', () => {
      const result = createSessionBodySchema.safeParse(validOneOff);
      expect(result.success).toBe(true);
    });

    it('rejects endAt <= startAt', () => {
      const result = createSessionBodySchema.safeParse({
        ...validOneOff,
        endAt: '2026-12-01T09:30:00.000Z',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.path.includes('endAt'))).toBe(true);
    });

    it('rejects duplicate coachIds', () => {
      const result = createSessionBodySchema.safeParse({
        ...validOneOff,
        coachIds: [
          'a0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000001',
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.path.includes('coachIds'))).toBe(true);
    });
  });

  describe('patchSessionBodySchema', () => {
    it('passes for partial update with overrideReasons', () => {
      const result = patchSessionBodySchema.safeParse({
        capacity: 25,
        overrideReasons: { capacity: 'Expanded room' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty patch body', () => {
      const result = patchSessionBodySchema.safeParse({});
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe('Provide at least one field to update');
    });

    it('rejects endAt <= startAt in patch', () => {
      const result = patchSessionBodySchema.safeParse({
        startAt: '2026-12-01T12:00:00.000Z',
        endAt: '2026-12-01T11:00:00.000Z',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.path.includes('endAt'))).toBe(true);
    });
  });

  describe('cancelSessionBodySchema', () => {
    it('requires non-empty reason', () => {
      const emptyReason = cancelSessionBodySchema.safeParse({ reason: '' });
      expect(emptyReason.success).toBe(false);

      const whitespaceReason = cancelSessionBodySchema.safeParse({ reason: '   ' });
      expect(whitespaceReason.success).toBe(false);

      const validReason = cancelSessionBodySchema.safeParse({ reason: 'Coach emergency' });
      expect(validReason.success).toBe(true);
    });
  });
});
