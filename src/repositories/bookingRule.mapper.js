const {
  BookingRuleCategory,
  BOOKING_RULE_CATALOGUE,
  BOOKING_RULE_CATEGORY_LABELS,
  DB_TO_API_CATEGORY,
  DB_TO_API_UNIT,
} = require('../constants/bookingRule');

const toRuleResponse = (rule) => ({
  id: rule.id,
  ruleKey: rule.ruleKey,
  category: DB_TO_API_CATEGORY[rule.category],
  name: rule.name,
  value: rule.value,
  unit: rule.unit ? DB_TO_API_UNIT[rule.unit] : null,
  enabled: rule.enabled,
  updatedAt: rule.updatedAt,
});

const catalogueIndex = (ruleKey) => {
  const index = BOOKING_RULE_CATALOGUE.findIndex((entry) => entry.ruleKey === ruleKey);
  return index === -1 ? BOOKING_RULE_CATALOGUE.length : index;
};

// All 8 categories always appear, so clients get one stable shape; a category whose rules were all
// deleted has an empty `rules` list. Rules keep the catalogue order.
const toGroupedResponse = (rules) => {
  const ordered = [...rules].sort((a, b) => catalogueIndex(a.ruleKey) - catalogueIndex(b.ruleKey));
  return {
    categories: Object.values(BookingRuleCategory).map((category) => ({
      category,
      label: BOOKING_RULE_CATEGORY_LABELS[category],
      rules: ordered.map(toRuleResponse).filter((rule) => rule.category === category),
    })),
  };
};

module.exports = { toRuleResponse, toGroupedResponse };
