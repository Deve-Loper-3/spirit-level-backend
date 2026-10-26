const path = require('path');
const ExcelJS = require('exceljs');
const { z } = require('zod');
const { ClassVisibility, DAY_OF_WEEK } = require('../../src/constants/class');
const repository = require('../../src/repositories/class.repository');
const prisma = require('../../src/config/prisma');
const { createRowReader } = require('./xlsx.util');

const CLASSES_SEED_CONFIG = {
  defaultPath: path.join(__dirname, '../../docs/Spirit_Level_Glofox_Business_Data.xlsx'),
  classesSheet: 'Classes',
  timetableSheet: 'Weekly Timetable',
  headerRow: 4,
};

const WarningType = Object.freeze({
  DUPLICATE_PROGRAMME: 'DUPLICATE_PROGRAMME',
  VISIBILITY_CONFLICT: 'VISIBILITY_CONFLICT',
  COACH_NOT_FOUND: 'COACH_NOT_FOUND',
  UNKNOWN_CLASS_IN_TIMETABLE: 'UNKNOWN_CLASS_IN_TIMETABLE',
});

const classSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  durationMin: z.number().int().positive(),
  baseCapacity: z.number().int().min(1),
  visibility: z.enum([ClassVisibility.PUBLIC, ClassVisibility.PRIVATE]),
  photoUrl: z.string().nullable(),
  externalRef: z.string().min(1),
});

const splitList = (value) =>
  value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseDurationMin = (value) => {
  const match = value.match(/^(\d+)\s*min/i);
  return match ? parseInt(match[1], 10) : null;
};

// "24, 32" -> [24, 32]
const parseCapacities = (value) =>
  splitList(value)
    .map((item) => parseInt(item, 10))
    .filter(Number.isInteger);

// "Hyrox Endurance (90mins)" and "(90min)" are the same programme; the key ignores that spelling.
const programmeKey = (name) =>
  name
    .toLowerCase()
    .replace(/\(\s*(\d+)\s*mins?\s*\)/, '($1min)')
    .replace(/\s+/g, ' ')
    .trim();

const parseDayOfWeek = (value) => DAY_OF_WEEK[value.trim().toUpperCase()] || null;

// "05:30" -> Date on 1970-01-01 in UTC, the shape Prisma uses for a Postgres TIME column.
const parseStartTime = (value) => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(1970, 0, 1, parseInt(match[1], 10), parseInt(match[2], 10)));
};

const toVisibility = (value) =>
  value.toLowerCase() === 'private' ? ClassVisibility.PRIVATE : ClassVisibility.PUBLIC;

// Folds the Classes sheet rows into one entry per programme (first spelling wins).
const collectProgrammes = (rows, warnings) => {
  const programmes = new Map();
  rows.forEach((row) => {
    const key = programmeKey(row.name);
    const existing = programmes.get(key);
    if (!existing) {
      programmes.set(key, {
        key,
        ...row,
        capacities: parseCapacities(row.capacity),
        coachNames: splitList(row.coaches),
        programmeIds: splitList(row.programmeIds),
      });
      return;
    }
    existing.capacities.push(...parseCapacities(row.capacity));
    existing.coachNames = [...new Set([...existing.coachNames, ...splitList(row.coaches)])];
    existing.programmeIds.push(...splitList(row.programmeIds));
    warnings.push({
      type: WarningType.DUPLICATE_PROGRAMME,
      name: row.name,
      message: `"${row.name}" is the same programme as "${existing.name}"; seeded once as "${existing.name}"`,
    });
  });
  return programmes;
};

// Folds the timetable rows into one entry per (programme, day, start time).
const collectSlots = (rows, programmes, warnings) => {
  const slots = new Map();
  rows.forEach((row) => {
    const key = programmeKey(row.className);
    const programme = programmes.get(key);
    const dayOfWeek = parseDayOfWeek(row.day);
    const startTime = parseStartTime(row.start);
    if (!programme || !dayOfWeek || !startTime) {
      warnings.push({
        type: WarningType.UNKNOWN_CLASS_IN_TIMETABLE,
        name: row.className,
        message: `Timetable row "${row.className}" ${row.day} ${row.start} skipped (unknown class, day or time)`,
      });
      return;
    }
    const slotKey = `${key}|${dayOfWeek}|${row.start}`;
    const slot = slots.get(slotKey) || {
      programmeKey: key,
      dayOfWeek,
      startTime,
      capacity: parseInt(row.capacity, 10) || null,
      coachNames: [],
    };
    if (row.coach) slot.coachNames = [...new Set([...slot.coachNames, row.coach])];
    slots.set(slotKey, slot);
    if (toVisibility(row.visibility) !== programme.visibility) {
      warnings.push({
        type: WarningType.VISIBILITY_CONFLICT,
        name: programme.name,
        message: `"${programme.name}" is ${programme.visibility} on the Classes sheet but "${row.visibility}" on the timetable; the Classes sheet wins`,
      });
    }
  });
  return slots;
};

const readSheetRows = (worksheet, columns) => {
  const read = createRowReader(worksheet, CLASSES_SEED_CONFIG.headerRow);
  const rows = [];
  for (let r = CLASSES_SEED_CONFIG.headerRow + 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const values = Object.fromEntries(
      Object.entries(columns).map(([field, header]) => [field, read(row, header)]),
    );
    if (Object.values(values).some(Boolean)) rows.push(values);
  }
  return rows;
};

const resolveCoachIds = (names, coachIdsByName, warnings, warned) =>
  names.reduce((ids, name) => {
    const id = coachIdsByName.get(name.toLowerCase());
    if (id) return [...ids, id];
    if (!warned.has(name)) {
      warned.add(name);
      warnings.push({
        type: WarningType.COACH_NOT_FOUND,
        name,
        message: `No coach account named "${name}"; assignments to this coach were skipped`,
      });
    }
    return ids;
  }, []);

const saveProgramme = async ({ data, coachIds, slotResults, stats, client }) => {
  const existing = await repository.findByExternalRef(data.externalRef, client);
  await client.$transaction(
    async (tx) => {
      const saved = await repository.upsertByExternalRef({
        externalRef: data.externalRef,
        data,
        client: tx,
      });
      await repository.replaceClassCoaches(saved.id, coachIds, tx);
      for (const { slot, coachIds: slotCoachIds } of slotResults) {
        const capacity =
          slot.capacity && slot.capacity !== data.baseCapacity ? slot.capacity : null;
        const result = await repository.upsertSlot(
          { classId: saved.id, dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, capacity },
          tx,
        );
        await repository.replaceSlotCoaches(result.slot.id, slotCoachIds, tx);
        if (result.created) stats.slotsCreated += 1;
        else stats.slotsUpdated += 1;
      }
    },
    { maxWait: 10000, timeout: 60000 },
  );
  if (existing) stats.updated += 1;
  else stats.created += 1;
};

const runSeed = async (filePath, options = {}) => {
  const targetPath = filePath || process.env.SEED_CLASSES_FILE || CLASSES_SEED_CONFIG.defaultPath;
  const client = options.prismaClient || prisma;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(targetPath);

  const classesSheet = workbook.getWorksheet(CLASSES_SEED_CONFIG.classesSheet);
  const timetableSheet = workbook.getWorksheet(CLASSES_SEED_CONFIG.timetableSheet);
  if (!classesSheet || !timetableSheet) {
    throw new Error(
      `Worksheets "${CLASSES_SEED_CONFIG.classesSheet}" and "${CLASSES_SEED_CONFIG.timetableSheet}" are required in ${targetPath}`,
    );
  }

  const warnings = [];
  const skippedList = [];
  const stats = {
    classesRead: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    slotsCreated: 0,
    slotsUpdated: 0,
  };

  const classRows = readSheetRows(classesSheet, {
    name: 'Class',
    description: 'Description',
    duration: 'Duration',
    capacity: 'Capacity',
    coaches: 'Coaches (recent)',
    visibility: 'Visibility',
    photoUrl: 'Image URL',
    programmeIds: 'Glofox programme IDs',
  }).filter((row) => row.name);
  stats.classesRead = classRows.length;
  const programmes = collectProgrammes(
    classRows.map((row) => ({ ...row, visibility: toVisibility(row.visibility) })),
    warnings,
  );

  const timetableRows = readSheetRows(timetableSheet, {
    day: 'Day',
    start: 'Start',
    className: 'Class',
    coach: 'Coach',
    capacity: 'Capacity',
    visibility: 'Visibility',
  }).filter((row) => row.className);
  const slots = collectSlots(timetableRows, programmes, warnings);

  const coachIdsByName = new Map(
    (await repository.listCoachesWithNames(client)).map((coach) => [
      coach.fullName.trim().toLowerCase(),
      coach.id,
    ]),
  );
  const warnedCoaches = new Set();
  const seededRefs = [];

  for (const programme of programmes.values()) {
    const parsed = classSchema.safeParse({
      name: programme.name,
      description: programme.description || null,
      durationMin: parseDurationMin(programme.duration),
      baseCapacity: programme.capacities.length ? Math.min(...programme.capacities) : null,
      visibility: programme.visibility,
      photoUrl: programme.photoUrl || null,
      externalRef: programme.programmeIds[0],
    });
    if (!parsed.success) {
      stats.skipped += 1;
      skippedList.push({
        name: programme.name,
        reason: `Validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      });
      continue;
    }
    seededRefs.push(parsed.data.externalRef);

    const slotResults = [...slots.values()]
      .filter((slot) => slot.programmeKey === programme.key)
      .map((slot) => ({
        slot,
        coachIds: resolveCoachIds(slot.coachNames, coachIdsByName, warnings, warnedCoaches),
      }));
    await saveProgramme({
      data: parsed.data,
      coachIds: resolveCoachIds(programme.coachNames, coachIdsByName, warnings, warnedCoaches),
      slotResults,
      stats,
      client,
    });
  }

  const publicClassesWithoutPlans = (
    await repository.listPublicClassesWithoutPlans(seededRefs, client)
  ).map((item) => item.name);

  return { stats, warnings, skippedList, publicClassesWithoutPlans };
};

const printReport = (result) => {
  const out = (line) => process.stdout.write(`${line}\n`);
  out('\n=============================================');
  out('          CLASS TIMETABLE SEED REPORT         ');
  out('=============================================');
  out(`Class rows read:   ${result.stats.classesRead}`);
  out(`Classes created:   ${result.stats.created}`);
  out(`Classes updated:   ${result.stats.updated}`);
  out(`Classes skipped:   ${result.stats.skipped}`);
  out(`Slots created:     ${result.stats.slotsCreated}`);
  out(`Slots updated:     ${result.stats.slotsUpdated}`);
  result.skippedList.forEach((s) => out(`  Skipped "${s.name}": ${s.reason}`));
  out(`\nWarnings (${result.warnings.length}):`);
  result.warnings.forEach((w) => out(`  [${w.type}] ${w.message}`));
  out(`\nPublic classes with zero eligible plans (${result.publicClassesWithoutPlans.length}):`);
  result.publicClassesWithoutPlans.forEach((name) => out(`  - ${name}`));
};

if (require.main === module) {
  runSeed(process.argv[2])
    .then((result) => {
      printReport(result);
      return prisma.$disconnect();
    })
    .catch((err) => {
      process.stderr.write(`\nSeed error: ${err.message || err}\n`);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}

module.exports = {
  runSeed,
  CLASSES_SEED_CONFIG,
  WarningType,
  parseDurationMin,
  parseCapacities,
  programmeKey,
  parseDayOfWeek,
  parseStartTime,
  collectProgrammes,
  collectSlots,
};
