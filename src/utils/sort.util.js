// Turns "price" / "-price" into { field, direction }. Returns null when the field is not allowed,
// so the caller decides how to report it.
const parseSort = (raw, allowedFields, fallback) => {
  const value = raw || fallback;
  const descending = value.startsWith('-');
  const field = descending ? value.slice(1) : value;
  if (!allowedFields.includes(field)) return null;
  return { field, direction: descending ? 'desc' : 'asc' };
};

module.exports = { parseSort };
