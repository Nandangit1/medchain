import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiCheckCircle, FiCopy, FiShield } from "react-icons/fi";

import { PageHeader } from "../components/common";
import { authApi } from "../services";

/**
 * Two-factor authentication settings.
 *
 * Enrolment is deliberately two steps: the secret is issued, then confirmed
 * with a live code. Activating on issue would lock out anyone whose scan
 * silently failed, which is the classic way MFA rollouts generate support
 * tickets.
 */
const Security = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolment, setEnrolment] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState(null);
  const [showDisable, setShowDisable] = useState(false);
  const [disableForm, setDisableForm] = useState({ password: "", code: "" });

  const load = () =>
    authApi
      .mfaStatus()
      .then(setStatus)
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handleStart = async () => {
    setBusy(true);

    try {
      setEnrolment(await authApi.mfaSetup());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const data = await authApi.mfaEnable(code);
      setBackupCodes(data.backupCodes);
      setEnrolment(null);
      setCode("");
      await load();
      toast.success("Two-factor authentication is on.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      await authApi.mfaDisable(disableForm);
      setShowDisable(false);
      setDisableForm({ password: "", code: "" });
      await load();
      toast.success("Two-factor authentication is off.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Security" subtitle="Protect your account with a second factor" />

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start mb-3">
            <div>
              <h5 className="mb-1">
                <FiShield className="me-2" />
                Two-factor authentication
              </h5>
              <p className="text-muted mb-0">
                A 6-digit code from your phone, in addition to your password.
              </p>
            </div>
            <Badge bg={status.enabled ? "success" : "secondary"}>
              {status.enabled ? "On" : "Off"}
            </Badge>
          </div>

          {status.requiredForRole && !status.enabled && (
            <Alert variant="warning">
              Your role handles other people&apos;s medical data, so two-factor
              authentication is strongly recommended
              {status.enforced ? " and required" : ""}.
            </Alert>
          )}

          {status.enabled ? (
            <>
              <p className="mb-2">
                Enabled on {new Date(status.enrolledAt).toLocaleDateString()} ·{" "}
                {status.backupCodesRemaining} backup codes remaining
              </p>
              <Button
                variant="outline-danger"
                disabled={status.enforced && status.requiredForRole}
                onClick={() => setShowDisable(true)}
              >
                Turn off
              </Button>
            </>
          ) : (
            !enrolment && (
              <Button onClick={handleStart} disabled={busy}>
                {busy ? "Preparing..." : "Set up"}
              </Button>
            )
          )}

          {enrolment && (
            <div className="mt-4">
              <p className="fw-semibold mb-2">1. Scan this with your authenticator app</p>
              <img
                src={enrolment.qrDataUrl}
                alt="Authenticator QR code"
                style={{ borderRadius: 10 }}
              />

              <p className="text-muted small mt-2 mb-4">
                Can&apos;t scan? Enter this key manually:{" "}
                <code>{enrolment.manualEntryKey}</code>
              </p>

              <Form onSubmit={handleConfirm}>
                <p className="fw-semibold mb-2">2. Enter the 6-digit code it shows</p>
                <Row className="g-2">
                  <Col xs="auto">
                    <Form.Control
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="000000"
                      inputMode="numeric"
                      maxLength={6}
                      style={{ width: 140, letterSpacing: 4 }}
                      required
                    />
                  </Col>
                  <Col xs="auto">
                    <Button type="submit" disabled={busy || code.length < 6}>
                      Confirm
                    </Button>
                  </Col>
                </Row>
              </Form>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Shown once. There is no way to retrieve these again — only hashes are kept. */}
      <Modal show={Boolean(backupCodes)} onHide={() => setBackupCodes(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <FiCheckCircle className="me-2 text-success" />
            Save your backup codes
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Each code works once, and only if you lose your phone.{" "}
            <strong>They will never be shown again.</strong>
          </p>
          <pre className="p-3 rounded" style={{ background: "#f1f5f9" }}>
            {(backupCodes || []).join("\n")}
          </pre>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText((backupCodes || []).join("\n"));
              toast.success("Copied.");
            }}
          >
            <FiCopy className="me-2" />
            Copy
          </Button>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={() => setBackupCodes(null)}>I have saved them</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showDisable} onHide={() => setShowDisable(false)} centered>
        <Form onSubmit={handleDisable}>
          <Modal.Header closeButton>
            <Modal.Title>Turn off two-factor authentication</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {/* Password AND a code: a hijacked session alone must not be able to
                remove the control that would have stopped it. */}
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={disableForm.password}
                onChange={(event) =>
                  setDisableForm({ ...disableForm, password: event.target.value })
                }
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Authenticator or backup code</Form.Label>
              <Form.Control
                value={disableForm.code}
                onChange={(event) => setDisableForm({ ...disableForm, code: event.target.value })}
                required
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowDisable(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              Turn off
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default Security;
