const Gender = Object.freeze({
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  NON_BINARY: 'NON_BINARY',
  PREFER_NOT_TO_SAY: 'PREFER_NOT_TO_SAY',
});

const STAFF_DEFAULT_GENDER = Gender.PREFER_NOT_TO_SAY;

module.exports = { Gender, STAFF_DEFAULT_GENDER };
