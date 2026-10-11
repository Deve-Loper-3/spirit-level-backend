const {
  ensureOtpExists,
  ensureNotUsed,
  ensureNotVerified,
  ensureAttemptsLeft,
  ensureNotInvalidated,
  ensureNotExpired,
  ensureVerified,
  ensureResetTokenMatches,
  verifyOtpGuards,
  resetPasswordGuards,
} = require('../../src/services/otp.guards');
const { runGuards } = require('../../src/services/auth.guards');
const { AppErrors } = require('../../src/constants/errors');

const now = new Date('2026-10-11T10:00:00Z');
const future = new Date('2026-10-11T10:10:00Z');
const past = new Date('2026-10-11T09:00:00Z');

// A fresh OTP that passes every guard of the verify chain.
const makeOtp = (overrides = {}) => ({
  attempts: 0,
  expiresAt: future,
  verifiedAt: null,
  usedAt: null,
  invalidatedAt: null,
  resetTokenHash: null,
  ...overrides,
});

const baseCtx = (otpOverrides, ctxOverrides) => ({
  otp: makeOtp(otpOverrides),
  now,
  maxAttempts: 5,
  ...ctxOverrides,
});

const errorOf = (appError) =>
  expect.objectContaining({ statusCode: appError.statusCode, code: appError.code });

describe('otp.guards', () => {
  describe('ensureOtpExists', () => {
    it('passes when an OTP row exists', () => {
      expect(() => ensureOtpExists({ otp: makeOtp() })).not.toThrow();
    });

    it('throws OTP_INVALID (400) when there is no OTP (null or undefined)', () => {
      expect(() => ensureOtpExists({ otp: null })).toThrow(errorOf(AppErrors.OTP_INVALID));
      expect(() => ensureOtpExists({ otp: undefined })).toThrow(errorOf(AppErrors.OTP_INVALID));
    });
  });

  describe('ensureNotUsed', () => {
    it('passes when usedAt is null', () => {
      expect(() => ensureNotUsed(baseCtx())).not.toThrow();
    });

    it('throws OTP_ALREADY_USED (400) when usedAt is set', () => {
      expect(() => ensureNotUsed(baseCtx({ usedAt: past }))).toThrow(
        errorOf(AppErrors.OTP_ALREADY_USED),
      );
    });
  });

  describe('ensureNotVerified', () => {
    it('passes when verifiedAt is null', () => {
      expect(() => ensureNotVerified(baseCtx())).not.toThrow();
    });

    it('throws OTP_ALREADY_USED (400) when the OTP was already verified', () => {
      expect(() => ensureNotVerified(baseCtx({ verifiedAt: past }))).toThrow(
        errorOf(AppErrors.OTP_ALREADY_USED),
      );
    });
  });

  describe('ensureAttemptsLeft', () => {
    it('passes below the limit', () => {
      expect(() => ensureAttemptsLeft(baseCtx({ attempts: 4 }))).not.toThrow();
    });

    it('throws OTP_ATTEMPTS_EXCEEDED (429) at the limit and above it', () => {
      expect(() => ensureAttemptsLeft(baseCtx({ attempts: 5 }))).toThrow(
        errorOf(AppErrors.OTP_ATTEMPTS_EXCEEDED),
      );
      expect(() => ensureAttemptsLeft(baseCtx({ attempts: 9 }))).toThrow(
        errorOf(AppErrors.OTP_ATTEMPTS_EXCEEDED),
      );
    });

    it('uses the maxAttempts passed in the context', () => {
      expect(() => ensureAttemptsLeft(baseCtx({ attempts: 2 }, { maxAttempts: 2 }))).toThrow(
        errorOf(AppErrors.OTP_ATTEMPTS_EXCEEDED),
      );
    });
  });

  describe('ensureNotInvalidated', () => {
    it('passes when invalidatedAt is null', () => {
      expect(() => ensureNotInvalidated(baseCtx())).not.toThrow();
    });

    it('throws OTP_INVALID (400) when invalidatedAt is set', () => {
      expect(() => ensureNotInvalidated(baseCtx({ invalidatedAt: past }))).toThrow(
        errorOf(AppErrors.OTP_INVALID),
      );
    });
  });

  describe('ensureNotExpired', () => {
    it('passes before expiry', () => {
      expect(() => ensureNotExpired(baseCtx({ expiresAt: future }))).not.toThrow();
    });

    it('throws OTP_EXPIRED (400) after expiry and exactly at expiry', () => {
      expect(() => ensureNotExpired(baseCtx({ expiresAt: past }))).toThrow(
        errorOf(AppErrors.OTP_EXPIRED),
      );
      expect(() => ensureNotExpired(baseCtx({ expiresAt: now }))).toThrow(
        errorOf(AppErrors.OTP_EXPIRED),
      );
    });
  });

  describe('ensureVerified', () => {
    it('passes when verifiedAt is set', () => {
      expect(() => ensureVerified(baseCtx({ verifiedAt: past }))).not.toThrow();
    });

    it('throws OTP_INVALID (400) when the OTP was never verified', () => {
      expect(() => ensureVerified(baseCtx())).toThrow(errorOf(AppErrors.OTP_INVALID));
    });
  });

  describe('ensureResetTokenMatches', () => {
    it('passes when the hashes are equal', () => {
      expect(() =>
        ensureResetTokenMatches(baseCtx({ resetTokenHash: 'abc' }, { resetTokenHash: 'abc' })),
      ).not.toThrow();
    });

    it('throws OTP_INVALID (400) when the hashes differ', () => {
      expect(() =>
        ensureResetTokenMatches(baseCtx({ resetTokenHash: 'abc' }, { resetTokenHash: 'xyz' })),
      ).toThrow(errorOf(AppErrors.OTP_INVALID));
    });

    it('throws OTP_INVALID (400) when no token hash is stored', () => {
      expect(() =>
        ensureResetTokenMatches(baseCtx({ resetTokenHash: null }, { resetTokenHash: 'xyz' })),
      ).toThrow(errorOf(AppErrors.OTP_INVALID));
    });
  });

  describe('verifyOtpGuards chain', () => {
    it('passes for a fresh, open, unexpired OTP', () => {
      expect(() => runGuards(verifyOtpGuards, baseCtx())).not.toThrow();
    });

    it('runs the guards in order: exists, used, verified, attempts, invalidated, expired', () => {
      expect(() => runGuards(verifyOtpGuards, { ...baseCtx(), otp: null })).toThrow(
        errorOf(AppErrors.OTP_INVALID),
      );

      const everythingWrong = {
        usedAt: past,
        verifiedAt: past,
        attempts: 5,
        invalidatedAt: past,
        expiresAt: past,
      };
      const expectedOrder = [
        [{}, AppErrors.OTP_ALREADY_USED],
        [{ usedAt: null }, AppErrors.OTP_ALREADY_USED],
        [{ usedAt: null, verifiedAt: null }, AppErrors.OTP_ATTEMPTS_EXCEEDED],
        [{ usedAt: null, verifiedAt: null, attempts: 0 }, AppErrors.OTP_INVALID],
        [
          { usedAt: null, verifiedAt: null, attempts: 0, invalidatedAt: null },
          AppErrors.OTP_EXPIRED,
        ],
      ];

      for (const [fix, expected] of expectedOrder) {
        expect(() => runGuards(verifyOtpGuards, baseCtx({ ...everythingWrong, ...fix }))).toThrow(
          errorOf(expected),
        );
      }
    });

    it('reports an OTP closed after too many attempts as OTP_ATTEMPTS_EXCEEDED, not OTP_INVALID', () => {
      expect(() =>
        runGuards(verifyOtpGuards, baseCtx({ attempts: 5, invalidatedAt: past })),
      ).toThrow(errorOf(AppErrors.OTP_ATTEMPTS_EXCEEDED));
    });
  });

  describe('resetPasswordGuards chain', () => {
    const verifiedOtp = { verifiedAt: past, resetTokenHash: 'abc' };

    it('passes for a verified, open, unexpired OTP with the right token hash', () => {
      expect(() =>
        runGuards(resetPasswordGuards, baseCtx(verifiedOtp, { resetTokenHash: 'abc' })),
      ).not.toThrow();
    });

    it('rejects an OTP that was never verified, even with a matching hash', () => {
      expect(() =>
        runGuards(
          resetPasswordGuards,
          baseCtx({ resetTokenHash: 'abc' }, { resetTokenHash: 'abc' }),
        ),
      ).toThrow(errorOf(AppErrors.OTP_INVALID));
    });

    it('runs the guards in order: exists, used, verified, invalidated, expired, token', () => {
      expect(() => runGuards(resetPasswordGuards, { ...baseCtx(), otp: null })).toThrow(
        errorOf(AppErrors.OTP_INVALID),
      );

      const everythingWrong = { usedAt: past, invalidatedAt: past, expiresAt: past };
      const ctxOf = (otpOverrides) => baseCtx(otpOverrides, { resetTokenHash: 'wrong' });

      expect(() =>
        runGuards(resetPasswordGuards, ctxOf({ ...verifiedOtp, ...everythingWrong })),
      ).toThrow(errorOf(AppErrors.OTP_ALREADY_USED));
      expect(() =>
        runGuards(resetPasswordGuards, ctxOf({ ...everythingWrong, usedAt: null })),
      ).toThrow(errorOf(AppErrors.OTP_INVALID)); // not verified
      expect(() =>
        runGuards(resetPasswordGuards, ctxOf({ ...verifiedOtp, ...everythingWrong, usedAt: null })),
      ).toThrow(errorOf(AppErrors.OTP_INVALID)); // invalidated
      expect(() =>
        runGuards(resetPasswordGuards, ctxOf({ ...verifiedOtp, expiresAt: past })),
      ).toThrow(errorOf(AppErrors.OTP_EXPIRED));
      expect(() => runGuards(resetPasswordGuards, ctxOf(verifiedOtp))).toThrow(
        errorOf(AppErrors.OTP_INVALID),
      ); // wrong token
    });

    it('rejects an OTP that was already used for a reset', () => {
      expect(() =>
        runGuards(
          resetPasswordGuards,
          baseCtx({ ...verifiedOtp, usedAt: past }, { resetTokenHash: 'abc' }),
        ),
      ).toThrow(errorOf(AppErrors.OTP_ALREADY_USED));
    });
  });
});
