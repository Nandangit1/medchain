const logger = require("../config/logger");
const { AUDIT_OUTCOMES, categoryOf } = require("../constants/audit");
const AuditLog = require("../models/AuditLog");
const { buildPagination, buildPaginationMeta, buildSort } = require("../utils/pagination");

/**
 * Audit Service.
 *
 * `record` NEVER throws and never awaits its caller's critical path. An audit
 * write failing must not turn a successful upload into a 500 — the action
 * genuinely happened, and losing the log entry is strictly better than losing
 * the operation. Failures are reported to the application logger instead, so
 * a silently broken audit trail is still visible to an operator.
 */
const record = async ({
  action,
  actor,
  targetUser,
  targetRecord,
  description,
  metadata,
  outcome = AUDIT_OUTCOMES.SUCCESS,
  req,
}) => {
  try {
    return await AuditLog.create({
      action,
      category: categoryOf(action),
      outcome,
      actor: actor?._id,
      // Captured as they were at the time; resolving later would rewrite history.
      actorEmail: actor?.email,
      actorRole: actor?.role,
      targetUser: targetUser?._id ?? targetUser,
      targetRecord: targetRecord?._id ?? targetRecord,
      description,
      metadata,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"]?.slice(0, 300),
    });
  } catch (error) {
    logger.error("Failed to write audit entry", { action, reason: error.message });
    return null;
  }
};

const list = async (query) => {
  const pagination = buildPagination(query);
  const sort = buildSort(query.sort, ["createdAt", "action", "category"], { createdAt: -1 });

  const filter = {};

  if (query.action) filter.action = query.action;
  if (query.category) filter.category = query.category;
  if (query.outcome) filter.outcome = query.outcome;
  if (query.actor) filter.actor = query.actor;

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  if (query.search && query.search.trim().length >= 2) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [{ actorEmail: searchRegex }, { description: searchRegex }];
  }

  const [entries, totalItems] = await Promise.all([
    AuditLog.find(filter)
      .populate("actor", "name email role")
      .populate("targetUser", "name email role")
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    entries: entries.map((entry) => entry.toClientObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

/** Counts per category over a window, for the admin analytics panel. */
const summary = async (days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [byCategory, byOutcome, total] = await Promise.all([
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
    ]),
    AuditLog.countDocuments({ createdAt: { $gte: since } }),
  ]);

  return {
    windowDays: days,
    total,
    byCategory: byCategory.map((entry) => ({ category: entry._id, count: entry.count })),
    byOutcome: byOutcome.map((entry) => ({ outcome: entry._id, count: entry.count })),
  };
};

module.exports = { list, record, summary };
