const {
  createClassSchema,
  patchFieldsSchema,
  classEligibilitySchema,
  listClassesQuerySchema,
} = require('../../src/validators/class.validation');
const { Messages } = require('../../src/constants/messages');

describe('Class Validation Unit Tests', () => {
  const validUUID = 'a0000000-0000-4000-8000-000000000001';

  describe('createClassSchema', () => {
    const validPublicClass = {
      name: 'HIIT Conditioning',
      description: 'High intensity conditioning session',
      durationMin: 60,
      baseCapacity: 20,
      classType: 'onsite',
      intensity: 4,
      visibility: 'public',
      classPassEnabled: true,
      classpassSpots: 5,
      colour: '#FF5733',
      photoUrl: 'https://example.com/images/hiit.jpg',
      eligiblePlanIds: [validUUID],
    };

    it('passes with valid public class data', () => {
      const result = createClassSchema.safeParse(validPublicClass);
      expect(result.success).toBe(true);
      expect(result.data.visibility).toBe('PUBLIC');
    });

    it('passes with valid private class data with empty eligiblePlanIds', () => {
      const result = createClassSchema.safeParse({
        ...validPublicClass,
        visibility: 'private',
        eligiblePlanIds: [],
      });
      expect(result.success).toBe(true);
      expect(result.data.visibility).toBe('PRIVATE');
    });

    describe('name boundaries', () => {
      it('rejects 1 char name', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, name: 'A' });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_NAME_INVALID);
      });

      it('accepts 2 char name', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, name: 'AB' });
        expect(result.success).toBe(true);
      });

      it('accepts 80 char name', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          name: 'A'.repeat(80),
        });
        expect(result.success).toBe(true);
      });

      it('rejects 81 char name', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          name: 'A'.repeat(81),
        });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_NAME_INVALID);
      });

      it('trims whitespace around name', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          name: '  HIIT Conditioning  ',
        });
        expect(result.success).toBe(true);
        expect(result.data.name).toBe('HIIT Conditioning');
      });
    });

    describe('durationMin boundaries', () => {
      it('rejects durationMin 14', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, durationMin: 14 });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_DURATION_INVALID);
      });

      it('accepts durationMin 15', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, durationMin: 15 });
        expect(result.success).toBe(true);
      });

      it('accepts durationMin 240', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, durationMin: 240 });
        expect(result.success).toBe(true);
      });

      it('rejects durationMin 241', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, durationMin: 241 });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_DURATION_INVALID);
      });

      it('rejects non-integer durationMin', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, durationMin: 60.5 });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_DURATION_INVALID);
      });
    });

    describe('baseCapacity boundaries', () => {
      it('rejects baseCapacity 0', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, baseCapacity: 0 });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_BASE_CAPACITY_INVALID);
      });

      it('accepts baseCapacity 1', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          baseCapacity: 1,
          classpassSpots: 0,
        });
        expect(result.success).toBe(true);
      });

      it('accepts baseCapacity 200', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, baseCapacity: 200 });
        expect(result.success).toBe(true);
      });

      it('rejects baseCapacity 201', () => {
        const result = createClassSchema.safeParse({ ...validPublicClass, baseCapacity: 201 });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_BASE_CAPACITY_INVALID);
      });
    });

    describe('intensity boundaries', () => {
      it.each([0, 6, -1, 3.5])('rejects invalid intensity %p', (intensity) => {
        const result = createClassSchema.safeParse({ ...validPublicClass, intensity });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_INTENSITY_INVALID);
      });

      it.each([1, 2, 3, 4, 5])('accepts valid intensity %p', (intensity) => {
        const result = createClassSchema.safeParse({ ...validPublicClass, intensity });
        expect(result.success).toBe(true);
      });
    });

    describe('classpassSpots rules', () => {
      it('rejects classpassSpots exceeding baseCapacity', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          baseCapacity: 10,
          classpassSpots: 11,
        });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_CLASSPASS_SPOTS_INVALID);
      });

      it('accepts classpassSpots equal to baseCapacity', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          baseCapacity: 10,
          classpassSpots: 10,
        });
        expect(result.success).toBe(true);
      });

      it('rejects negative classpassSpots', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          classpassSpots: -1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('colour and photoUrl', () => {
      it.each(['#112233', '#AABBCC', '#abcdef'])('accepts valid hex colour %p', (colour) => {
        const result = createClassSchema.safeParse({ ...validPublicClass, colour });
        expect(result.success).toBe(true);
      });

      it.each(['red', '#GGG', '#12345', '123456'])('rejects invalid hex colour %p', (colour) => {
        const result = createClassSchema.safeParse({ ...validPublicClass, colour });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_COLOUR_INVALID);
      });

      it('accepts valid https photoUrl', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          photoUrl: 'https://cdn.example.com/photo.png',
        });
        expect(result.success).toBe(true);
      });

      it('rejects http photoUrl', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          photoUrl: 'http://cdn.example.com/photo.png',
        });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_PHOTO_URL_INVALID);
      });
    });

    describe('public class eligibility rule', () => {
      it('rejects public class with empty eligiblePlanIds', () => {
        const result = createClassSchema.safeParse({
          ...validPublicClass,
          eligiblePlanIds: [],
        });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_PUBLIC_REQUIRES_PLANS);
      });

      it('rejects public class without eligiblePlanIds', () => {
        const withoutPlans = { ...validPublicClass };
        delete withoutPlans.eligiblePlanIds;
        const result = createClassSchema.safeParse(withoutPlans);
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(Messages.CLASS_PUBLIC_REQUIRES_PLANS);
      });
    });
  });

  describe('patchFieldsSchema', () => {
    it('accepts valid partial fields', () => {
      const result = patchFieldsSchema.safeParse({
        name: 'Updated Name',
        durationMin: 90,
        version: 2,
      });
      expect(result.success).toBe(true);
    });

    it('rejects durationMin out of range', () => {
      const result = patchFieldsSchema.safeParse({ durationMin: 10 });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.CLASS_DURATION_INVALID);
    });
  });

  describe('classEligibilitySchema', () => {
    it('accepts array of UUIDs', () => {
      const result = classEligibilitySchema.safeParse({ planIds: [validUUID] });
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID strings', () => {
      const result = classEligibilitySchema.safeParse({ planIds: ['invalid-uuid'] });
      expect(result.success).toBe(false);
    });
  });

  describe('listClassesQuerySchema', () => {
    it('accepts valid query parameters', () => {
      const result = listClassesQuerySchema.safeParse({
        visibility: 'public',
        active: 'all',
        page: '2',
        pageSize: '50',
      });
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        visibility: 'public',
        active: 'all',
        page: 2,
        pageSize: 50,
      });
    });
  });
});
