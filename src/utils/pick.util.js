// Copies only the listed keys that `source` owns.
const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]),
  );

module.exports = { pick };
