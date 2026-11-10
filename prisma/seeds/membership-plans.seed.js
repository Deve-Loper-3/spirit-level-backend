const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanCreditRefill,
  PlanValidityUnit,
  PlanStartsOn,
  PlanVisibility,
  PlanStatus,
} = require('../../src/constants/membershipPlan');
const { membershipPlanSchema } = require('../../src/validators/membershipPlan.validation');
const {
  upsertByExternalRef,
  findByExternalRef,
} = require('../../src/repositories/membershipPlan.repository');
const prisma = require('../../src/config/prisma');
const { getCellValue } = require('./xlsx.util');

const GLOFOX_SEED_CONFIG = {
  defaultPath: path.join(__dirname, '../../docs/Spirit_Level_Glofox_Business_Data.xlsx'),
  sheetName: 'Memberships',
  headerRow: 4,
};

const parseDuration = (str) => {
  if (!str) return null;
  const match = str.match(/(\d+)\s*(month|week|day)s?/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const rawUnit = match[2].toUpperCase();
  const unit = PlanValidityUnit[rawUnit] || null;
  return { value, unit };
};

const parseCreditsIncluded = (str) => {
  if (!str) return null;
  // Examples:
  // "1 x Classes, credits expire after 1 week"
  // "15 x Classes, credits expire after 3 months"
  // "10 x Appointments (PT / Simulation), credits expire after 3 months"
  // "20 x Facilities (Open Gym / Recovery), credits expire after 1 month"
  const match = str.match(
    /^(\d+)\s*x\s*([A-Za-z]+).*?credits expire after\s*(\d+)\s*(week|month|day)s?/i,
  );
  if (!match) return null;
  const count = parseInt(match[1], 10);
  const typeWord = match[2].toLowerCase();
  let creditType = null;
  if (typeWord.startsWith('class')) creditType = PlanCreditType.CLASS;
  else if (typeWord.startsWith('appointment')) creditType = PlanCreditType.APPOINTMENT;
  else if (typeWord.startsWith('facilit')) creditType = PlanCreditType.FACILITY;

  const validityValue = parseInt(match[3], 10);
  const validityUnit = PlanValidityUnit[match[4].toUpperCase()] || null;

  return { count, creditType, validityValue, validityUnit };
};

/** Map a Glofox duration string to a standard recurring cycle, or null if not recurring. */
const recurringBillingFromDuration = (durationStr) => {
  const dur = parseDuration(durationStr);
  if (!dur || dur.unit !== PlanValidityUnit.MONTH) return null;
  if (dur.value === 1) return PlanBillingCycle.MONTH;
  if (dur.value === 3) return PlanBillingCycle.QUARTER;
  if (dur.value === 6) return PlanBillingCycle.HALF_YEAR;
  if (dur.value === 12) return PlanBillingCycle.YEAR;
  return null;
};

/**
 * Trial → TRIAL; time-based → SUBSCRIPTION; credit-based with a standard
 * recurring duration (1/3/6/12 months) and not buy-once → SUBSCRIPTION;
 * otherwise CREDIT_PACK.
 */
const asLower = (val) =>
  String(val || '')
    .toLowerCase()
    .trim();

const deriveKind = ({ trialVal, planType, durationStr, buyOnceVal }) => {
  if (asLower(trialVal) === 'yes') {
    return PlanKind.TRIAL;
  }
  if (asLower(planType).startsWith('time-based')) {
    return PlanKind.SUBSCRIPTION;
  }
  const buyOnce = asLower(buyOnceVal) === 'yes';
  if (!buyOnce && recurringBillingFromDuration(durationStr)) {
    return PlanKind.SUBSCRIPTION;
  }
  return PlanKind.CREDIT_PACK;
};

const deriveBillingCycle = (kind, durationStr) => {
  if (kind !== PlanKind.SUBSCRIPTION) {
    return PlanBillingCycle.ONE_OFF;
  }
  return recurringBillingFromDuration(durationStr) || PlanBillingCycle.ONE_OFF;
};

const deriveCreditRefill = (kind, billingCycle, creditType, creditsIncluded) => {
  if (creditType === PlanCreditType.TIME) {
    return null;
  }
  if (
    kind === PlanKind.SUBSCRIPTION &&
    billingCycle === PlanBillingCycle.MONTH &&
    creditsIncluded > 0
  ) {
    return PlanCreditRefill.MONTHLY;
  }
  return PlanCreditRefill.ONCE;
};

const runSeed = async (filePath, options = {}) => {
  const targetPath = filePath || process.env.SEED_MEMBERSHIP_FILE || GLOFOX_SEED_CONFIG.defaultPath;
  const client = options.prismaClient || prisma;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(targetPath);

  const worksheet = workbook.getWorksheet(GLOFOX_SEED_CONFIG.sheetName);
  if (!worksheet) {
    throw new Error(`Worksheet "${GLOFOX_SEED_CONFIG.sheetName}" not found in ${targetPath}`);
  }

  // Map header row
  const headerRow = worksheet.getRow(GLOFOX_SEED_CONFIG.headerRow);
  const colIndexMap = {};
  headerRow.eachCell((cell, colNumber) => {
    const headerText = getCellValue(cell);
    if (headerText) {
      colIndexMap[headerText] = colNumber;
    }
  });

  const getRowVal = (row, headerName) => {
    const colIdx = colIndexMap[headerName];
    if (!colIdx) return '';
    return getCellValue(row.getCell(colIdx));
  };

  const stats = {
    totalRead: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  const renames = [];
  const skippedList = [];
  const warnings = [];

  const seenNames = new Set();
  const membershipCache = new Map();

  for (let r = GLOFOX_SEED_CONFIG.headerRow + 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const planNameRaw = getRowVal(row, 'Plan name');
    const membershipName = getRowVal(row, 'Membership');
    const planCode = getRowVal(row, 'Glofox plan code');

    // Skip trailing empty rows
    if (!planNameRaw && !planCode) continue;

    stats.totalRead += 1;

    // Upsert is keyed on externalRef; rows without a Glofox plan code cannot be seeded safely
    const trimmedPlanCode = planCode ? String(planCode).trim() : '';
    if (!trimmedPlanCode) {
      stats.skipped += 1;
      skippedList.push({
        row: r,
        planCode: planCode || null,
        name: planNameRaw,
        reason: 'Missing Glofox plan code (externalRef required for upsert)',
      });
      continue;
    }

    // Handle Name Collisions:
    // If name collides case-insensitively with earlier row:
    // append parenthetical qualifier from "Membership" column (e.g. "(Coached)").
    // If no qualifier exists, skip and report.
    let planName = planNameRaw;
    const lowerName = planName.toLowerCase();
    if (seenNames.has(lowerName)) {
      const matchQualifier = membershipName.match(/\(([^)]+)\)/);
      if (matchQualifier) {
        const qualifier = matchQualifier[0].trim();
        const renamedName = `${planName} ${qualifier}`;
        if (seenNames.has(renamedName.toLowerCase())) {
          stats.skipped += 1;
          skippedList.push({
            row: r,
            planCode,
            name: planName,
            reason: `Name collision after rename "${renamedName}" already seen`,
          });
          continue;
        }
        renames.push({
          row: r,
          original: planName,
          renamed: renamedName,
          reason: `Name collision resolved using qualifier "${qualifier}" from Membership "${membershipName}"`,
        });
        planName = renamedName;
      } else {
        stats.skipped += 1;
        skippedList.push({
          row: r,
          planCode,
          name: planName,
          reason: `Name collision with earlier row and no parenthetical qualifier found in "${membershipName}"`,
        });
        continue;
      }
    }
    seenNames.add(planName.toLowerCase());

    const planType = getRowVal(row, 'Plan type');
    const trialVal = getRowVal(row, 'Trial');
    const buyOnceVal = getRowVal(row, 'Buy once only');
    const durationStr = getRowVal(row, 'Duration');
    const creditsStr = getRowVal(row, 'Credits included');
    const startsOnStr = getRowVal(row, 'Starts on');
    const visibilityStr = getRowVal(row, 'Visibility');
    const activeStr = getRowVal(row, 'Active');
    const descriptionStr = getRowVal(row, 'Membership description');
    const priceStr = getRowVal(row, 'Price (AED)');

    // 1. Kind (credit-based recurring memberships are SUBSCRIPTION, not CREDIT_PACK)
    const kind = deriveKind({ trialVal, planType, durationStr, buyOnceVal });

    // 2. oneTimePurchasePerClient
    const oneTimePurchasePerClient =
      trialVal.toLowerCase() === 'yes' || buyOnceVal.toLowerCase() === 'yes';

    // 3. creditType, creditsIncluded, validityValue, validityUnit
    let creditType = PlanCreditType.CLASS;
    let creditsIncluded = 0;
    let validityValue = 1;
    let validityUnit = PlanValidityUnit.MONTH;

    if (planType === 'Time-based (unlimited / access)') {
      creditType = PlanCreditType.TIME;
      creditsIncluded = 0;
      const parsedDur = parseDuration(durationStr);
      if (parsedDur) {
        validityValue = parsedDur.value;
        validityUnit = parsedDur.unit;
      }
    } else {
      const parsedCreds = parseCreditsIncluded(creditsStr);
      if (parsedCreds) {
        creditsIncluded = parsedCreds.count;
        creditType = parsedCreds.creditType;
        validityValue = parsedCreds.validityValue;
        validityUnit = parsedCreds.validityUnit;
      } else {
        // Fallback to duration column if credits format doesn't match
        const parsedDur = parseDuration(durationStr);
        if (parsedDur) {
          validityValue = parsedDur.value;
          validityUnit = parsedDur.unit;
        }
      }
    }

    // Check single_visit candidate warning (flag ALL 1-credit plans, including trials and day passes)
    if (creditsIncluded === 1) {
      warnings.push({
        row: r,
        name: planName,
        kind,
        type: 'SINGLE_VISIT_CANDIDATE',
        message: `Plan has 1 credit; assigned kind=${kind} (single_visit candidate)`,
      });
    }

    // 4. billingCycle
    const billingCycle = deriveBillingCycle(kind, durationStr);
    warnings.push({
      row: r,
      name: planName,
      type: 'DERIVED_BILLING_CYCLE',
      message: `billingCycle=${billingCycle} (from kind=${kind}, duration="${durationStr}")`,
    });

    // 5. creditRefill
    const creditRefill = deriveCreditRefill(kind, billingCycle, creditType, creditsIncluded);
    warnings.push({
      row: r,
      name: planName,
      type: 'DERIVED_CREDIT_REFILL',
      message: `creditRefill=${creditRefill} (from billingCycle=${billingCycle}, creditType=${creditType}, credits=${creditsIncluded})`,
    });

    // 6. startsOn
    const startsOn = startsOnStr.toLowerCase().includes('first booking')
      ? PlanStartsOn.FIRST_BOOKING
      : PlanStartsOn.PURCHASE_DATE;

    // 7. visibility
    const visibility =
      visibilityStr.toLowerCase() === 'hidden' ? PlanVisibility.HIDDEN : PlanVisibility.PUBLIC;

    // 8. status
    const status = activeStr.toLowerCase() === 'no' ? PlanStatus.INACTIVE : PlanStatus.ACTIVE;

    // 9. description
    let description = descriptionStr || null;
    if (description && description.length > 500) {
      warnings.push({
        row: r,
        name: planName,
        type: 'DESCRIPTION_TRUNCATED',
        message: `Description exceeded 500 chars (${description.length}); trimmed to 500`,
      });
      description = description.slice(0, 500);
    }

    // Build payload and validate with Zod
    const payload = {
      name: planName,
      kind,
      price: priceStr,
      billingCycle,
      creditType,
      creditsIncluded,
      creditRefill,
      validityValue,
      validityUnit,
      startsOn,
      oneTimePurchasePerClient,
      visibility,
      status,
      description,
      externalRef: trimmedPlanCode,
    };

    const parsed = membershipPlanSchema.safeParse(payload);
    if (!parsed.success) {
      stats.skipped += 1;
      skippedList.push({
        row: r,
        planCode,
        name: planName,
        reason: `Validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      });
      continue;
    }

    const validData = parsed.data;

    // Read and trim Membership column
    const rawMembership = getRowVal(row, 'Membership');
    const trimmedMembership = rawMembership ? String(rawMembership).trim() : '';

    let targetMembershipId = null;
    if (trimmedMembership) {
      const memKey = trimmedMembership.toLowerCase();
      let mem = membershipCache.get(memKey);
      if (!mem) {
        mem = await client.membership.findFirst({
          where: {
            name: {
              equals: trimmedMembership,
              mode: 'insensitive',
            },
          },
        });
        if (!mem) {
          mem = await client.membership.create({
            data: {
              id: crypto.randomUUID(),
              name: trimmedMembership,
            },
          });
        }
        membershipCache.set(memKey, mem);
      }
      targetMembershipId = mem.id;
    }

    // Upsert by externalRef
    const existing = await findByExternalRef(validData.externalRef, client);
    if (existing) {
      // Set membershipId ONLY if currently null (never overwrite manual reassignment)
      if (existing.membershipId === null && targetMembershipId !== null) {
        await client.membershipPlan.update({
          where: { id: existing.id },
          data: { membershipId: targetMembershipId },
        });
      }
      stats.updated += 1;
    } else {
      validData.membershipId = targetMembershipId;
      await upsertByExternalRef({
        externalRef: validData.externalRef,
        data: validData,
        client,
      });
      stats.created += 1;
    }
  }

  return {
    stats,
    renames,
    skippedList,
    warnings,
  };
};

// Executable CLI entrypoint
if (require.main === module) {
  const targetFile = process.argv[2] || process.env.SEED_MEMBERSHIP_FILE;
  runSeed(targetFile)
    .then((result) => {
      process.stdout.write('\n=============================================\n');
      process.stdout.write('       GLOFOX MEMBERSHIP SEED REPORT         \n');
      process.stdout.write('=============================================\n');
      process.stdout.write(`Total Rows Read: ${result.stats.totalRead}\n`);
      process.stdout.write(`Plans Created:   ${result.stats.created}\n`);
      process.stdout.write(`Plans Updated:   ${result.stats.updated}\n`);
      process.stdout.write(`Plans Skipped:   ${result.stats.skipped}\n`);
      process.stdout.write('---------------------------------------------\n');

      if (result.renames.length > 0) {
        process.stdout.write(`\nRenamed Collisions (${result.renames.length}):\n`);
        result.renames.forEach((r) => {
          process.stdout.write(`  Row ${r.row}: "${r.original}" -> "${r.renamed}" (${r.reason})\n`);
        });
      }

      if (result.skippedList.length > 0) {
        process.stdout.write(`\nSkipped Rows (${result.skippedList.length}):\n`);
        result.skippedList.forEach((s) => {
          process.stdout.write(`  Row ${s.row} [${s.planCode}]: "${s.name}" - ${s.reason}\n`);
        });
      }

      process.stdout.write(
        `\nWarnings & Derived Attributes (${result.warnings.length} entries):\n`,
      );
      const singleVisitCandidates = result.warnings.filter(
        (w) => w.type === 'SINGLE_VISIT_CANDIDATE',
      );
      process.stdout.write(
        `\n  Single-visit candidates (1 credit) (${singleVisitCandidates.length}):\n`,
      );
      singleVisitCandidates.forEach((w) =>
        process.stdout.write(`    - Row ${w.row}: "${w.name}" (assigned kind=${w.kind})\n`),
      );

      const derivedBilling = result.warnings.filter((w) => w.type === 'DERIVED_BILLING_CYCLE');
      process.stdout.write(`\n  Derived Billing Cycle Decisions (${derivedBilling.length}):\n`);
      derivedBilling.forEach((w) =>
        process.stdout.write(`    - Row ${w.row} [${w.name}]: ${w.message}\n`),
      );

      const derivedRefill = result.warnings.filter((w) => w.type === 'DERIVED_CREDIT_REFILL');
      process.stdout.write(`\n  Derived Credit Refill Decisions (${derivedRefill.length}):\n`);
      derivedRefill.forEach((w) =>
        process.stdout.write(`    - Row ${w.row} [${w.name}]: ${w.message}\n`),
      );

      return prisma.$disconnect();
    })
    .catch((err) => {
      process.stderr.write(`\nSeed error: ${err.message || err}\n`);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}

module.exports = {
  runSeed,
  GLOFOX_SEED_CONFIG,
  parseDuration,
  parseCreditsIncluded,
  recurringBillingFromDuration,
  deriveKind,
  deriveBillingCycle,
  deriveCreditRefill,
};
