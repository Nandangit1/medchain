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

module.exports = {
  buildPagination,
  buildPaginationMeta,
};
