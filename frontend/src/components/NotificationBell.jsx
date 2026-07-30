import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Dropdown, Spinner } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { FiBell, FiCheck } from "react-icons/fi";

import { formatDate } from "./common";
import { notificationApi } from "../services";

/** Poll interval. Long enough not to hammer the API, short enough to feel live. */
const POLL_MS = 60_000;

const NotificationBell = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Only the count is polled. Fetching the full list every minute would move
   * far more data for a number that is usually zero; the list is loaded when
   * the dropdown actually opens.
   */
  const pollCount = useCallback(async () => {
    try {
      const data = await notificationApi.unreadCount();
      if (mounted.current) setUnread(data.unreadCount);
    } catch {
      // A failed poll is not worth surfacing to the user.
    }
  }, []);

  useEffect(() => {
    pollCount();
    const timer = setInterval(pollCount, POLL_MS);
    return () => clearInterval(timer);
  }, [pollCount]);

  const loadList = useCallback(async () => {
    setLoading(true);

    try {
      const data = await notificationApi.list({ limit: 8 });
      if (mounted.current) {
        setItems(data.notifications);
        setUnread(data.unreadCount);
      }
    } catch {
      // Leave the previous list in place rather than blanking the panel.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const handleToggle = (nextOpen) => {
    setOpen(nextOpen);
    if (nextOpen) loadList();
  };

  const handleClick = async (notification) => {
    setOpen(false);

    if (!notification.read) {
      // Optimistic: the badge should drop immediately, not after a round-trip.
      setUnread((count) => Math.max(0, count - 1));
      notificationApi.markRead(notification._id).catch(() => pollCount());
    }

    if (notification.link) navigate(notification.link);
  };

  const handleMarkAll = async (event) => {
    event.stopPropagation();

    try {
      await notificationApi.markAllRead();
      setUnread(0);
      setItems((current) => current.map((item) => ({ ...item, read: true })));
    } catch {
      pollCount();
    }
  };

  return (
    <Dropdown align="end" show={open} onToggle={handleToggle}>
      <Dropdown.Toggle
        variant="light"
        size="sm"
        className="position-relative"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
      >
        <FiBell />
        {unread > 0 && (
          <Badge
            bg="danger"
            pill
            className="position-absolute"
            style={{ top: -4, right: -4, fontSize: "0.6rem" }}
          >
            {unread > 9 ? "9+" : unread}
          </Badge>
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu style={{ width: 330, maxHeight: 420, overflowY: "auto" }}>
        <div className="d-flex justify-content-between align-items-center px-3 py-2">
          <strong style={{ fontSize: "0.85rem" }}>Notifications</strong>
          {unread > 0 && (
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none"
              style={{ fontSize: "0.75rem" }}
              onClick={handleMarkAll}
            >
              <FiCheck className="me-1" />
              Mark all read
            </button>
          )}
        </div>

        <Dropdown.Divider className="my-1" />

        {loading ? (
          <div className="text-center py-4">
            <Spinner size="sm" style={{ color: "var(--bts-teal)" }} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-muted py-4" style={{ fontSize: "0.8rem" }}>
            Nothing here yet.
          </div>
        ) : (
          items.map((notification) => (
            <button
              type="button"
              key={notification._id}
              onClick={() => handleClick(notification)}
              className="w-100 text-start border-0 px-3 py-2 d-flex gap-2"
              style={{
                background: notification.read ? "transparent" : "var(--bts-surface-2)",
                color: "var(--bts-text)",
                cursor: "pointer",
              }}
            >
              <span
                className="flex-shrink-0 rounded-circle mt-1"
                style={{
                  width: 7,
                  height: 7,
                  background: notification.read ? "transparent" : "var(--bts-teal)",
                }}
              />
              <span className="min-w-0">
                <span className="d-block fw-semibold" style={{ fontSize: "0.8rem" }}>
                  {notification.title}
                </span>
                {notification.message && (
                  <span className="d-block text-muted" style={{ fontSize: "0.75rem" }}>
                    {notification.message}
                  </span>
                )}
                <span className="d-block text-muted" style={{ fontSize: "0.68rem" }}>
                  {formatDate(notification.createdAt, true)}
                </span>
              </span>
            </button>
          ))
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default NotificationBell;
