const nodemailer = require('nodemailer');
const env = require('../../config/env');
const { escapeHtml } = require('../../utils/html.util');

const buildStaffInvitationEmail = ({ fullName, role, tempPassword }) => {
  const subject = 'Your Spirit Level Staff Account';
  const text = [
    `Hello ${fullName},`,
    '',
    `Your staff account has been created with the role of ${role}.`,
    '',
    `Temporary Password: ${tempPassword}`,
    '',
    'You must change your password upon your first login.',
    '',
    'Best regards,',
    'The Spirit Level Team',
  ].join('\n');

  const html = [
    `<p>Hello ${escapeHtml(fullName)},</p>`,
    `<p>Your staff account has been created with the role of <strong>${role}</strong>.</p>`,
    `<p><strong>Temporary Password:</strong> <code>${escapeHtml(tempPassword)}</code></p>`,
    '<p><em>You must change your password upon your first login.</em></p>',
    '<p>Best regards,<br/>The Spirit Level Team</p>',
  ].join('\n');

  return { subject, text, html };
};

const buildPasswordResetOtpEmail = ({ fullName, otp }) => {
  const subject = 'Your Spirit Level Password Reset Code';
  const text = [
    `Hello ${fullName},`,
    '',
    `Your password reset code is: ${otp}`,
    '',
    `This code expires in ${env.OTP_EXPIRY_MINUTES} minutes and can be used only once.`,
    'If you did not request a password reset, you can ignore this email.',
    '',
    'Best regards,',
    'The Spirit Level Team',
  ].join('\n');

  const html = [
    `<p>Hello ${escapeHtml(fullName)},</p>`,
    `<p>Your password reset code is: <strong>${otp}</strong></p>`,
    `<p>This code expires in ${env.OTP_EXPIRY_MINUTES} minutes and can be used only once.</p>`,
    '<p><em>If you did not request a password reset, you can ignore this email.</em></p>',
    '<p>Best regards,<br/>The Spirit Level Team</p>',
  ].join('\n');

  return { subject, text, html };
};

const createTransporter = () =>
  nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

let transporter;
const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

const sendStaffInvitation = async ({ email, fullName, role }, tempPassword) => {
  const { subject, text, html } = buildStaffInvitationEmail({ fullName, role, tempPassword });
  const client = getTransporter();

  return client.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject,
    text,
    html,
  });
};

const sendPasswordResetOtp = async ({ email, fullName }, otp) => {
  const { subject, text, html } = buildPasswordResetOtpEmail({ fullName, otp });
  const client = getTransporter();

  return client.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject,
    text,
    html,
  });
};

module.exports = {
  sendStaffInvitation,
  buildStaffInvitationEmail,
  sendPasswordResetOtp,
  buildPasswordResetOtpEmail,
  getTransporter,
};
