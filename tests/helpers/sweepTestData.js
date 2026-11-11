// Test users are named test_<label>_...@test.invalid (see testData.helper). A run that is killed
// or stalls never reaches its afterAll cleanup, so jest sweeps leftovers at the start of the next
// run. Only rows older than STALE_AFTER_MS are touched, so a run that is still going is safe.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const TEST_EMAIL = { startsWith: 'test_', endsWith: '@test.invalid' };

// Returns how many users were deleted. Coaches and sessions go with them (cascade).
const sweepStaleTestData = async (prisma, now = new Date()) => {
  const createdBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const where = { email: TEST_EMAIL, createdAt: { lt: createdBefore } };

  // Appointments RESTRICT their member and coach, so a test user's appointments go first.
  await prisma.appointment.deleteMany({
    where: { OR: [{ member: where }, { coach: { user: where } }] },
  });
  // Class bookings and the credit ledger RESTRICT the member; the ledger references the bookings, so it
  // goes first (notifications cascade with the user).
  await prisma.memberCreditTransaction.deleteMany({ where: { member: where } });
  await prisma.classBooking.deleteMany({ where: { member: where } });
  // Cafe orders RESTRICT user deletion, so a test user's orders (and their items, by cascade) go first.
  await prisma.cafeOrder.deleteMany({ where: { createdBy: where } });
  // Audit rows keep the email but lose the user (SET NULL), so they are removed explicitly.
  await prisma.auditLog.deleteMany({ where });
  const { count } = await prisma.user.deleteMany({ where });
  return count;
};

module.exports = { sweepStaleTestData, STALE_AFTER_MS };
