const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const prisma = require('../../src/config/prisma');
const { runSeed, WarningType } = require('../../prisma/seeds/classes.seed');
const { createTestData } = require('../helpers/testData.helper');
const { deleteTestClasses } = require('../helpers/class.helper');

jest.setTimeout(90000);

describe('classes.seed runner with a generated workbook', () => {
  const PREFIX = 'test_slcls01_seed_';
  const REF_PREFIX = 'test_slcls01_ref_';
  const data = createTestData('slcls01_seed');
  const filePath = path.join(os.tmpdir(), `${PREFIX}${process.pid}.xlsx`);
  const coachName = `${PREFIX}Coach One`;

  const CLASS_HEADERS = [
    'Class',
    'Description',
    'Duration',
    'Capacity',
    'Coaches (recent)',
    'Visibility',
    'Image URL',
    'Glofox programme IDs',
  ];
  const TIMETABLE_HEADERS = ['Day', 'Start', 'Class', 'Coach', 'Capacity', 'Visibility'];

  // Header on row 4 like the real sheets; rows 1-3 are titles.
  const addSheet = (workbook, name, headers, rows) => {
    const sheet = workbook.addWorksheet(name);
    sheet.getRow(4).values = headers;
    rows.forEach((row, i) => {
      sheet.getRow(5 + i).values = row;
    });
  };

  const buildWorkbook = async () => {
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, 'Classes', CLASS_HEADERS, [
      [`${PREFIX}Engine`, 'Engine desc', '60 min', '12', coachName, 'Public', '', `${REF_PREFIX}1`],
      [
        `${PREFIX}Endurance (90min)`,
        'Long one',
        '90 min',
        '24, 32',
        `${coachName}, ${PREFIX}Ghost`,
        'Public',
        'https://example.test/a.png',
        `${REF_PREFIX}2, ${REF_PREFIX}2b`,
      ],
      [
        `${PREFIX}Endurance (90mins)`,
        'Long one',
        '90 min',
        '24',
        `${PREFIX}Other`,
        'Public',
        '',
        `${REF_PREFIX}3`,
      ],
      [`${PREFIX}Closed (Private)`, 'Private', '60 min', '1', '', 'Private', '', `${REF_PREFIX}4`],
      [`${PREFIX}Broken`, 'No duration', 'soon', '12', '', 'Public', '', `${REF_PREFIX}5`],
    ]);
    addSheet(workbook, 'Weekly Timetable', TIMETABLE_HEADERS, [
      ['Monday', '06:30', `${PREFIX}Engine`, coachName, '12', 'Public'],
      ['Monday', '19:00', `${PREFIX}Engine`, `${PREFIX}Ghost`, '12', 'Public'],
      ['Saturday', '08:00', `${PREFIX}Endurance (90min)`, coachName, '32', 'Public'],
      ['Saturday', '13:30', `${PREFIX}Endurance (90min)`, coachName, '24', 'Public'],
      ['Sunday', '10:00', `${PREFIX}Endurance (90mins)`, coachName, '24', 'Public'],
      ['Monday', '20:00', `${PREFIX}Closed (Private)`, coachName, '1', 'Public'],
      ['Tuesday', '07:00', `${PREFIX}Not In Classes`, coachName, '12', 'Public'],
    ]);
    await workbook.xlsx.writeFile(filePath);
  };

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await data.cleanup();
  };

  const loadSeeded = () =>
    prisma.class.findMany({
      where: { name: { startsWith: PREFIX } },
      include: { slots: { include: { coaches: true } }, coaches: true },
      orderBy: { name: 'asc' },
    });

  beforeAll(async () => {
    await cleanup();
    await data.createCoach({ user: { fullName: coachName } });
    await buildWorkbook();
  });

  afterAll(async () => {
    await cleanup();
    fs.rmSync(filePath, { force: true });
    await prisma.$disconnect();
  });

  it('creates one class per programme, merges the duplicate and reports every oddity', async () => {
    const result = await runSeed(filePath);

    expect(result.stats).toMatchObject({
      classesRead: 5,
      created: 3,
      updated: 0,
      skipped: 1,
      slotsCreated: 6,
    });
    expect(result.skippedList).toHaveLength(1);
    expect(result.skippedList[0].name).toBe(`${PREFIX}Broken`);

    const types = result.warnings.map((w) => w.type);
    expect(types.filter((t) => t === WarningType.DUPLICATE_PROGRAMME)).toHaveLength(1);
    expect(types.filter((t) => t === WarningType.VISIBILITY_CONFLICT)).toHaveLength(1);
    expect(types.filter((t) => t === WarningType.UNKNOWN_CLASS_IN_TIMETABLE)).toHaveLength(1);
    const missingCoaches = result.warnings
      .filter((w) => w.type === WarningType.COACH_NOT_FOUND)
      .map((w) => w.name)
      .sort();
    expect(missingCoaches).toEqual([`${PREFIX}Ghost`, `${PREFIX}Other`]);
  });

  it('stores canonical name, smallest capacity as base, first programme id and private visibility', async () => {
    const classes = await loadSeeded();
    expect(classes.map((c) => c.name)).toEqual([
      `${PREFIX}Closed (Private)`,
      `${PREFIX}Endurance (90min)`,
      `${PREFIX}Engine`,
    ]);

    const [closed, endurance, engine] = classes;
    expect(closed).toMatchObject({ visibility: 'PRIVATE', baseCapacity: 1, intensity: 3 });
    expect(endurance).toMatchObject({
      durationMin: 90,
      baseCapacity: 24,
      externalRef: `${REF_PREFIX}2`,
      photoUrl: 'https://example.test/a.png',
      classpassSpots: 0,
      status: 'ACTIVE',
      version: 1,
    });
    expect(engine.photoUrl).toBeNull();
  });

  it('creates slots with Dubai wall-clock time, a capacity override only where it differs, and coaches', async () => {
    const [, endurance, engine] = await loadSeeded();

    const bySlot = (cls) =>
      cls.slots
        .map((s) => ({
          day: s.dayOfWeek,
          time: s.startTime.toISOString().slice(11, 16),
          capacity: s.capacity,
          coaches: s.coaches.length,
        }))
        .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));

    expect(bySlot(endurance)).toEqual([
      { day: 6, time: '08:00', capacity: 32, coaches: 1 },
      { day: 6, time: '13:30', capacity: null, coaches: 1 },
      { day: 7, time: '10:00', capacity: null, coaches: 1 },
    ]);
    expect(bySlot(engine)).toEqual([
      { day: 1, time: '06:30', capacity: null, coaches: 1 },
      { day: 1, time: '19:00', capacity: null, coaches: 0 },
    ]);
    expect(endurance.coaches).toHaveLength(1);
  });

  it('lists seeded public classes that have no eligible plan', async () => {
    const result = await runSeed(filePath);
    expect(result.publicClassesWithoutPlans).toEqual([
      `${PREFIX}Endurance (90min)`,
      `${PREFIX}Engine`,
    ]);
  });

  it('is idempotent: a rerun creates nothing and does not bump versions', async () => {
    const before = await loadSeeded();
    const result = await runSeed(filePath);
    const after = await loadSeeded();

    expect(result.stats).toMatchObject({ created: 0, slotsCreated: 0, skipped: 1 });
    expect(after.map((c) => [c.id, c.version, c.slots.length, c.coaches.length])).toEqual(
      before.map((c) => [c.id, c.version, c.slots.length, c.coaches.length]),
    );
  });

  it('brings a changed class back in line with the sheet', async () => {
    const [, endurance] = await loadSeeded();
    await prisma.class.update({ where: { id: endurance.id }, data: { baseCapacity: 99 } });
    await runSeed(filePath);
    const restored = await prisma.class.findUnique({ where: { id: endurance.id } });
    expect(restored.baseCapacity).toBe(24);
  });
});
