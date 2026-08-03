import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiDownload, FiLink, FiShield, FiTrash2 } from "react-icons/fi";

import { PageHeader } from "../../components/common";
import useAuth from "../../hooks/useAuth";
import { abdmApi } from "../../services";

/**
 * Health ID — ABHA linking and the rights the DPDP Act gives the patient.
 *
 * These belong on one page because they are the same idea from two sides:
 * ABHA is the national identity the records hang off, and the rights below
 * are what the person can demand about them.
 */
const HealthId = () => {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({ abhaNumber: "", abhaAddress: "", otp: "" });
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showErase, setShowErase] = useState(false);
  const [erase, setErase] = useState({ password: "", confirm: "" });

  const abha = user?.abha;

  useEffect(() => {
    abdmApi
      .privacyNotice()
      .then(setNotice)
      .catch(() => setNotice(null));
  }, []);

  const handleRequestOtp = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const data = await abdmApi.requestAbhaOtp(form.abhaNumber);
      setOtpSent(true);
      toast.info(`An OTP was sent to ${data.sentTo}.`);

      // The offline driver logs the OTP rather than sending it; say so plainly
      // instead of leaving the user waiting for an SMS that will never arrive.
      if (data.driver === "mock") {
        toast.warn("Offline mode: the OTP is in the server log, not your phone.");
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLink = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      await abdmApi.linkAbha(form);
      await refreshUser();
      setOtpSent(false);
      setForm({ abhaNumber: "", abhaAddress: "", otp: "" });
      toast.success("ABHA linked.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    try {
      await abdmApi.unlinkAbha();
      await refreshUser();
      toast.success("ABHA unlinked.");
    } catch (error) {
      toast.error(error.message);
    }
  };

  /** Downloads the FHIR bundle as a file — this is the DPDP right to access. */
  const handleExport = async () => {
    try {
      const bundle = await abdmApi.exportMyData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `medchain-export-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${bundle.total} records as FHIR R4.`);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleErase = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const result = await abdmApi.eraseMyData(erase);
      setShowErase(false);
      toast.success(`${result.recordsWithdrawn} records withdrawn.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Health ID" subtitle="Your national health account and your data rights" />

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start mb-3">
            <div>
              <h5 className="mb-1">
                <FiLink className="me-2" />
                ABHA — Ayushman Bharat Health Account
              </h5>
              <p className="text-muted mb-0">
                India&apos;s national health ID. Linking it lets your records travel with you
                between hospitals that support ABDM.
              </p>
            </div>
            <Badge bg={abha?.number ? "success" : "secondary"}>
              {abha?.number ? "Linked" : "Not linked"}
            </Badge>
          </div>

          {abha?.number ? (
            <>
              <p className="mb-1">
                <strong>{abha.number}</strong>
                {abha.address ? ` · ${abha.address}` : ""}
              </p>
              {/* An unverified link is shown as such — never implied to be real. */}
              {!abha.verified && (
                <Alert variant="warning" className="mt-3 mb-3 py-2 small">
                  This link has not been verified against the National Health Authority. It was
                  recorded offline, so treat it as provisional.
                </Alert>
              )}
              <Button variant="outline-danger" size="sm" onClick={handleUnlink}>
                Unlink
              </Button>
            </>
          ) : (
            <Form onSubmit={otpSent ? handleLink : handleRequestOtp}>
              <Row className="g-2 align-items-end">
                <Col md={4}>
                  <Form.Label className="small">ABHA number</Form.Label>
                  <Form.Control
                    value={form.abhaNumber}
                    onChange={(event) => setForm({ ...form, abhaNumber: event.target.value })}
                    placeholder="12-3456-7890-1234"
                    disabled={otpSent}
                    required
                  />
                </Col>
                <Col md={4}>
                  <Form.Label className="small">ABHA address (optional)</Form.Label>
                  <Form.Control
                    value={form.abhaAddress}
                    onChange={(event) => setForm({ ...form, abhaAddress: event.target.value })}
                    placeholder="yourname@abdm"
                    disabled={otpSent}
                  />
                </Col>
                {otpSent && (
                  <Col md={2}>
                    <Form.Label className="small">OTP</Form.Label>
                    <Form.Control
                      value={form.otp}
                      onChange={(event) => setForm({ ...form, otp: event.target.value })}
                      placeholder="000000"
                      inputMode="numeric"
                      maxLength={6}
                      required
                    />
                  </Col>
                )}
                <Col md="auto">
                  <Button type="submit" disabled={busy}>
                    {otpSent ? "Link" : "Send OTP"}
                  </Button>
                </Col>
              </Row>
            </Form>
          )}
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body>
          <h5 className="mb-1">
            <FiShield className="me-2" />
            Your data rights
          </h5>
          <p className="text-muted">
            Under India&apos;s Digital Personal Data Protection Act, these are yours to exercise
            at any time.
          </p>

          <div className="d-flex gap-2 flex-wrap">
            <Button variant="outline-primary" onClick={handleExport}>
              <FiDownload className="me-2" />
              Export everything (FHIR R4)
            </Button>
            <Button variant="outline-danger" onClick={() => setShowErase(true)}>
              <FiTrash2 className="me-2" />
              Erase my data
            </Button>
          </div>

          {notice && (
            <div className="mt-4">
              <p className="fw-semibold mb-2 small">What we hold, and why</p>
              <ul className="small text-muted mb-2">
                {notice.purposes.map((purpose) => (
                  <li key={purpose}>{purpose}</li>
                ))}
              </ul>
              <p className="fw-semibold mb-2 small">What erasure cannot remove</p>
              <ul className="small text-muted mb-0">
                {notice.retention.slice(1).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </Card.Body>
      </Card>

      <Modal show={showErase} onHide={() => setShowErase(false)} centered>
        <Form onSubmit={handleErase}>
          <Modal.Header closeButton>
            <Modal.Title>Erase my data</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Alert variant="danger" className="small">
              Your records will be withdrawn and your account deactivated. Two things
              necessarily survive: the audit trail of who accessed your records, which no longer
              identifies you, and the on-chain hashes, which nobody can delete and which reveal
              nothing about the documents.
            </Alert>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={erase.password}
                onChange={(event) => setErase({ ...erase, password: event.target.value })}
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>
                Type <code>ERASE</code> to confirm
              </Form.Label>
              <Form.Control
                value={erase.confirm}
                onChange={(event) => setErase({ ...erase, confirm: event.target.value })}
                required
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowErase(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={busy || erase.confirm !== "ERASE"}>
              {busy ? <Spinner size="sm" animation="border" /> : "Erase"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default HealthId;
