import { useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowLeft, FiCheckCircle, FiFileText } from "react-icons/fi";

import { PageHeader } from "../../components/common";
import { scribeApi } from "../../services";

const SEVERITIES = ["low", "moderate", "high", "critical"];

/**
 * Ambient scribe — review and sign.
 *
 * The draft is loaded into editable fields on purpose. A read-only draft with
 * an "Accept" button trains a clinician to rubber-stamp; fields they must look
 * at and can change make the review real. Nothing reaches the patient's record
 * until Sign is pressed, and what is stored is whatever is in these fields —
 * not the model's output passed through.
 */
const ConsultationNote = () => {
  const { appointmentId } = useParams();
  const navigate = useNavigate();

  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState({
    summary: "",
    details: "",
    icdCode: "",
    severity: "moderate",
    followUpAt: "",
  });
  const [drafting, setDrafting] = useState(false);
  const [signing, setSigning] = useState(false);

  const handleDraft = async (event) => {
    event.preventDefault();
    setDrafting(true);

    try {
      const data = await scribeApi.draftNote(appointmentId, transcript);
      const d = data.draft;

      setDraft(d);
      setNote({
        summary: d.summary || "",
        details: [d.subjective, d.objective, d.assessment, d.plan].filter(Boolean).join("\n\n"),
        icdCode: d.icdCode || "",
        severity: d.severity && d.severity !== "unspecified" ? d.severity : "moderate",
        followUpAt: d.followUpInDays
          ? new Date(Date.now() + d.followUpInDays * 86400000).toISOString().slice(0, 10)
          : "",
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDrafting(false);
    }
  };

  const handleSign = async (event) => {
    event.preventDefault();
    setSigning(true);

    try {
      await scribeApi.signNote(appointmentId, {
        ...note,
        followUpAt: note.followUpAt || undefined,
        transcriptHash: draft.transcriptHash,
      });
      toast.success("Note signed and added to the patient's record.");
      navigate("/doctor/appointments");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSigning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Consultation note"
        subtitle="Draft from the transcript, then review and sign"
        actions={
          <Button variant="outline-secondary" onClick={() => navigate(-1)}>
            <FiArrowLeft className="me-2" />
            Back
          </Button>
        }
      />

      <Row className="g-3">
        <Col lg={6}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-3">
                <FiFileText className="me-2" />
                Transcript
              </h6>
              <Form onSubmit={handleDraft}>
                <Form.Control
                  as="textarea"
                  rows={16}
                  value={transcript}
                  onChange={(event) => setTranscript(event.target.value)}
                  placeholder={
                    "Doctor: What brings you in today?\nPatient: ...\nDoctor: ..."
                  }
                  style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}
                  required
                />
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <span className="text-muted small">
                    {transcript.length} characters — the transcript is never stored, only its
                    fingerprint.
                  </span>
                  <Button type="submit" disabled={drafting || transcript.trim().length < 20}>
                    {drafting ? <Spinner size="sm" animation="border" /> : "Draft note"}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={6}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start mb-3">
                <h6 className="mb-0">Note for your signature</h6>
                {draft && <Badge bg="warning" text="dark">Unsigned draft</Badge>}
              </div>

              {!draft ? (
                <p className="text-muted small">
                  Paste the consultation transcript and select <strong>Draft note</strong>. The
                  draft appears here as editable fields — nothing is saved to the patient&apos;s
                  record until you sign it.
                </p>
              ) : (
                <Form onSubmit={handleSign}>
                  <Alert variant="light" className="border small py-2">
                    Drafted by the <strong>{draft.driver}</strong> scribe. Everything below is
                    editable and unsaved. You are the author of what you sign.
                  </Alert>

                  <Form.Group className="mb-3">
                    <Form.Label className="small">Summary</Form.Label>
                    <Form.Control
                      value={note.summary}
                      onChange={(event) => setNote({ ...note, summary: event.target.value })}
                      maxLength={300}
                      required
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label className="small">Details (SOAP)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={9}
                      value={note.details}
                      onChange={(event) => setNote({ ...note, details: event.target.value })}
                      maxLength={4000}
                    />
                  </Form.Group>

                  <Row className="g-2 mb-3">
                    <Col md={4}>
                      <Form.Label className="small">ICD-10</Form.Label>
                      <Form.Control
                        value={note.icdCode}
                        onChange={(event) => setNote({ ...note, icdCode: event.target.value })}
                        placeholder="R05"
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Label className="small">Severity</Form.Label>
                      <Form.Select
                        value={note.severity}
                        onChange={(event) => setNote({ ...note, severity: event.target.value })}
                      >
                        {SEVERITIES.map((severity) => (
                          <option key={severity} value={severity}>
                            {severity}
                          </option>
                        ))}
                      </Form.Select>
                    </Col>
                    <Col md={4}>
                      <Form.Label className="small">Follow-up</Form.Label>
                      <Form.Control
                        type="date"
                        value={note.followUpAt}
                        onChange={(event) => setNote({ ...note, followUpAt: event.target.value })}
                      />
                    </Col>
                  </Row>

                  <p className="text-muted" style={{ fontSize: "0.72rem" }}>
                    Transcript fingerprint <code>{draft.transcriptHash.slice(0, 32)}…</code> is
                    stored with the appointment, so this note can be shown to belong to this
                    consultation and no other.
                  </p>

                  <Button type="submit" variant="success" disabled={signing}>
                    <FiCheckCircle className="me-2" />
                    {signing ? "Signing..." : "Sign and add to record"}
                  </Button>
                </Form>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default ConsultationNote;
