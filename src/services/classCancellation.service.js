const env = require('../config/env');
const logger = require('../config/logger');
const bookingRepo = require('../repositories/classBooking.repository');
const ledgerRepo = require('../repositories/creditLedger.repository');
const notificationRepo = require('../repositories/notification.repository');
const { sendClassCancelled } = require('../infra/mail/notify.service');
const { Messages } = require('../constants/messages');
const { NotificationType, CREDITS_REFUNDED_PER_BOOKING } = require('../constants/notification');

// ==========================================
// Class cancellation side effects (SLAPP 66/111 S11). Scope: ONLY a cancelled class session. Nothing here
// runs for a coach on leave, a replacement coach or a restore (restore re-books nobody and reverses no
// credit).
//
//   INSIDE the cancel transaction : cancelBookingsAndRefund  (bookings -> CANCELLED, one ledger row each)
//   AFTER the commit              : notifyMembersOfCancellation (in-app notifications, then e-mails)
// ==========================================

// Cancels every BOOKED booking of the session (state + cancelledAt together) and appends one +1 credit
// ledger row per booking. Idempotent: the refund insert skips a booking that was already refunded (partial
// unique index), so a repeated call never double-refunds. Returns the client-safe summary plus the internal
// `recipients` (who to notify after the commit; never sent to the client).
const cancelBookingsAndRefund = async ({ sessionId, now = new Date(), client }) => {
  const booked = await bookingRepo.findBookedBySession(sessionId, client);
  if (booked.length === 0) {
    return { booking: null, credit: null, waitlist: null, recipients: [] };
  }

  const cancelledCount = await bookingRepo.cancelBookings(
    booked.map((b) => b.id),
    now,
    client,
  );
  const refundedCount = await ledgerRepo.insertClassCancelledRefunds(booked, client);

  return {
    booking: { cancelledCount },
    credit: {
      refundedCount,
      creditsPerBooking: CREDITS_REFUNDED_PER_BOOKING,
      totalCredits: refundedCount * CREDITS_REFUNDED_PER_BOOKING,
    },
    waitlist: null,
    recipients: booked.map((b) => ({
      bookingId: b.id,
      memberId: b.memberId,
      fullName: b.member.fullName,
      email: b.member.email,
    })),
  };
};

// 'Tue, 1 Dec 2026, 10:00' in the facility timezone.
const formatWhen = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: env.FACILITY_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

const buildNotification = (session, recipient) => {
  const className = session.class?.name ?? 'your class';
  return {
    userId: recipient.memberId,
    type: NotificationType.CLASS_CANCELLED,
    title: Messages.CLASS_CANCELLED_TITLE,
    body: Messages.CLASS_CANCELLED_BODY(
      className,
      formatWhen(session.startAt),
      CREDITS_REFUNDED_PER_BOOKING,
    ),
    data: {
      sessionId: session.id,
      classId: session.classId,
      startAt: session.startAt.toISOString(),
    },
  };
};

// AFTER the commit. Never throws: a failure is logged and the cancel stays cancelled. The in-app
// notifications are one batch insert; the e-mails are sent in the background (one failing mail does not stop
// the others and nobody waits for the SMTP server). Returns the pending mail promise for tests.
const notifyMembersOfCancellation = async ({ session, recipients }) => {
  if (!recipients || recipients.length === 0)
    return { notificationsCreated: 0, emails: Promise.resolve([]) };

  let notificationsCreated = 0;
  try {
    notificationsCreated = await notificationRepo.createNotifications(
      recipients.map((recipient) => buildNotification(session, recipient)),
    );
  } catch (err) {
    logger.error({ err, sessionId: session.id }, 'class cancelled: creating notifications failed');
  }

  const className = session.class?.name ?? 'your class';
  const when = formatWhen(session.startAt);
  const emails = Promise.allSettled(
    recipients.map(async (recipient) => {
      try {
        await sendClassCancelled(
          { email: recipient.email, fullName: recipient.fullName },
          { className, when, credits: CREDITS_REFUNDED_PER_BOOKING },
        );
      } catch (err) {
        logger.error(
          { err, sessionId: session.id, memberId: recipient.memberId },
          'class cancelled: sending the e-mail failed',
        );
      }
    }),
  );
  return { notificationsCreated, emails };
};

module.exports = { cancelBookingsAndRefund, notifyMembersOfCancellation, formatWhen };
