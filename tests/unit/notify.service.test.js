const nodemailer = require('nodemailer');
const env = require('../../src/config/env');
const {
  sendStaffInvitation,
  buildStaffInvitationEmail,
  sendPasswordResetOtp,
  buildPasswordResetOtpEmail,
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

    it('escapes the full name in the html body only', () => {
      const fullName = '<script>alert(1)</script>';

      const { text, html } = buildStaffInvitationEmail({
        fullName,
        role: Role.COACH,
        tempPassword: 'SecretP@ssword123!',
      });

      expect(html).not.toContain(fullName);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(text).toContain(fullName);
    });

    it('escapes the temporary password in the html body only', () => {
      const tempPassword = 'a<b>&"c\'D1!';

      const { text, html } = buildStaffInvitationEmail({
        fullName: 'Coach Carter',
        role: Role.COACH,
        tempPassword,
      });

      expect(html).not.toContain(tempPassword);
      expect(html).toContain('a&lt;b&gt;&amp;&quot;c&#39;D1!');
      expect(text).toContain(tempPassword);
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

  describe('buildPasswordResetOtpEmail', () => {
    it('puts the OTP, name and expiry minutes in the body but not in the subject', () => {
      const input = { fullName: 'Jane Doe', otp: '004217' };

      const { subject, text, html } = buildPasswordResetOtpEmail(input);

      expect(subject).not.toContain(input.otp);

      expect(text).toContain(input.fullName);
      expect(text).toContain(input.otp);
      expect(text).toContain(`${env.OTP_EXPIRY_MINUTES} minutes`);

      expect(html).toContain(input.fullName);
      expect(html).toContain(input.otp);
      expect(html).toContain(`${env.OTP_EXPIRY_MINUTES} minutes`);
    });

    it('escapes the full name in the html body only', () => {
      const fullName = '<script>alert(1)</script>';

      const { text, html } = buildPasswordResetOtpEmail({ fullName, otp: '004217' });

      expect(html).not.toContain(fullName);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(text).toContain(fullName);
    });
  });

  describe('sendPasswordResetOtp', () => {
    const user = { email: 'jane@example.com', fullName: 'Jane Doe' };

    it('sends to the user from the configured address with the OTP only in the body', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'msg-456' });

      const result = await sendPasswordResetOtp(user, '004217');

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailOptions = mockSendMail.mock.calls[0][0];

      expect(mailOptions.to).toBe(user.email);
      expect(mailOptions.from).toBe(env.SMTP_FROM);
      expect(mailOptions.subject).not.toContain('004217');
      expect(mailOptions.text).toContain('004217');
      expect(mailOptions.html).toContain('004217');
      expect(result).toEqual({ messageId: 'msg-456' });
    });

    it('propagates transport error when mail sending fails', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP connection timed out'));

      await expect(sendPasswordResetOtp(user, '004217')).rejects.toThrow(
        'SMTP connection timed out',
      );
    });
  });
});
