import { FiActivity, FiDatabase, FiHardDrive, FiLink } from "react-icons/fi";

import {
  ErrorState,
  PageHeader,
  SkeletonCards,
  StatCard,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { healthApi } from "../../services";

/**
 * Operational view of the platform's external dependencies.
 *
 * A per-transaction explorer needs a dedicated admin endpoint over the
 * BlockchainTransaction collection, which is not built yet — this page reports
 * live connectivity rather than pretending to show data it cannot fetch.
 */
const AdminBlockchain = () => {
  const { data, loading, error, refetch } = useApi(() => healthApi.get(), []);

  if (loading) {
    return (
      <>
        <PageHeader title="Blockchain" />
        <SkeletonCards count={3} />
      </>
    );
  }

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const { blockchain, ipfs, database } = data;

  return (
    <>
      <PageHeader
        title="Blockchain &amp; storage"
        subtitle="Live status of the platform's external dependencies"
        actions={
          <button className="btn btn-sm btn-outline-secondary" onClick={refetch}>
            Refresh
          </button>
        }
      />

      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <StatCard
            label="Chain status"
            value={blockchain.enabled ? (blockchain.connected ? "Online" : "Offline") : "Disabled"}
            icon={<FiLink />}
            tone={blockchain.connected ? "success" : blockchain.enabled ? "danger" : "warning"}
            hint={blockchain.chainId ? `Chain ID ${blockchain.chainId}` : undefined}
          />
        </div>
        <div className="col-md-4">
          <StatCard
            label="Records anchored"
            value={blockchain.recordCount ?? "—"}
            icon={<FiActivity />}
            tone="teal"
            hint={blockchain.blockNumber ? `Block ${blockchain.blockNumber}` : undefined}
          />
        </div>
        <div className="col-md-4">
          <StatCard
            label="Storage driver"
            value={ipfs?.driver ?? "—"}
            icon={<FiHardDrive />}
            tone="info"
            hint={ipfs?.driver === "local" ? "Development mode" : "Pinned to IPFS"}
          />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="bts-card p-4 h-100">
            <h6 className="fw-bold mb-3">Contract</h6>

            {blockchain.enabled ? (
              <dl className="row small mb-0">
                <dt className="col-4 text-muted fw-normal">Address</dt>
                <dd className="col-8">
                  <code className="bts-mono text-break">{blockchain.contractAddress ?? "—"}</code>
                </dd>

                <dt className="col-4 text-muted fw-normal">Chain ID</dt>
                <dd className="col-8">{blockchain.chainId ?? "—"}</dd>

                <dt className="col-4 text-muted fw-normal">Block height</dt>
                <dd className="col-8">{blockchain.blockNumber ?? "—"}</dd>

                <dt className="col-4 text-muted fw-normal">Anchored records</dt>
                <dd className="col-8">{blockchain.recordCount ?? "—"}</dd>
              </dl>
            ) : (
              <p className="text-muted small mb-0">
                Anchoring is disabled. Records are still encrypted and stored, and stay at status
                &quot;pending&quot; until a chain is configured and the backfill script is run.
              </p>
            )}

            {blockchain.enabled && !blockchain.connected && (
              <div className="alert alert-danger small mt-3 mb-0">
                Cannot reach the node: {blockchain.reason}
              </div>
            )}
          </div>
        </div>

        <div className="col-lg-6">
          <div className="bts-card p-4 h-100">
            <h6 className="fw-bold mb-3">
              <FiDatabase className="me-1" />
              Services
            </h6>

            {[
              ["Database", database === "connected", database],
              ["IPFS", Boolean(ipfs?.driver), ipfs?.driver ?? "unavailable"],
              [
                "Blockchain",
                blockchain.connected,
                blockchain.enabled ? (blockchain.connected ? "connected" : "unreachable") : "disabled",
              ],
            ].map(([label, healthy, detail]) => (
              <div
                key={label}
                className="d-flex justify-content-between align-items-center py-2 border-bottom"
                style={{ borderColor: "var(--bts-border)" }}
              >
                <span className="small fw-semibold">{label}</span>
                <span className={`bts-chip ${healthy ? "bts-chip-success" : "bts-chip-danger"}`}>
                  {detail}
                </span>
              </div>
            ))}

            <div className="text-muted small mt-3">
              Last checked {formatDate(data.timestamp, true)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminBlockchain;
