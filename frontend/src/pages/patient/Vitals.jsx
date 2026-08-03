import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Modal, Row } from "react-bootstrap";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "react-toastify";
import { FiActivity, FiPlus } from "react-icons/fi";

import { EmptyState, PageHeader } from "../../components/common";
import { scribeApi } from "../../services";

/**
 * Vitals. Each type carries its own unit and a sensible axis, because a chart
 * that autoscales a resting heart rate against a step count is unreadable.
 */
const VITAL_TYPES = [
  { value: "heart_rate", label: "Heart rate", unit: "bpm", domain: [40, 140] },
  { value: "blood_pressure", label: "Blood pressure", unit: "mmHg", domain: [50, 180] },
  { value: "spo2", label: "Oxygen saturation", unit: "%", domain: [85, 100] },
  { value: "temperature", label: "Temperature", unit: "°C", domain: [35, 41] },
  { value: "respiratory_rate", label: "Respiratory rate", unit: "breaths/min", domain: [8, 30] },
  { value: "blood_glucose", label: "Blood glucose", unit: "mg/dL", domain: [50, 250] },
  { value: "weight", label: "Weight", unit: "kg", domain: ["auto", "auto"] },
  { value: "steps", label: "Steps", unit: "steps", domain: [0, "auto"] },
];

const Vitals = () => {
  const [type, setType] = useState("heart_rate");
  const [vitals, setVitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ value: "", secondaryValue: "", source: "manual" });

  const selected = VITAL_TYPES.find((entry) => entry.value === type);
  const isBloodPressure = type === "blood_pressure";

  const load = useCallback(
    () =>
      scribeApi
        .listVitals({ type, limit: 200 })
        .then((data) => setVitals(data.vitals))
        .catch((error) => toast.error(error.message))
        .finally(() => setLoading(false)),
    [type]
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /** Recharts plots left-to-right, so the newest-first API order is reversed. */
  const series = useMemo(
    () =>
      [...vitals].reverse().map((vital) => ({
        at: new Date(vital.measuredAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        value: vital.value,
        secondary: vital.secondaryValue,
      })),
    [vitals]
  );

  const handleAdd = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      await scribeApi.recordVital({
        type,
        value: Number(form.value),
        secondaryValue: isBloodPressure ? Number(form.secondaryValue) : undefined,
        unit: selected.unit,
        source: form.source,
      });
      setShowAdd(false);
      setForm({ value: "", secondaryValue: "", source: "manual" });
      await load();
      toast.success("Reading recorded.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const latest = vitals[0];

  return (
    <>
      <PageHeader
        title="Vitals"
        subtitle="Readings from your devices or entered by hand"
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <FiPlus className="me-2" />
            Add a reading
          </Button>
        }
      />

      <Row className="g-3 mb-3">
        <Col md={4}>
          <Form.Select value={type} onChange={(event) => setType(event.target.value)}>
            {VITAL_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Form.Select>
        </Col>
        {latest && (
          <Col md="auto" className="d-flex align-items-center">
            <span className="text-muted small">
              Latest:{" "}
              <strong className="text-dark">
                {latest.value}
                {latest.secondaryValue ? `/${latest.secondaryValue}` : ""} {latest.unit}
              </strong>{" "}
              · {new Date(latest.measuredAt).toLocaleString()}
              {latest.source && latest.source !== "manual" ? ` · ${latest.source}` : ""}
            </span>
          </Col>
        )}
      </Row>

      <Card>
        <Card.Body>
          {!loading && series.length === 0 ? (
            <EmptyState
              icon={<FiActivity />}
              title={`No ${selected.label.toLowerCase()} readings`}
              description="Add one by hand, or connect a device that writes to this account."
            />
          ) : (
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="at" tick={{ fontSize: 12 }} />
                  <YAxis domain={selected.domain} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => `${value} ${selected.unit}`} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={isBloodPressure ? "Systolic" : selected.label}
                    stroke="#0f766e"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  {/* Blood pressure is the one reading that needs two lines. */}
                  {isBloodPressure && (
                    <Line
                      type="monotone"
                      dataKey="secondary"
                      name="Diastolic"
                      stroke="#c2410c"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card.Body>
      </Card>

      <Modal show={showAdd} onHide={() => setShowAdd(false)} centered>
        <Form onSubmit={handleAdd}>
          <Modal.Header closeButton>
            <Modal.Title>Add a {selected.label.toLowerCase()} reading</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={isBloodPressure ? 4 : 6}>
                <Form.Label className="small">
                  {isBloodPressure ? "Systolic" : "Value"} ({selected.unit})
                </Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                  required
                  autoFocus
                />
              </Col>
              {isBloodPressure && (
                <Col md={4}>
                  <Form.Label className="small">Diastolic (mmHg)</Form.Label>
                  <Form.Control
                    type="number"
                    step="any"
                    value={form.secondaryValue}
                    onChange={(event) => setForm({ ...form, secondaryValue: event.target.value })}
                    required
                  />
                </Col>
              )}
              <Col md={isBloodPressure ? 4 : 6}>
                <Form.Label className="small">Source</Form.Label>
                <Form.Control
                  value={form.source}
                  onChange={(event) => setForm({ ...form, source: event.target.value })}
                  placeholder="manual"
                />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Record
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default Vitals;
