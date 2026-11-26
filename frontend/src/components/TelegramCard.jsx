import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiExternalLink, FiLink, FiRefreshCw, FiSend, FiSlash } from "react-icons/fi";

import { formatDate } from "./common";
import { telegramApi } from "../services";

/**
 * Connect a Telegram chat so diagnoses, doctor-uploaded reports and visit
 * guidance arrive as messages.
 *
 * Linking is a deep link with a one-time code: the user opens it, presses
 * Start in the bot, and the server ties that chat to this account. No phone
 * number or chat id is ever typed in. While waiting, the status is polled so
 * the card flips to "connected" on its own.
 */
const TelegramCard = ({ role }) => {
  const [status, setStatus] = useState(null);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await telegramApi.status());
    } catch (error) {
      setStatus({ configured: false, error: error.message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a link is open, so the card notices the Start press.
  useEffect(() => {
    if (!link || status?.linked) return undefined;

    const timer = setInterval(async () => {
      const next = await telegramApi.status().catch(() => null);
      if (next?.linked) {
        setStatus(next);
        setLink(null);
        toast.success("Telegram connected.");
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [link, status?.linked]);

  const connect = async () => {
    setBusy(true);
    try {
      const data = await telegramApi.link();
      setLink(data);
      window.open(data.deepLink, "_blank", "noopener");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await telegramApi.unlink();
      await load();
      toast.success("Telegram disconnected.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      await telegramApi.test();
      toast.success("Test message sent. Check Telegram.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const what =
    role === "patient"
      ? "Get your doctor's diagnoses, consultation notes, uploaded reports and guidance as Telegram messages."
      : "Get your account notifications as Telegram messages.";

  return (
    <div className="bts-card p-4 mb-3">
      <h6 className="fw-bold mb-1 d-flex align-items-center gap-2">
        <FiSend style={{ color: "#229ED9" }} /> Telegram
      </h6>
      <p className="small text-muted mb-3">{what}</p>

      {!status && <Spinner size="sm" animation="border" />}

      {status && !status.configured && (
        <div className="alert alert-secondary small mb-0">
          Telegram delivery is not switched on for this site yet. An administrator needs to add a
          bot token on the server.
        </div>
      )}

      {status?.configured && status.linked && (
        <>
          <div className="alert alert-success small mb-3">
            Connected{status.username ? ` as @${status.username}` : ""}
            {status.linkedAt ? ` since ${formatDate(status.linkedAt)}` : ""}.
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button size="sm" variant="outline-primary" onClick={sendTest} disabled={busy}>
              <FiSend className="me-1" /> Send test message
            </Button>
            <Button size="sm" variant="outline-danger" onClick={disconnect} disabled={busy}>
              <FiSlash className="me-1" /> Disconnect
            </Button>
          </div>
        </>
      )}

      {status?.configured && !status.linked && !link && (
        <Button size="sm" onClick={connect} disabled={busy} style={{ background: "#229ED9", border: "none" }}>
          <FiLink className="me-1" /> Connect Telegram
        </Button>
      )}

      {status?.configured && !status.linked && link && (
        <div className="small">
          <ol className="ps-3 mb-3">
            <li>
              Telegram should have opened <strong>@{link.botUsername}</strong>. If it did not,{" "}
              <a href={link.deepLink} target="_blank" rel="noreferrer">
                open it here <FiExternalLink />
              </a>
              .
            </li>
            <li>
              Press <strong>Start</strong> in the chat.
            </li>
            <li>This card updates by itself once you are connected.</li>
          </ol>
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner size="sm" animation="grow" /> Waiting for you to press Start… (the link works
            for 15 minutes)
          </div>
          <Button size="sm" variant="link" className="px-0 mt-2" onClick={connect} disabled={busy}>
            <FiRefreshCw className="me-1" /> Get a new link
          </Button>
        </div>
      )}
    </div>
  );
};

export default TelegramCard;
