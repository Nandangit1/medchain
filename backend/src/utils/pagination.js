const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPagination = (query) => {
  const page = toPositiveInteger(query.page, 1);
  const requestedLimit = toPositiveInteger(query.limit, DEFAULT_LIMIT);
  const limit = Math.min(requestedLimit, MAX_LIMIT);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const buildPaginationMeta = (totalItems, pagination) => ({
  totalItems,
  totalPages: Math.ceil(totalItems / pagination.limit) || 1,
  currentPage: pagination.page,
  limit: pagination.limit,
  hasNextPage: pagination.page * pagination.limit < totalItems,
  hasPreviousPage: pagination.page > 1,
});

/**
 * Translates a `?sort=` parameter into a Mongoose sort object.
 *
 * The caller supplies an ALLOW-LIST of sortable fields. Passing user input
 * straight into `.sort()` would let a client sort by any indexed field —
 * including ones deliberately hidden from the projection — and order results
 * by data they were never meant to see. An unrecognised field falls back to
 * the default rather than erroring, because a bad sort key is a cosmetic
 * problem, not a reason to fail the request.
 *
 * Syntax: `?sort=createdAt` ascending, `?sort=-createdAt` descending.
 *
 * @param {string|undefined} sortParam
 * @param {string[]} allowedFields
 * @param {object} fallback
 */
const buildSort = (sortParam, allowedFields, fallback = { createdAt: -1 }) => {
  if (!sortParam || typeof sortParam !== "string") {
    return fallback;
  }

  const descending = sortParam.startsWith("-");
  const field = descending ? sortParam.slice(1) : sortParam;

  if (!allowedFields.includes(field)) {
    return fallback;
  }

  return { [field]: descending ? -1 : 1 };
};

module.exports = {
  buildPagination,
  buildPaginationMeta,
  buildSort,
};
