import apiClient, { unwrap } from "./apiClient";

/**
 * Typed-ish wrappers around the REST API.
 *
 * Every function returns the unwrapped `data` payload, so components deal in
 * domain objects rather than HTTP envelopes.
 */

// --- Auth -------------------------------------------------------------------

export const authApi = {
  register: (payload) => apiClient.post("/auth/register", payload).then(unwrap),
  login: (payload) => apiClient.post("/auth/login", payload).then(unwrap),
  logout: () => apiClient.post("/auth/logout").then(unwrap),
  me: () => apiClient.get("/auth/me").then(unwrap),
  updateMe: (payload) => apiClient.patch("/auth/me", payload).then(unwrap),
  changePassword: (payload) => apiClient.patch("/auth/change-password", payload).then(unwrap),
  forgotPassword: (email) => apiClient.post("/auth/forgot-password", { email }).then(unwrap),
  resetPassword: (payload) => apiClient.post("/auth/reset-password", payload).then(unwrap),

  // Two-factor authentication.
  mfaStatus: () => apiClient.get("/auth/mfa").then(unwrap),
  mfaSetup: () => apiClient.post("/auth/mfa/setup").then(unwrap),
  mfaEnable: (code) => apiClient.post("/auth/mfa/enable", { code }).then(unwrap),
  mfaDisable: (payload) => apiClient.post("/auth/mfa/disable", payload).then(unwrap),
  /** Second leg of sign-in; unauthenticated, carries the challenge token. */
  mfaVerify: (payload) => apiClient.post("/auth/mfa/verify", payload).then(unwrap),
};

// --- Notifications ----------------------------------------------------------

export const notificationApi = {
  list: (params) => apiClient.get("/notifications", { params }).then(unwrap),
  unreadCount: () => apiClient.get("/notifications/unread-count").then(unwrap),
  markRead: (id) => apiClient.patch(`/notifications/${id}/read`).then(unwrap),
  markAllRead: () => apiClient.patch("/notifications/read-all").then(unwrap),
};

// --- Health -----------------------------------------------------------------

export const healthApi = {
  get: () => apiClient.get("/health").then(unwrap),
};

// --- Records ----------------------------------------------------------------

export const recordApi = {
  list: (params) => apiClient.get("/records", { params }).then(unwrap),
  get: (id) => apiClient.get(`/records/${id}`).then(unwrap),
  verify: (id) => apiClient.get(`/records/${id}/verify`).then(unwrap),
  history: (id) => apiClient.get(`/records/${id}/history`).then(unwrap),
  update: (id, payload) => apiClient.patch(`/records/${id}`, payload).then(unwrap),
  remove: (id) => apiClient.delete(`/records/${id}`).then(unwrap),

  upload: (formData, onProgress) =>
    apiClient
      .post("/records", formData, {
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded * 100) / event.total));
          }
        },
      })
      .then(unwrap),

  /** Returns a Blob so the caller can trigger a browser download. */
  download: (id) =>
    apiClient.get(`/records/${id}/download`, { responseType: "blob" }).then((r) => r.data),

  // Sharing
  access: (id) => apiClient.get(`/records/${id}/access`).then(unwrap),
  share: (id, payload) => apiClient.post(`/records/${id}/share`, payload).then(unwrap),
  revoke: (id, doctorId) => apiClient.delete(`/records/${id}/share/${doctorId}`).then(unwrap),
};

// --- Patient ----------------------------------------------------------------

export const patientApi = {
  dashboard: () => apiClient.get("/patients/me/dashboard").then(unwrap),
  grants: (params) => apiClient.get("/patients/me/grants", { params }).then(unwrap),
  wallet: () => apiClient.get("/patients/me/wallet").then(unwrap),
};

// --- Doctor -----------------------------------------------------------------

export const doctorApi = {
  /** Verified doctors, readable by any signed-in user. */
  directory: (params) => apiClient.get("/doctors/directory", { params }).then(unwrap),
  dashboard: () => apiClient.get("/doctors/me/dashboard").then(unwrap),
  patients: () => apiClient.get("/doctors/me/patients").then(unwrap),
  records: (params) => apiClient.get("/doctors/me/records", { params }).then(unwrap),
  diagnoses: (params) => apiClient.get("/doctors/me/diagnoses", { params }).then(unwrap),
  recordDiagnoses: (recordId) =>
    apiClient.get(`/doctors/records/${recordId}/diagnoses`).then(unwrap),
  createDiagnosis: (recordId, payload) =>
    apiClient.post(`/doctors/records/${recordId}/diagnoses`, payload).then(unwrap),
  uploadPrescription: (patientId, formData) =>
    apiClient.post(`/doctors/patients/${patientId}/prescriptions`, formData).then(unwrap),
};

// --- Appointments -----------------------------------------------------------

export const appointmentApi = {
  list: (params) => apiClient.get("/appointments", { params }).then(unwrap),
  get: (id) => apiClient.get(`/appointments/${id}`).then(unwrap),
  request: (payload) => apiClient.post("/appointments", payload).then(unwrap),
  confirm: (id) => apiClient.patch(`/appointments/${id}/confirm`).then(unwrap),
  cancel: (id, reason) => apiClient.patch(`/appointments/${id}/cancel`, { reason }).then(unwrap),
  complete: (id, doctorNotes) =>
    apiClient.patch(`/appointments/${id}/complete`, { doctorNotes }).then(unwrap),
  noShow: (id) => apiClient.patch(`/appointments/${id}/no-show`).then(unwrap),
  join: (id) => apiClient.get(`/appointments/${id}/join`).then(unwrap),
  setRecordingConsent: (id, consent) =>
    apiClient.patch(`/appointments/${id}/recording-consent`, { consent }).then(unwrap),
  endCall: (id) => apiClient.patch(`/appointments/${id}/end-call`).then(unwrap),
};

// --- Admin ------------------------------------------------------------------

export const adminApi = {
  stats: () => apiClient.get("/admin/stats").then(unwrap),
  auditLogs: (params) => apiClient.get("/admin/audit-logs", { params }).then(unwrap),
  auditSummary: (days) => apiClient.get("/admin/audit-summary", { params: { days } }).then(unwrap),
  transactions: (params) =>
    apiClient.get("/admin/blockchain/transactions", { params }).then(unwrap),
  users: (params) => apiClient.get("/admin/users", { params }).then(unwrap),
  user: (id) => apiClient.get(`/admin/users/${id}`).then(unwrap),
  setUserStatus: (id, isActive) =>
    apiClient.patch(`/admin/users/${id}/status`, { isActive }).then(unwrap),
  doctors: (params) => apiClient.get("/admin/doctors", { params }).then(unwrap),
  verifyDoctor: (id) => apiClient.patch(`/admin/doctors/${id}/verify`).then(unwrap),
  rejectDoctor: (id, rejectionReason) =>
    apiClient.patch(`/admin/doctors/${id}/reject`, { rejectionReason }).then(unwrap),
};
