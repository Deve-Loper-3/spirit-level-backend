const prisma = require('../../src/config/prisma');
const { createTestData } = require('../helpers/testData.helper');
const {
  deleteTestClasses,
  createTestClass,
  createTestSlot,
  createTestSession,
} = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('class, slot and session data model', () => {
  // Prisma has no error code for a RESTRICT foreign key (Postgres 23001); the message is stable.
  const RESTRICT = 'violates RESTRICT setting of foreign key constraint';
  const PREFIX = 'test_slcls01_model_';
  const data = createTestData('slcls01_model');

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
    await data.cleanup();
  };

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('class constraints', () => {
    it.each([
      ['intensity 0', { intensity: 0 }, 'classes_intensity_check'],
      ['intensity 6', { intensity: 6 }, 'classes_intensity_check'],
      ['baseCapacity 0', { baseCapacity: 0 }, 'classes_base_capacity_check'],
      ['durationMin 0', { durationMin: 0 }, 'classes_duration_check'],
      ['durationMin negative', { durationMin: -5 }, 'classes_duration_check'],
      [
        'classpassSpots negative',
        { classPassEnabled: true, classpassSpots: -1 },
        'classes_classpass_enabled_check',
      ],
      [
        'classpassSpots above baseCapacity',
        { classPassEnabled: true, baseCapacity: 5, classpassSpots: 6 },
        'classes_classpass_enabled_check',
      ],
      [
        'classpassSpots > 0 when classPassEnabled is false',
        { classPassEnabled: false, baseCapacity: 10, classpassSpots: 2 },
        'classes_classpass_enabled_check',
      ],
      ['colour not a hex code', { colour: 'red' }, 'classes_colour_check'],
    ])('rejects %s', async (_label, overrides, constraint) => {
      await expect(createTestClass(PREFIX, overrides)).rejects.toThrow(constraint);
    });

    it.each([
      ['intensity 1', { intensity: 1 }],
      ['intensity 5', { intensity: 5 }],
      ['colour #0F2269', { colour: '#0F2269' }],
      [
        'classpassSpots equal to baseCapacity',
        { classPassEnabled: true, baseCapacity: 5, classpassSpots: 5 },
      ],
    ])('accepts %s', async (_label, overrides) => {
      await expect(createTestClass(PREFIX, overrides)).resolves.toMatchObject({ version: 1 });
    });

    it('defaults to active, no classpass spots and version 1', async () => {
      const cls = await createTestClass(PREFIX);
      expect(cls).toMatchObject({
        status: 'ACTIVE',
        classPassEnabled: false,
        classpassSpots: 0,
        version: 1,
        intensity: 3,
      });
    });
  });

  describe('unique name among active classes', () => {
    it('rejects the same name (any case) while both are active', async () => {
      const first = await createTestClass(PREFIX);
      await expect(
        createTestClass(PREFIX, { name: first.name.toUpperCase() }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows the same name once the earlier class is inactive', async () => {
      const first = await createTestClass(PREFIX, { status: 'DEACTIVATED' });
      await expect(createTestClass(PREFIX, { name: first.name })).resolves.toBeDefined();
    });

    it('rejects reactivating a class whose name is taken by an active one', async () => {
      const inactive = await createTestClass(PREFIX, { status: 'DEACTIVATED' });
      await createTestClass(PREFIX, { name: inactive.name });
      await expect(
        prisma.class.update({ where: { id: inactive.id }, data: { status: 'ACTIVE' } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('class version trigger', () => {
    it('bumps by one when a column changes, however many change at once', async () => {
      const cls = await createTestClass(PREFIX);
      const updated = await prisma.class.update({
        where: { id: cls.id },
        data: { description: 'new', baseCapacity: 20, colour: '#112233' },
      });
      expect(updated.version).toBe(2);
    });

    it('does not bump when a column is written with its current value', async () => {
      const cls = await createTestClass(PREFIX, { description: 'same' });
      const updated = await prisma.class.update({
        where: { id: cls.id },
        data: { description: 'same' },
      });
      expect(updated.version).toBe(1);
    });
  });

  describe('slots', () => {
    it.each([[0], [8]])('rejects dayOfWeek %i', async (dayOfWeek) => {
      const cls = await createTestClass(PREFIX);
      await expect(createTestSlot(cls.id, { dayOfWeek })).rejects.toThrow(
        'class_slots_day_of_week_check',
      );
    });

    it('rejects a capacity override below 1 and accepts null', async () => {
      const cls = await createTestClass(PREFIX);
      await expect(createTestSlot(cls.id, { capacity: 0 })).rejects.toThrow(
        'class_slots_capacity_check',
      );
      const slot = await createTestSlot(cls.id, { capacity: null });
      expect(slot.capacity).toBeNull();
    });

    it('rejects a second slot for the same class, day and time', async () => {
      const cls = await createTestClass(PREFIX);
      await createTestSlot(cls.id);
      await expect(createTestSlot(cls.id)).rejects.toMatchObject({ code: 'P2002' });
    });

    it('stores the start time as wall-clock time', async () => {
      const cls = await createTestClass(PREFIX);
      const slot = await createTestSlot(cls.id, {
        startTime: new Date(Date.UTC(1970, 0, 1, 5, 30)),
      });
      expect(slot.startTime.toISOString()).toBe('1970-01-01T05:30:00.000Z');
    });
  });

  describe('sessions', () => {
    it('rejects endAt that is not after startAt', async () => {
      const cls = await createTestClass(PREFIX);
      const startAt = new Date('2030-01-01T06:30:00.000Z');
      await expect(createTestSession(cls.id, { startAt, endAt: startAt })).rejects.toThrow(
        'class_sessions_time_check',
      );
      await expect(
        createTestSession(cls.id, { startAt, endAt: new Date(startAt.getTime() - 1) }),
      ).rejects.toThrow('class_sessions_time_check');
    });

    it('rejects capacity below 1', async () => {
      const cls = await createTestClass(PREFIX);
      await expect(createTestSession(cls.id, { capacity: 0 })).rejects.toThrow(
        'class_sessions_capacity_check',
      );
    });

    it('rejects a second session for the same class and start, allows another class', async () => {
      const cls = await createTestClass(PREFIX);
      const other = await createTestClass(PREFIX);
      await createTestSession(cls.id);
      await expect(createTestSession(cls.id)).rejects.toMatchObject({ code: 'P2002' });
      await expect(createTestSession(other.id)).resolves.toBeDefined();
    });

    it('allows a cancel reason only on a cancelled session', async () => {
      const cls = await createTestClass(PREFIX);
      await expect(
        createTestSession(cls.id, { state: 'OPEN', cancelReason: 'sick coach' }),
      ).rejects.toThrow('class_sessions_cancel_reason_check');
      const cancelled = await createTestSession(cls.id, {
        state: 'CANCELLED',
        cancelReason: 'sick coach',
      });
      expect(cancelled.cancelReason).toBe('sick coach');
    });

    it('defaults to open, not private, version 1 and no slot (one-off)', async () => {
      const cls = await createTestClass(PREFIX);
      const session = await createTestSession(cls.id);
      expect(session).toMatchObject({ state: 'OPEN', isPrivate: false, version: 1, slotId: null });
    });

    it('bumps the session version only when a column really changes', async () => {
      const cls = await createTestClass(PREFIX);
      const session = await createTestSession(cls.id);
      const same = await prisma.classSession.update({
        where: { id: session.id },
        data: { capacity: session.capacity },
      });
      expect(same.version).toBe(1);
      const changed = await prisma.classSession.update({
        where: { id: session.id },
        data: { state: 'FULL' },
      });
      expect(changed.version).toBe(2);
    });
  });

  describe('foreign keys', () => {
    it('removing a class removes its slots and coach links, but not while it has sessions', async () => {
      const { coach } = await data.createCoach();
      const cls = await createTestClass(PREFIX);
      const slot = await createTestSlot(cls.id);
      await prisma.classCoach.create({ data: { classId: cls.id, coachId: coach.id } });
      await prisma.classSlotCoach.create({ data: { slotId: slot.id, coachId: coach.id } });
      const session = await createTestSession(cls.id);

      await expect(prisma.class.delete({ where: { id: cls.id } })).rejects.toThrow(RESTRICT);

      await prisma.classSession.delete({ where: { id: session.id } });
      await prisma.class.delete({ where: { id: cls.id } });
      expect(await prisma.classSlot.count({ where: { classId: cls.id } })).toBe(0);
      expect(await prisma.classCoach.count({ where: { classId: cls.id } })).toBe(0);
      expect(await prisma.classSlotCoach.count({ where: { slotId: slot.id } })).toBe(0);
    });

    it('removing a slot keeps its sessions as one-offs', async () => {
      const cls = await createTestClass(PREFIX);
      const slot = await createTestSlot(cls.id);
      const session = await createTestSession(cls.id, { slotId: slot.id });
      await prisma.classSlot.delete({ where: { id: slot.id } });
      const kept = await prisma.classSession.findUnique({ where: { id: session.id } });
      expect(kept.slotId).toBeNull();
    });

    it('removing a session removes its coach links; a coach with session history cannot be deleted', async () => {
      const { coach } = await data.createCoach();
      const cls = await createTestClass(PREFIX);
      const session = await createTestSession(cls.id);
      await prisma.classSessionCoach.create({
        data: { sessionId: session.id, coachId: coach.id },
      });

      await expect(prisma.coach.delete({ where: { id: coach.id } })).rejects.toThrow(RESTRICT);

      await prisma.classSession.delete({ where: { id: session.id } });
      expect(await prisma.classSessionCoach.count({ where: { sessionId: session.id } })).toBe(0);
    });

    it('a plan that is eligible for a class cannot be deleted; removing the class frees it', async () => {
      const plan = await createTestPlan(PREFIX);
      const cls = await createTestClass(PREFIX);
      await prisma.classEligiblePlan.create({ data: { classId: cls.id, planId: plan.id } });

      await expect(prisma.membershipPlan.delete({ where: { id: plan.id } })).rejects.toThrow(
        RESTRICT,
      );

      await prisma.class.delete({ where: { id: cls.id } });
      await expect(prisma.membershipPlan.delete({ where: { id: plan.id } })).resolves.toBeDefined();
    });

    it('rejects a duplicate coach on the same class', async () => {
      const { coach } = await data.createCoach();
      const cls = await createTestClass(PREFIX);
      await prisma.classCoach.create({ data: { classId: cls.id, coachId: coach.id } });
      await expect(
        prisma.classCoach.create({ data: { classId: cls.id, coachId: coach.id } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
