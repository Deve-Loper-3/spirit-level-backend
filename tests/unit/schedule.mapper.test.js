const {
  formatTimeHHMM,
  formatDateYYYYMMDD,
  toSlotResponse,
  toSessionResponse,
} = require('../../src/repositories/schedule.mapper');

describe('Schedule Mapper Unit Tests', () => {
  describe('formatTimeHHMM', () => {
    it('formats 1970 Date to HH:mm string', () => {
      const d = new Date('1970-01-01T09:30:00.000Z');
      expect(formatTimeHHMM(d)).toBe('09:30');
    });

    it('formats plain string', () => {
      expect(formatTimeHHMM('14:45:00')).toBe('14:45');
    });
  });

  describe('formatDateYYYYMMDD', () => {
    it('formats Date to YYYY-MM-DD string', () => {
      const d = new Date('2026-11-15T00:00:00.000Z');
      expect(formatDateYYYYMMDD(d)).toBe('2026-11-15');
    });
  });

  describe('toSlotResponse', () => {
    it('preserves exact persisted null capacity and formats times', () => {
      const mockSlot = {
        id: 'slot-1',
        classId: 'class-1',
        dayOfWeek: 3,
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        startTime: new Date('1970-01-01T08:00:00.000Z'),
        endTime: new Date('1970-01-01T09:00:00.000Z'),
        capacity: null,
        active: true,
        coaches: [
          {
            coach: {
              id: 'coach-1',
              user: { fullName: 'Coach Alex', profileImageUrl: 'https://img.example/alex.jpg' },
            },
          },
        ],
        createdAt: new Date('2026-10-01T12:00:00.000Z'),
        updatedAt: new Date('2026-10-01T12:00:00.000Z'),
      };

      const res = toSlotResponse(mockSlot);
      expect(res.id).toBe('slot-1');
      expect(res.dayOfWeek).toBe(3);
      expect(res.dayName).toBe('Wednesday');
      expect(res.startDate).toBe('2026-11-01');
      expect(res.startTime).toBe('08:00');
      expect(res.endTime).toBe('09:00');
      expect(res.capacity).toBeNull();
      expect(res.active).toBe(true);
      expect(res.coaches).toHaveLength(1);
      expect(res.coaches[0].fullName).toBe('Coach Alex');
      expect(res.createdAt).toBe('2026-10-01T12:00:00.000Z');
    });
  });

  describe('toSessionResponse', () => {
    it('outputs calendar-ready session with lowercase enums and stats', () => {
      const mockSession = {
        id: 'sess-1',
        classId: 'class-1',
        slotId: 'slot-1',
        startAt: new Date('2026-11-04T05:00:00.000Z'),
        endAt: new Date('2026-11-04T06:00:00.000Z'),
        durationMin: 60,
        capacity: 15,
        state: 'OPEN',
        isPrivate: false,
        intensity: 4,
        classType: 'ONSITE',
        facility: 'Studio A',
        description: 'Morning Power Yoga',
        image: 'https://img.example/yoga.jpg',
        source: 'GENERATED',
        overriddenFields: ['capacity'],
        overrideDetails: {
          capacity: {
            reason: 'High demand holiday session',
            actorId: 'admin-1',
            changedAt: '2026-10-27T10:00:00.000Z',
          },
        },
        cancelReason: null,
        version: 2,
        class: {
          id: 'class-1',
          name: 'Power Yoga',
          classType: 'ONSITE',
          intensity: 3,
          durationMin: 60,
          baseCapacity: 12,
          colour: '#336699',
          photoUrl: 'https://img.example/yoga.jpg',
          timezone: 'Asia/Dubai',
        },
        coaches: [],
        createdAt: new Date('2026-10-20T00:00:00.000Z'),
        updatedAt: new Date('2026-10-27T10:00:00.000Z'),
      };

      const stats = { bookedCount: 8, waitlistCount: 2 };
      const res = toSessionResponse(mockSession, stats);

      expect(res.id).toBe('sess-1');
      expect(res.className).toBe('Power Yoga');
      expect(res.state).toBe('open');
      expect(res.source).toBe('generated');
      expect(res.classType).toBe('onsite');
      expect(res.bookedCount).toBe(8);
      expect(res.waitlistCount).toBe(2);
      expect(res.overriddenFields).toEqual(['capacity']);
      expect(res.overrideDetails.capacity.reason).toBe('High demand holiday session');
      expect(res.startAt).toBe('2026-11-04T05:00:00.000Z');
      expect(res.endAt).toBe('2026-11-04T06:00:00.000Z');
    });
  });
});
