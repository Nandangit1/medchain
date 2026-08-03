import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Loader } from "./components/common";
import DashboardLayout from "./components/layout/DashboardLayout";
import { ROLES } from "./context/AuthContext";
import useAuth from "./hooks/useAuth";
import ProtectedRoute, { homeForRole } from "./routes/ProtectedRoute";

// Public
import Home from "./pages/Home";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ResetPassword from "./pages/auth/ResetPassword";
import NotFound from "./pages/NotFound";

/**
 * Route-level code splitting: the patient, doctor and admin bundles are only
 * fetched by users who can actually reach them.
 */
const PatientDashboard = lazy(() => import("./pages/patient/Dashboard"));
const PatientRecords = lazy(() => import("./pages/patient/Records"));
const RecordDetail = lazy(() => import("./pages/patient/RecordDetail"));
const UploadRecord = lazy(() => import("./pages/patient/UploadRecord"));
const SharedAccess = lazy(() => import("./pages/patient/SharedAccess"));
const PatientAppointments = lazy(() => import("./pages/patient/Appointments"));

const DoctorDashboard = lazy(() => import("./pages/doctor/Dashboard"));
const DoctorPatients = lazy(() => import("./pages/doctor/Patients"));
const DoctorRecords = lazy(() => import("./pages/doctor/Records"));
const DoctorRecordDetail = lazy(() => import("./pages/doctor/RecordDetail"));
const DoctorDiagnoses = lazy(() => import("./pages/doctor/Diagnoses"));
const DoctorAppointments = lazy(() => import("./pages/doctor/Appointments"));

const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminDoctors = lazy(() => import("./pages/admin/Doctors"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminBlockchain = lazy(() => import("./pages/admin/Blockchain"));
const AdminAuditLog = lazy(() => import("./pages/admin/AuditLog"));

const Profile = lazy(() => import("./pages/Profile"));
const Security = lazy(() => import("./pages/Security"));
const Consultation = lazy(() => import("./pages/Consultation"));

/** Sends an already-authenticated visitor to their own dashboard. */
const RedirectHome = () => {
  const { isAuthenticated, role, initialising } = useAuth();

  if (initialising) return <Loader height="100vh" />;

  return isAuthenticated ? <Navigate to={homeForRole(role)} replace /> : <Home />;
};

const App = () => (
  <Suspense fallback={<Loader height="100vh" label="Loading..." />}>
    <Routes>
      {/* Public */}
      <Route path="/" element={<RedirectHome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Patient */}
      <Route
        element={
          <ProtectedRoute allow={[ROLES.PATIENT]}>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/patient" element={<PatientDashboard />} />
        <Route path="/patient/records" element={<PatientRecords />} />
        <Route path="/patient/records/:recordId" element={<RecordDetail />} />
        <Route path="/patient/upload" element={<UploadRecord />} />
        <Route path="/patient/access" element={<SharedAccess />} />
        <Route path="/patient/appointments" element={<PatientAppointments />} />
      </Route>

      {/* Doctor */}
      <Route
        element={
          <ProtectedRoute allow={[ROLES.DOCTOR]}>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/doctor" element={<DoctorDashboard />} />
        <Route path="/doctor/patients" element={<DoctorPatients />} />
        <Route path="/doctor/records" element={<DoctorRecords />} />
        <Route path="/doctor/records/:recordId" element={<DoctorRecordDetail />} />
        <Route path="/doctor/diagnoses" element={<DoctorDiagnoses />} />
        <Route path="/doctor/appointments" element={<DoctorAppointments />} />
      </Route>

      {/* Admin */}
      <Route
        element={
          <ProtectedRoute allow={[ROLES.ADMIN]}>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/doctors" element={<AdminDoctors />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/blockchain" element={<AdminBlockchain />} />
        <Route path="/admin/audit" element={<AdminAuditLog />} />
      </Route>

      {/* Any signed-in role */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/profile" element={<Profile />} />
        <Route path="/security" element={<Security />} />
        {/*
          Not nested under a role: participation decides who may join, and the
          server enforces that both parties are named on the appointment.
        */}
        <Route path="/consultation/:appointmentId" element={<Consultation />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  </Suspense>
);

export default App;
