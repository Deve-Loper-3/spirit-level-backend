const CafeItemAvailability = Object.freeze({
  AVAILABLE: 'available',
  SOLD_OUT: 'sold_out',
});

const CafeItemVisibility = Object.freeze({
  PUBLIC: 'public',
  STAFF_ONLY: 'staff_only',
});

const DbCafeItemAvailability = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  SOLD_OUT: 'SOLD_OUT',
});

const DbCafeItemVisibility = Object.freeze({
  PUBLIC: 'PUBLIC',
  STAFF_ONLY: 'STAFF_ONLY',
});

// Mapping helpers between API lowercase and DB uppercase
const API_TO_DB_AVAILABILITY = Object.freeze({
  [CafeItemAvailability.AVAILABLE]: DbCafeItemAvailability.AVAILABLE,
  [CafeItemAvailability.SOLD_OUT]: DbCafeItemAvailability.SOLD_OUT,
});

const DB_TO_API_AVAILABILITY = Object.freeze({
  [DbCafeItemAvailability.AVAILABLE]: CafeItemAvailability.AVAILABLE,
  [DbCafeItemAvailability.SOLD_OUT]: CafeItemAvailability.SOLD_OUT,
});

const API_TO_DB_VISIBILITY = Object.freeze({
  [CafeItemVisibility.PUBLIC]: DbCafeItemVisibility.PUBLIC,
  [CafeItemVisibility.STAFF_ONLY]: DbCafeItemVisibility.STAFF_ONLY,
});

const DB_TO_API_VISIBILITY = Object.freeze({
  [DbCafeItemVisibility.PUBLIC]: CafeItemVisibility.PUBLIC,
  [DbCafeItemVisibility.STAFF_ONLY]: CafeItemVisibility.STAFF_ONLY,
});

const CATEGORY_NAME_MIN_LENGTH = 1;
const CATEGORY_NAME_MAX_LENGTH = 80;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 1000;

const ITEM_NAME_MIN_LENGTH = 1;
const ITEM_NAME_MAX_LENGTH = 120;
const ITEM_DESCRIPTION_MAX_LENGTH = 1000;
const SEARCH_MAX_LENGTH = 100;

const ITEM_PRICE_MIN = 0.01;
const ITEM_PRICE_MAX = 100000;
const ITEM_STOCK_MIN = 0;
const ITEM_STOCK_MAX = 100000;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const CAFE_IMAGE_FOLDER = 'cafe-items';

module.exports = Object.freeze({
  CafeItemAvailability,
  CafeItemVisibility,
  DbCafeItemAvailability,
  DbCafeItemVisibility,
  API_TO_DB_AVAILABILITY,
  DB_TO_API_AVAILABILITY,
  API_TO_DB_VISIBILITY,
  DB_TO_API_VISIBILITY,
  CAFE_IMAGE_FOLDER,
  CATEGORY_NAME_MIN_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  ITEM_NAME_MIN_LENGTH,
  ITEM_NAME_MAX_LENGTH,
  ITEM_DESCRIPTION_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  ITEM_PRICE_MIN,
  ITEM_PRICE_MAX,
  ITEM_STOCK_MIN,
  ITEM_STOCK_MAX,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
});

