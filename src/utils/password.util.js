const crypto = require('crypto');
const bcrypt = require('bcrypt');
const env = require('../config/env');

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include at least one uppercase letter, one lowercase letter, and one number.';

const UPPERCASE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const DIGIT_CHARS = '0123456789';
const SYMBOL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const ALL_CHARS = UPPERCASE_CHARS + LOWERCASE_CHARS + DIGIT_CHARS + SYMBOL_CHARS;

const getRandomChar = (chars) => chars[crypto.randomInt(0, chars.length)];

const generateTempPassword = (length = 16) => {
  const targetLength = Math.max(12, length);
  const chars = [
    getRandomChar(UPPERCASE_CHARS),
    getRandomChar(LOWERCASE_CHARS),
    getRandomChar(DIGIT_CHARS),
    getRandomChar(SYMBOL_CHARS),
  ];

  for (let i = chars.length; i < targetLength; i += 1) {
    chars.push(getRandomChar(ALL_CHARS));
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join('');
};

const hashPassword = (plainText) => bcrypt.hash(plainText, env.BCRYPT_SALT_ROUNDS);

const comparePassword = (plainText, hash) => bcrypt.compare(plainText, hash);

module.exports = {
  hashPassword,
  comparePassword,
  generateTempPassword,
  PASSWORD_REGEX,
  PASSWORD_POLICY_MESSAGE,
};
