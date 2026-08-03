import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Form, Spinner } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowLeft, FiVideo } from "react-icons/fi";

import { PageHeader } from "../components/common";
import useAuth from "../hooks/useAuth";
import { appointmentApi } from "../services";

/**
 * Video consultation.
 *
 * The room name is never derived from the appointment id. The server mints an
 * opaque one and only hands it to the two participants, inside the join window
 * — so this page cannot show a call to anyone who should not be in it, and a
 * guessed URL leads nowhere.
 *
 * Jitsi's bootstrap script is injected on mount rather than bundled: it must be
 * served by the same host that serves the conference, so its origin is decided
 * at runtime by the backend and allow-listed in the CSP.
 */
const loadJitsiScript = (domain) =>
  new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not reach the video service at ${domain}.`));
    document.body.appendChild(script);
  });

const Consultation = () => {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const containerRef = useRef(null);
  const apiRef = useRef(null);

  const [consultation, setConsultation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [consent, setConsent] = useState(false);

  const isDoctor = user?.role === "doctor";

  useEffect(() => {
    let cancelled = false;

    appointmentApi
      .join(appointmentId)
      .then((data) => {
        if (cancelled) return;
        setConsultation(data.consultation);
        setConsent(Boolean(data.consultation.recordingConsent));
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  /**
   * Leaving the page must tear the conference down. Without an explicit
   * dispose the iframe keeps the camera and microphone open after navigation,
   * which is both a privacy problem and the kind of bug users never report —
   * they just stop trusting the app.
   */
  useEffect(
    () => () => {
      apiRef.current?.dispose();
      apiRef.current = null;
    },
    []
  );

  const handleJoin = useCallback(async () => {
    if (!consultation) return;

    try {
      await loadJitsiScript(consultation.domain);

      const api = new window.JitsiMeetExternalAPI(consultation.domain, {
        roomName: consultation.roomId,
        parentNode: containerRef.current,
        width: "100%",
        height: "100%",
        userInfo: { displayName: consultation.displayName, email: consultation.email },
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          disableDeepLinking: true,
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
          TOOLBAR_BUTTONS: [
            "microphone",
            "camera",
            "desktop",
            "chat",
            "raisehand",
            "tileview",
            "hangup",
            "fullscreen",
            "settings",
          ],
        },
      });

      api.addEventListener("readyToClose", async () => {
        // Only the doctor's departure closes the consultation: a patient whose
        // connection drops must be able to come back to the same room.
        if (isDoctor) {
          try {
            await appointmentApi.endCall(appointmentId);
          } catch {
            // The call is over either way; a failed timestamp must not trap
            // the doctor on a dead screen.
          }
        }

        apiRef.current?.dispose();
        apiRef.current = null;
        setJoined(false);
        navigate(isDoctor ? "/doctor/appointments" : "/patient/appointments");
      });

      apiRef.current = api;
      setJoined(true);
    } catch (err) {
      toast.error(err.message);
    }
  }, [appointmentId, consultation, isDoctor, navigate]);

  const handleConsentChange = async (next) => {
    setConsent(next);

    try {
      await appointmentApi.setRecordingConsent(appointmentId, next);
    } catch (err) {
      setConsent(!next);
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Consultation" subtitle="Video appointment" />
        <Alert variant="warning">{error}</Alert>
        <Button variant="outline-secondary" onClick={() => navigate(-1)}>
          <FiArrowLeft className="me-2" />
          Back
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Video consultation"
        subtitle={
          consultation.counterpartName
            ? `With ${consultation.counterpartName}`
            : "Secure appointment"
        }
      />

      {!joined && (
        <Card className="mb-3">
          <Card.Body>
            <h5 className="mb-3">Waiting room</h5>
            <p className="text-muted mb-4">
              Scheduled for {new Date(consultation.scheduledFor).toLocaleString()} ·{" "}
              {consultation.durationMinutes} minutes. Your camera and microphone are not
              switched on until you join.
            </p>

            {/* Only the patient decides; the doctor sees the state read-only. */}
            <Form.Check
              type="switch"
              id="recording-consent"
              className="mb-4"
              label="I consent to this consultation being recorded"
              checked={consent}
              disabled={isDoctor}
              onChange={(event) => handleConsentChange(event.target.checked)}
            />

            <Button onClick={handleJoin}>
              <FiVideo className="me-2" />
              Join consultation
            </Button>
          </Card.Body>
        </Card>
      )}

      <div
        ref={containerRef}
        style={{ height: joined ? "72vh" : 0, borderRadius: 14, overflow: "hidden" }}
      />
    </>
  );
};

export default Consultation;
