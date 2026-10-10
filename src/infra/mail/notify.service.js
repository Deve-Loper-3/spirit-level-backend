const nodemailer = require('nodemailer');
const env = require('../../config/env');

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
    `<p>Hello ${fullName},</p>`,
    `<p>Your staff account has been created with the role of <strong>${role}</strong>.</p>`,
    `<p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>`,
    '<p><em>You must change your password upon your first login.</em></p>',
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

module.exports = {
  sendStaffInvitation,
  buildStaffInvitationEmail,
  getTransporter,
};
