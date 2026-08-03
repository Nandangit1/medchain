import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Table } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiCheck, FiCopy, FiPlus, FiShield, FiX } from "react-icons/fi";

import { EmptyState, PageHeader } from "../../components/common";
import { proofApi } from "../../services";

const PREDICATES = [
  { value: "lt", label: "is below" },
  { value: "lte", label: "is at most" },
  { value: "gt", label: "is above" },
  { value: "gte", label: "is at least" },
  { value: "eq", label: "equals" },
];

/**
 * Selective disclosure.
 *
 * A patient commits to a measurement once, then proves statements about it to
 * an insurer or employer without handing over the report it came from. The
 * committed value never leaves this page — only the commitment does.
 */
const Proofs = () => {
  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", label: "", value: "", unit: "", loincCode: "" });
  const [proveFor, setProveFor] = useState(null);
  const [proveForm, setProveForm] = useState({ predicate: "lt", threshold: "", audience: "" });
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    proofApi
      .listAttributes()
      .then((data) => setAttributes(data.attributes))
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      await proofApi.createAttribute({ ...form, value: Number(form.value) });
      setShowAdd(false);
      setForm({ name: "", label: "", value: "", unit: "", loincCode: "" });
      await load();
      toast.success("Commitment created.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleProve = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const data = await proofApi.createProof(proveFor._id, {
        ...proveForm,
        threshold: Number(proveForm.threshold),
      });
      setProof(data.proof);
      setProveFor(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (attribute) => {
    if (!window.confirm(`Withdraw the commitment for "${attribute.label || attribute.name}"?`)) {
      return;
    }

    try {
      await proofApi.deleteAttribute(attribute._id);
      await load();
      toast.success("Commitment withdrawn.");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <>
      <PageHeader
        title="Provable claims"
        subtitle="Prove a fact about your health without sharing the report"
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <FiPlus className="me-2" />
            Add a measurement
          </Button>
        }
      />

      <Alert variant="light" className="border small">
        <FiShield className="me-2" />
        Each measurement is sealed into a <strong>commitment</strong> — a one-way fingerprint
        that binds the value without revealing it. You can later prove a statement about that
        value, and the verifier can check it against the commitment without an account here.
      </Alert>

      <Card>
        <Card.Body className="p-0">
          {!loading && attributes.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<FiShield />}
                title="No provable claims yet"
                description="Add a measurement from one of your reports to prove things about it later."
              />
            </div>
          ) : (
            <Table hover responsive className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>Commitment</th>
                  <th>Recorded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {attributes.map((attribute) => (
                  <tr key={attribute._id}>
                    <td>
                      <div className="fw-semibold small">{attribute.label || attribute.name}</div>
                      <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                        {attribute.unit || "—"}
                        {attribute.loincCode ? ` · LOINC ${attribute.loincCode}` : ""}
                      </div>
                    </td>
                    <td>
                      {/* The value is deliberately absent: the server never returns it. */}
                      <code style={{ fontSize: "0.72rem" }}>
                        {attribute.commitment.slice(0, 20)}…
                      </code>
                    </td>
                    <td className="small text-muted">
                      {new Date(attribute.measuredAt).toLocaleDateString()}
                    </td>
                    <td className="text-end">
                      <Button
                        size="sm"
                        className="me-1"
                        onClick={() => {
                          setProveFor(attribute);
                          setProveForm({ predicate: "lt", threshold: "", audience: "" });
                        }}
                      >
                        Prove something
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => handleDelete(attribute)}
                      >
                        Withdraw
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Add a measurement */}
      <Modal show={showAdd} onHide={() => setShowAdd(false)} centered>
        <Form onSubmit={handleAdd}>
          <Modal.Header closeButton>
            <Modal.Title>Add a measurement</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={6}>
                <Form.Label className="small">Short name</Form.Label>
                <Form.Control
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="hba1c"
                  required
                />
              </Col>
              <Col md={6}>
                <Form.Label className="small">Display label</Form.Label>
                <Form.Control
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                  placeholder="HbA1c"
                />
              </Col>
              <Col md={4}>
                <Form.Label className="small">Value</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                  required
                />
              </Col>
              <Col md={4}>
                <Form.Label className="small">Unit</Form.Label>
                <Form.Control
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  placeholder="%"
                />
              </Col>
              <Col md={4}>
                <Form.Label className="small">LOINC (optional)</Form.Label>
                <Form.Control
                  value={form.loincCode}
                  onChange={(event) => setForm({ ...form, loincCode: event.target.value })}
                  placeholder="4548-4"
                />
              </Col>
            </Row>
            <p className="text-muted small mt-3 mb-0">
              Re-adding the same short name replaces the commitment, so an old figure can never
              still be proved.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Commit
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Build a proof */}
      <Modal show={Boolean(proveFor)} onHide={() => setProveFor(null)} centered>
        <Form onSubmit={handleProve}>
          <Modal.Header closeButton>
            <Modal.Title>Prove a statement</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-2 align-items-end">
              <Col xs={12}>
                <span className="fw-semibold">{proveFor?.label || proveFor?.name}</span>
              </Col>
              <Col md={5}>
                <Form.Label className="small">Claim</Form.Label>
                <Form.Select
                  value={proveForm.predicate}
                  onChange={(event) =>
                    setProveForm({ ...proveForm, predicate: event.target.value })
                  }
                >
                  {PREDICATES.map((predicate) => (
                    <option key={predicate.value} value={predicate.value}>
                      {predicate.label}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label className="small">Threshold</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  value={proveForm.threshold}
                  onChange={(event) =>
                    setProveForm({ ...proveForm, threshold: event.target.value })
                  }
                  required
                />
              </Col>
              <Col md={4}>
                <Form.Label className="small">For whom (optional)</Form.Label>
                <Form.Control
                  value={proveForm.audience}
                  onChange={(event) => setProveForm({ ...proveForm, audience: event.target.value })}
                  placeholder="Acme Insurance"
                />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setProveFor(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Generate proof
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* The generated proof */}
      <Modal show={Boolean(proof)} onHide={() => setProof(null)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {proof?.holds ? (
              <FiCheck className="me-2 text-success" />
            ) : (
              <FiX className="me-2 text-danger" />
            )}
            {proof?.statement}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Badge bg={proof?.holds ? "success" : "danger"} className="mb-3">
            {proof?.holds ? "This statement is true" : "This statement is false"}
          </Badge>

          {/*
            Stated prominently, not buried: until the SNARK circuit is compiled,
            handing over this proof also hands over the measured value.
          */}
          <Alert variant="warning" className="small">
            This proof <strong>reveals the measured value</strong> to whoever you give it to.
            Proving the statement while keeping the value secret requires the zero-knowledge
            circuit, which is written but not yet compiled.
          </Alert>

          <p className="small text-muted mb-1">
            Give the verifier this JSON. They check it at{" "}
            <code>POST /api/v1/proofs/verify</code> — no account needed.
          </p>
          <pre
            className="p-3 rounded small"
            style={{ background: "#f1f5f9", maxHeight: 240, overflow: "auto" }}
          >
            {JSON.stringify(proof, null, 2)}
          </pre>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(proof));
              toast.success("Proof copied.");
            }}
          >
            <FiCopy className="me-2" />
            Copy
          </Button>
          <Button onClick={() => setProof(null)}>Done</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default Proofs;
