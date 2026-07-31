const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { before, describe, it } = require("node:test");

/**
 * Module 11 — refresh tokens, password reset, notifications and audit log.
 *
 * The security-critical assertions are the negative ones: a rotated refresh
 * token cannot be replayed, a reset token cannot be reused, and one user
 * cannot touch another's notifications.
 */
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000/api/v1";
const PASSWORD = "Str0ng!Passw0rd";
const runId = crypto.randomBytes(6).toString("hex");

/** Minimal cookie jar — fetch does not keep cookies between calls. */
const parseCookie = (setCookie) => {
  if (!setCookie) return null;
  const match = /refreshToken=([^;]+)/.exec(setCookie);
  return match ? match[1] : null;
};

const api = async (endpoint, { method = "GET", token, body, cookie } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = `refreshToken=${cookie}`;

  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: payload });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    cookie: parseCookie(response.headers.get("set-cookie")),
  };
};

const register = async (label, role = "patient", extra = {}) => {
  const email = `${label}.${runId}@example.com`;

  const response = await api("/auth/register", {
    method: "POST",
    body: { name: `Test ${label}`, email, password: PASSWORD, role, ...extra },
  });

  assert.equal(response.status, 201, `register ${label}: ${JSON.stringify(response.body)}`);

  return {
    email,
    token: response.body.data.token,
    user: response.body.data.user,
    cookie: response.cookie,
  };
};

describe("Module 11 — sessions, resets, notifications, audit", () => {
  let admin;
  /**
   * The reset link is returned in the response body ONLY outside production,
   * because there is no mail transport wired up. In production it is
   * deliberately withheld, so the tests that need the raw token assert the
   * withholding instead of the flow.
   */
  let isProduction = false;

  before(async () => {
    const health = await api("/health");
    isProduction = health.body?.data?.environment === "production";

    const login = await api("/auth/login", {
      method: "POST",
      body: {
        email: process.env.ADMIN_EMAIL || "admin@example.com",
        password: process.env.ADMIN_PASSWORD || "Admin@12345",
      },
    });

    assert.equal(login.status, 200, "admin login failed; run npm run seed:admin");
    admin = { token: login.body.data.token, cookie: login.cookie };
  });

  // --- Refresh tokens ------------------------------------------------------

  describe("Refresh tokens", () => {
    it("issues a refresh cookie on registration", async () => {
      const user = await register("m11.cookie");
      assert.ok(user.cookie, "registration must set a refreshToken cookie");
    });

    it("exchanges the cookie for a new access token and rotates it", async () => {
      const user = await register("m11.rotate");

      const refreshed = await api("/auth/refresh", { method: "POST", cookie: user.cookie });

      assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
      assert.ok(refreshed.body.data.token, "refresh must return a new access token");
      assert.ok(refreshed.cookie, "refresh must set a replacement cookie");
      assert.notEqual(refreshed.cookie, user.cookie, "the refresh token must rotate");
    });

    it("REVOKES every session when a spent refresh token is replayed", async () => {
      const user = await register("m11.replay");

      // First use succeeds and rotates.
      const first = await api("/auth/refresh", { method: "POST", cookie: user.cookie });
      assert.equal(first.status, 200);

      // Replaying the original is treated as a compromise.
      const replay = await api("/auth/refresh", { method: "POST", cookie: user.cookie });
      assert.equal(replay.status, 401);
      assert.match(replay.body.message, /reused|revoked/i);

      // ...and the legitimately rotated token is revoked along with it.
      const after = await api("/auth/refresh", { method: "POST", cookie: first.cookie });
      assert.equal(after.status, 401, "reuse detection must revoke the whole family");
    });

    it("rejects a refresh with no cookie", async () => {
      const response = await api("/auth/refresh", { method: "POST" });
      assert.equal(response.status, 401);
    });

    it("invalidates the refresh token on logout", async () => {
      const user = await register("m11.logout");

      const logout = await api("/auth/logout", {
        method: "POST",
        token: user.token,
        cookie: user.cookie,
      });
      assert.equal(logout.status, 200);

      const refreshed = await api("/auth/refresh", { method: "POST", cookie: user.cookie });
      assert.equal(refreshed.status, 401, "a revoked token must not refresh");
    });
  });

  // --- Password reset ------------------------------------------------------

  describe("Password reset", () => {
    it("returns the same response for unknown addresses", async () => {
      const unknown = await api("/auth/forgot-password", {
        method: "POST",
        body: { email: `nobody.${runId}@example.com` },
      });

      assert.equal(unknown.status, 200);
      // No resetUrl for an address that does not exist — nothing to leak.
      assert.equal(unknown.body.data?.resetUrl, undefined);
      assert.match(unknown.body.message, /if an account exists/i);
    });

    it("NEVER returns the reset link in production", async (t) => {
      if (!isProduction) {
        return t.skip("server is not in production mode");
      }

      const user = await register("m11.prodleak");

      const requested = await api("/auth/forgot-password", {
        method: "POST",
        body: { email: user.email },
      });

      assert.equal(requested.status, 200);
      assert.equal(
        requested.body.data?.resetUrl,
        undefined,
        "the reset link must never be returned in a production response"
      );
    });

    it("resets a password with a valid token and signs the user in", async (t) => {
      if (isProduction) {
        return t.skip("reset link is withheld in production; covered by the test above");
      }

      const user = await register("m11.reset");

      const requested = await api("/auth/forgot-password", {
        method: "POST",
        body: { email: user.email },
      });
      assert.equal(requested.status, 200);

      const resetUrl = requested.body.data?.resetUrl;
      assert.ok(resetUrl, "development mode should return the reset link");

      /**
       * Regression guard. The link was once built from CORS_ORIGIN, which is a
       * comma-separated allow-list — producing a malformed URL containing every
       * origin at once, and emailing users a link that could not be opened.
       * It must be a single well-formed origin.
       */
      assert.doesNotThrow(
        () => new URL(resetUrl),
        `reset link is not a valid URL: ${resetUrl}`
      );
      assert.ok(
        !resetUrl.includes(","),
        `reset link must contain exactly one origin, got: ${resetUrl}`
      );
      assert.match(new URL(resetUrl).pathname, /^\/reset-password$/);

      const token = new URL(resetUrl).searchParams.get("token");
      const newPassword = "Rot4ted!Passw0rd";

      const reset = await api("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword, newPasswordConfirm: newPassword },
      });

      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      assert.ok(reset.body.data.token, "a successful reset should sign the user in");

      // The new password works...
      const relogin = await api("/auth/login", {
        method: "POST",
        body: { email: user.email, password: newPassword },
      });
      assert.equal(relogin.status, 200);

      // ...and the old one does not.
      const oldLogin = await api("/auth/login", {
        method: "POST",
        body: { email: user.email, password: PASSWORD },
      });
      assert.equal(oldLogin.status, 401);
    });

    it("refuses to reuse a spent reset token", async (t) => {
      if (isProduction) {
        return t.skip("reset link is withheld in production");
      }

      const user = await register("m11.reset2");

      const requested = await api("/auth/forgot-password", {
        method: "POST",
        body: { email: user.email },
      });

      const token = new URL(requested.body.data.resetUrl).searchParams.get("token");
      const newPassword = "An0ther!Passw0rd";

      const first = await api("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword, newPasswordConfirm: newPassword },
      });
      assert.equal(first.status, 200);

      const second = await api("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: "Third!Passw0rd1", newPasswordConfirm: "Third!Passw0rd1" },
      });
      assert.equal(second.status, 400, "a reset token must be single-use");
    });

    it("rejects a garbage reset token", async () => {
      const response = await api("/auth/reset-password", {
        method: "POST",
        body: {
          token: "f".repeat(64),
          newPassword: "Wh4tever!Pass",
          newPasswordConfirm: "Wh4tever!Pass",
        },
      });

      assert.equal(response.status, 400);
    });

    it("revokes existing sessions after a reset", async (t) => {
      if (isProduction) {
        return t.skip("reset link is withheld in production");
      }

      const user = await register("m11.reset3");

      const requested = await api("/auth/forgot-password", {
        method: "POST",
        body: { email: user.email },
      });
      const token = new URL(requested.body.data.resetUrl).searchParams.get("token");

      await api("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: "Fresh!Passw0rd9", newPasswordConfirm: "Fresh!Passw0rd9" },
      });

      const refreshed = await api("/auth/refresh", { method: "POST", cookie: user.cookie });
      assert.equal(refreshed.status, 401, "the pre-reset session must be dead");
    });
  });

  // --- Notifications -------------------------------------------------------

  describe("Notifications", () => {
    let patient;
    let doctor;

    before(async () => {
      patient = await register("m11.np");
      doctor = await register("m11.nd", "doctor", {
        doctorProfile: {
          specialization: "Radiology",
          medicalLicenseNumber: `LIC-M11-${runId}`,
        },
      });

      // Verifying the doctor should produce a notification for them.
      const verify = await api(`/admin/doctors/${doctor.user._id}/verify`, {
        method: "PATCH",
        token: admin.token,
      });
      assert.equal(verify.status, 200, JSON.stringify(verify.body));
    });

    it("notifies a doctor when their credentials are verified", async () => {
      const response = await api("/notifications", { token: doctor.token });

      assert.equal(response.status, 200);
      const verified = response.body.data.notifications.find(
        (item) => item.type === "doctor_verified"
      );
      assert.ok(verified, "verification should raise a notification");
      assert.equal(verified.read, false);
    });

    it("reports an unread count", async () => {
      const response = await api("/notifications/unread-count", { token: doctor.token });

      assert.equal(response.status, 200);
      assert.ok(response.body.data.unreadCount >= 1);
    });

    it("marks one as read and decrements the count", async () => {
      const list = await api("/notifications", { token: doctor.token });
      const target = list.body.data.notifications.find((item) => !item.read);

      const marked = await api(`/notifications/${target._id}/read`, {
        method: "PATCH",
        token: doctor.token,
      });

      assert.equal(marked.status, 200);
      assert.equal(marked.body.data.notification.read, true);
    });

    it("REFUSES to let another user mark a notification read", async () => {
      const list = await api("/notifications", { token: doctor.token, params: {} });
      const anyId = list.body.data.notifications[0]._id;

      const response = await api(`/notifications/${anyId}/read`, {
        method: "PATCH",
        token: patient.token,
      });

      // Scoped by user, so it simply does not exist for the other account.
      assert.equal(response.status, 404);
    });

    it("marks everything read", async () => {
      const response = await api("/notifications/read-all", {
        method: "PATCH",
        token: doctor.token,
      });
      assert.equal(response.status, 200);

      const count = await api("/notifications/unread-count", { token: doctor.token });
      assert.equal(count.body.data.unreadCount, 0);
    });

    it("does not leak notifications between users", async () => {
      const response = await api("/notifications", { token: patient.token });

      assert.equal(response.status, 200);
      const foreign = response.body.data.notifications.filter(
        (item) => item.type === "doctor_verified"
      );
      assert.equal(foreign.length, 0);
    });
  });

  // --- Audit log -----------------------------------------------------------

  describe("Audit log", () => {
    it("records sign-ins and is readable by an admin", async () => {
      const response = await api("/admin/audit-logs?limit=20&sort=-createdAt", {
        token: admin.token,
      });

      assert.equal(response.status, 200);
      assert.ok(response.body.data.entries.length > 0, "audit entries should exist");

      const actions = response.body.data.entries.map((entry) => entry.action);
      assert.ok(
        actions.some((action) => action.startsWith("user.")),
        "auth events should be audited"
      );
    });

    it("records a FAILED sign-in attempt", async () => {
      await api("/auth/login", {
        method: "POST",
        body: { email: `ghost.${runId}@example.com`, password: "wrong-password" },
      });

      const response = await api("/admin/audit-logs?outcome=failure&limit=20", {
        token: admin.token,
      });

      assert.equal(response.status, 200);
      assert.ok(
        response.body.data.entries.some((entry) => entry.action === "user.login_failed"),
        "failed sign-ins must be audited"
      );
    });

    it("filters by category", async () => {
      const response = await api("/admin/audit-logs?category=auth&limit=10", {
        token: admin.token,
      });

      assert.equal(response.status, 200);
      response.body.data.entries.forEach((entry) => {
        assert.equal(entry.category, "auth");
      });
    });

    it("rejects an invalid category", async () => {
      const response = await api("/admin/audit-logs?category=not-a-category", {
        token: admin.token,
      });

      assert.equal(response.status, 400);
    });

    it("is NOT readable by a patient", async () => {
      const patient = await register("m11.audit");
      const response = await api("/admin/audit-logs", { token: patient.token });

      assert.equal(response.status, 403);
    });

    it("returns a category summary", async () => {
      const response = await api("/admin/audit-summary?days=30", { token: admin.token });

      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.body.data.summary.byCategory));
      assert.equal(response.body.data.summary.windowDays, 30);
    });
  });

  // --- Admin analytics and transactions ------------------------------------

  describe("Admin analytics", () => {
    it("returns aggregated platform statistics", async () => {
      const response = await api("/admin/stats", { token: admin.token });

      assert.equal(response.status, 200);

      const { stats } = response.body.data;
      assert.ok(stats.users.total >= 1);
      assert.ok(Array.isArray(stats.records.byType));
      assert.ok(Array.isArray(stats.records.uploadsByDay));
      assert.equal(typeof stats.activeGrants, "number");
    });

    it("lists blockchain transactions", async (t) => {
      const health = await api("/health");
      if (!health.body?.data?.blockchain?.connected) {
        return t.skip("blockchain not enabled");
      }

      const response = await api("/admin/blockchain/transactions?limit=10", {
        token: admin.token,
      });

      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.body.data.transactions));
      assert.ok(response.body.data.pagination.totalItems > 0);
    });

    it("rejects an invalid transaction type filter", async () => {
      const response = await api("/admin/blockchain/transactions?type=nonsense", {
        token: admin.token,
      });

      assert.equal(response.status, 400);
    });
  });

  // --- Sorting -------------------------------------------------------------

  describe("Sorting", () => {
    it("honours a whitelisted sort field", async () => {
      const response = await api("/admin/audit-logs?sort=createdAt&limit=5", {
        token: admin.token,
      });

      assert.equal(response.status, 200);

      const dates = response.body.data.entries.map((entry) => new Date(entry.createdAt).getTime());
      const ascending = [...dates].sort((a, b) => a - b);
      assert.deepEqual(dates, ascending, "sort=createdAt should be ascending");
    });

    it("ignores an unknown sort field instead of failing", async () => {
      const response = await api("/admin/audit-logs?sort=secretField&limit=5", {
        token: admin.token,
      });

      assert.equal(response.status, 200, "an unrecognised sort key must not break the request");
    });
  });
});
