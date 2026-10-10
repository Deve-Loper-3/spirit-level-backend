const nodemailer = require('nodemailer');
const env = require('../../src/config/env');
const {
  sendStaffInvitation,
  buildStaffInvitationEmail,
} = require('../../src/infra/mail/notify.service');
const { Role } = require('../../src/constants/roles');

jest.mock('nodemailer');

describe('notify.service', () => {
  const mockSendMail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    nodemailer.createTransport.mockReturnValue({
      sendMail: mockSendMail,
    });
  });

  describe('buildStaffInvitationEmail', () => {
    it('generates an email template with account info, role, tempPassword, and password change notice', () => {
      const input = {
        fullName: 'Coach Carter',
        role: Role.COACH,
        tempPassword: 'SecretP@ssword123!',
      };

      const { subject, text, html } = buildStaffInvitationEmail(input);

      expect(typeof subject).toBe('string');
      expect(subject).not.toContain(input.tempPassword);

      expect(text).toContain(input.fullName);
      expect(text).toContain(input.role);
      expect(text).toContain(input.tempPassword);
      expect(text).toMatch(/must change (your )?password/i);

      expect(html).toContain(input.fullName);
      expect(html).toContain(input.role);
      expect(html).toContain(input.tempPassword);
      expect(html).toMatch(/must change (your )?password/i);
    });
  });

  describe('sendStaffInvitation', () => {
    it('sends email with correct recipient, from address, and includes tempPassword only in body', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

      const staff = {
        email: 'carter@example.com',
        fullName: 'Coach Carter',
        role: Role.COACH,
      };
      const tempPassword = 'SecureP@ssword999!';

      const result = await sendStaffInvitation(staff, tempPassword);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          },
        }),
      );

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailOptions = mockSendMail.mock.calls[0][0];

      expect(mailOptions.to).toBe(staff.email);
      expect(mailOptions.from).toBe(env.SMTP_FROM);
      expect(mailOptions.subject).not.toContain(tempPassword);
      expect(mailOptions.text).toContain(tempPassword);
      expect(mailOptions.html).toContain(tempPassword);
      expect(mailOptions.text).toContain(staff.role);
      expect(mailOptions.html).toContain(staff.role);

      expect(result).toEqual({ messageId: 'msg-123' });
    });

    it('propagates transport error when mail sending fails', async () => {
      const transportError = new Error('SMTP connection timed out');
      mockSendMail.mockRejectedValue(transportError);

      const staff = {
        email: 'carter@example.com',
        fullName: 'Coach Carter',
        role: Role.COACH,
      };

      await expect(sendStaffInvitation(staff, 'TempP@ss123!')).rejects.toThrow(
        'SMTP connection timed out',
      );
    });
  });
});
