const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { AccountStatus } = require('../constants/status');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

// Like findAuthById plus the email, for building a new access token on refresh.
const findAuthWithEmailById = (id) =>
  prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true },
  });

const findByEmail = (email) =>
  prisma.user.findUnique({
    where: { email },
  });

const findById = (id) =>
  prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      phone: true,
      status: true,
    },
  });

// Minimal lookup for request authentication: current role and status straight from the DB.
const findAuthById = (id) =>
  prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

const createUser = (data) => prisma.user.create({ data });

// passwordHash is selected on purpose (credential check); callers must map to a public shape.
const findForLogin = (email) =>
  prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      whatsappNumber: true,
      gender: true,
      birthDay: true,
      birthMonth: true,
      profileImageUrl: true,
      role: true,
      status: true,
      createdAt: true,
      passwordHash: true,
    },
  });

// A user deleted between authenticate and this write surfaces as P2025.
const updateProfileImage = async (id, profileImageUrl) => {
  try {
    return await prisma.user.update({
      where: { id },
      data: { profileImageUrl },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        gender: true,
        birthDay: true,
        birthMonth: true,
        profileImageUrl: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw createAppError(AppErrors.USER_NOT_FOUND);
    }
    throw err;
  }
};

const completeRegistrationTx = async ({ userId, contact, now }) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: userId,
          status: AccountStatus.PENDING,
        },
        data: {
          status: AccountStatus.ACTIVE,
          waiverAcceptedAt: now,
          registrationCompletedAt: now,
        },
      });

      if (result.count === 0) {
        throw createAppError(AppErrors.REGISTRATION_ALREADY_COMPLETED);
      }

      await tx.emergencyContact.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          name: contact.name ?? null,
          phone: contact.phone,
          relationship: contact.relationship ?? null,
        },
      });

      return {
        id: userId,
        status: AccountStatus.ACTIVE,
        registrationCompletedAt: now,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw createAppError(AppErrors.REGISTRATION_ALREADY_COMPLETED);
    }
    throw err;
  }
};

module.exports = {
  findByEmail,
  findById,
  findAuthById,
  findAuthWithEmailById,
  createUser,
  findForLogin,
  updateProfileImage,
  completeRegistrationTx,
};
