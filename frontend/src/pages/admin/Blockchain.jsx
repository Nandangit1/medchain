import { useState } from "react";
import { FiActivity, FiHardDrive, FiLink, FiSearch } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatCard,
  StatusChip,
  formatDate,
  truncateHash,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { adminApi, healthApi } from "../../services";

const TX_TYPE_LABELS = {
  register_patient: "Register patient",
  register_doctor: "Register doctor",
  verify_doctor: "Verify doctor",
  anchor_record: "Anchor record",
  deactivate_record: "Deactivate record",
  grant_access: "Grant access",
  revoke_access: "Revoke access",
  log_access: "Log access",
};

const AdminBlockchain = () => {
  const [filters, setFilters] = useState({ type: "", status: "", search: "", page: 1 });

  const health = useApi(() => healthApi.get(), []);

  const txs = useApi(
    () =>
      adminApi.transactions({
        page: filters.page,
        limit: 15,
        sort: "-createdAt",
        ...(filters.type && { type: filters.type }),
        ...(filters.status && { status: filters.status }),
        ...(filters.search.length >= 2 && { search: filters.search }),
      }),
    [filters]
  );

  const chain = health.data?.blockchain;

  return (
    <>
      <PageHeader
        title="Blockchain"
        subtitle="Every transaction the platform has submitted"
        actions={
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              health.refetch();
              txs.refetch();
            }}
          >
            Refresh
          </button>
        }
      />

      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <StatCard
            label="Chain status"
            value={chain ? (chain.enabled ? (chain.connected ? "Online" : "Offline") : "Disabled") : "—"}
            icon={<FiLink />}
            tone={chain?.connected ? "success" : chain?.enabled ? "danger" : "warning"}
            hint={chain?.chainId ? `Chain ID ${chain.chainId}` : undefined}
          />
        </div>
        <div className="col-md-4">
          <StatCard
            label="Records anchored"
            value={chain?.recordCount ?? "—"}
            icon={<FiActivity />}
            tone="teal"
            hint={chain?.blockNumber ? `Block ${chain.blockNumber}` : undefined}
          />
        </div>
        <div className="col-md-4">
          <StatCard
            label="Storage driver"
            value={health.data?.ipfs?.driver ?? "—"}
            icon={<FiHardDrive />}
            tone="info"
            hint={health.data?.ipfs?.driver === "local" ? "Development mode" : "Pinned to IPFS"}
          />
        </div>
      </div>

      {chain?.enabled && !chain?.connected && (
        <div className="alert alert-danger small">
          Cannot reach the node: {chain.reason}. Records are still stored and encrypted; anchoring
          resumes once the node is back, and <code>npm run backfill:anchors</code> catches up.
        </div>
      )}

      {chain?.contractAddress && (
        <div className="bts-card p-3 mb-3">
          <div className="text-muted small">Contract address</div>
          <code className="bts-mono text-break">{chain.contractAddress}</code>
        </div>
      )}

      <div className="bts-card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-6">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-transparent">
                <FiSearch />
              </span>
              <input
                className="form-control"
                placeholder="Search by transaction hash..."
                value={filters.search}
                onChange={(event) =>
                  setFilters((f) => ({ ...f, search: event.target.value, page: 1 }))
                }
              />
            </div>
          </div>
          <div className="col-md-3">
            <select
              className="form-select form-select-sm"
              value={filters.type}
              onChange={(event) => setFilters((f) => ({ ...f, type: event.target.value, page: 1 }))}
            >
              <option value="">All types</option>
              {Object.entries(TX_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <select
              className="form-select form-select-sm"
              value={filters.status}
              onChange={(event) =>
                setFilters((f) => ({ ...f, status: event.target.value, page: 1 }))
              }
            >
              <option value="">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bts-card p-3">
        {txs.loading ? (
          <SkeletonRows rows={8} />
        ) : txs.error ? (
          <ErrorState message={txs.error} onRetry={txs.refetch} />
        ) : txs.data.transactions.length === 0 ? (
          <EmptyState
            icon={<FiActivity />}
            title="No transactions recorded"
            description={
              chain?.enabled
                ? "Nothing matches those filters."
                : "Anchoring is disabled, so no transactions have been submitted."
            }
          />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Tx hash</th>
                    <th>Block</th>
                    <th>Gas</th>
                    <th>Related</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.data.transactions.map((tx) => (
                    <tr key={tx._id}>
                      <td className="small text-muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(tx.createdAt, true)}
                      </td>
                      <td className="small">{TX_TYPE_LABELS[tx.type] ?? tx.type}</td>
                      <td>
                        <StatusChip status={tx.status} />
                      </td>
                      <td className="bts-mono" style={{ fontSize: "0.72rem" }}>
                        {tx.txHash ? truncateHash(tx.txHash, 12, 8) : "—"}
                        {tx.error && (
                          <div
                            className="text-danger text-truncate"
                            style={{ fontSize: "0.68rem", maxWidth: 220 }}
                            title={tx.error}
                          >
                            {tx.error}
                          </div>
                        )}
                      </td>
                      <td className="small text-muted">{tx.blockNumber ?? "—"}</td>
                      <td className="small text-muted">{tx.gasUsed ?? "—"}</td>
                      <td className="small text-muted">
                        {tx.relatedRecord?.title ?? tx.relatedUser?.name ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {txs.data.pagination.totalPages > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-3">
                <small className="text-muted">
                  Page {txs.data.pagination.currentPage} of {txs.data.pagination.totalPages} ·{" "}
                  {txs.data.pagination.totalItems} transactions
                </small>
                <div className="btn-group btn-group-sm">
                  <button
                    className="btn btn-outline-secondary"
                    disabled={!txs.data.pagination.hasPreviousPage}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    disabled={!txs.data.pagination.hasNextPage}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default AdminBlockchain;
