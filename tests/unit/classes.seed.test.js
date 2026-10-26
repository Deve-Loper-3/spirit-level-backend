const {
  parseDurationMin,
  parseCapacities,
  programmeKey,
  parseDayOfWeek,
  parseStartTime,
  collectProgrammes,
  collectSlots,
  WarningType,
} = require('../../prisma/seeds/classes.seed');

describe('classes.seed parsers', () => {
  it.each([
    ['60 min', 60],
    ['90 MIN', 90],
    ['45min', 45],
    ['soon', null],
    ['', null],
  ])('parseDurationMin(%j) = %p', (input, expected) => {
    expect(parseDurationMin(input)).toBe(expected);
  });

  it('parseCapacities reads one or several numbers and ignores junk', () => {
    expect(parseCapacities('24, 32')).toEqual([24, 32]);
    expect(parseCapacities('12')).toEqual([12]);
    expect(parseCapacities('n/a')).toEqual([]);
    expect(parseCapacities('')).toEqual([]);
  });

  it('programmeKey treats "(90min)" and "(90mins)" as the same programme', () => {
    expect(programmeKey('Hyrox Endurance (90mins)')).toBe(programmeKey('Hyrox Endurance (90min)'));
    expect(programmeKey('Hyrox  Engine')).toBe(programmeKey('hyrox engine'));
    expect(programmeKey('Level X')).not.toBe(programmeKey('Hyrox HIIT'));
  });

  it('parseDayOfWeek returns ISO weekdays, Monday = 1', () => {
    expect(parseDayOfWeek('Monday')).toBe(1);
    expect(parseDayOfWeek('sunday')).toBe(7);
    expect(parseDayOfWeek('Funday')).toBeNull();
  });

  it('parseStartTime returns a UTC time on 1970-01-01', () => {
    expect(parseStartTime('05:30').toISOString()).toBe('1970-01-01T05:30:00.000Z');
    expect(parseStartTime('5:30')).toEqual(parseStartTime('05:30'));
    expect(parseStartTime('half past five')).toBeNull();
  });
});

describe('classes.seed collectors', () => {
  const classRow = (name, overrides = {}) => ({
    name,
    capacity: '12',
    coaches: 'Ben Gregory',
    programmeIds: 'id1',
    visibility: 'PUBLIC',
    ...overrides,
  });

  it('collectProgrammes keeps the first spelling and merges capacities, coaches and ids', () => {
    const warnings = [];
    const programmes = collectProgrammes(
      [
        classRow('Endurance (90min)', { capacity: '24, 32', programmeIds: 'a' }),
        classRow('Endurance (90mins)', {
          capacity: '24',
          coaches: 'Luke Skippon, Ben Gregory',
          programmeIds: 'b',
        }),
      ],
      warnings,
    );

    expect(programmes.size).toBe(1);
    const merged = [...programmes.values()][0];
    expect(merged.name).toBe('Endurance (90min)');
    expect(merged.capacities).toEqual([24, 32, 24]);
    expect(merged.coachNames).toEqual(['Ben Gregory', 'Luke Skippon']);
    expect(merged.programmeIds).toEqual(['a', 'b']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe(WarningType.DUPLICATE_PROGRAMME);
  });

  it('collectSlots merges coaches of the same slot and skips unknown classes', () => {
    const warnings = [];
    const programmes = collectProgrammes([classRow('Engine')], warnings);
    const row = (overrides) => ({
      day: 'Monday',
      start: '06:30',
      className: 'Engine',
      coach: 'Ben Gregory',
      capacity: '12',
      visibility: 'Public',
      ...overrides,
    });

    const slots = collectSlots(
      [row(), row({ coach: 'Luke Skippon' }), row({ className: 'Nope' }), row({ day: 'Someday' })],
      programmes,
      warnings,
    );

    expect(slots.size).toBe(1);
    expect([...slots.values()][0]).toMatchObject({
      dayOfWeek: 1,
      capacity: 12,
      coachNames: ['Ben Gregory', 'Luke Skippon'],
    });
    expect(warnings.filter((w) => w.type === WarningType.UNKNOWN_CLASS_IN_TIMETABLE)).toHaveLength(
      2,
    );
  });
});
