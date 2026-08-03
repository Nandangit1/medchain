import { useEffect, useState } from "react";
import { Badge, Dropdown } from "react-bootstrap";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FiActivity,
  FiCalendar,
  FiCheckSquare,
  FiCreditCard,
  FiFileText,
  FiGrid,
  FiLock,
  FiLogOut,
  FiMenu,
  FiMoon,
  FiShield,
  FiSun,
  FiTrendingUp,
  FiUpload,
  FiUser,
  FiUserCheck,
  FiUsers,
} from "react-icons/fi";

import NotificationBell from "../NotificationBell";
import { ROLES } from "../../context/AuthContext";
import useAuth from "../../hooks/useAuth";

/** Sidebar entries per role. Keeps navigation and authorisation in step. */
const NAV_BY_ROLE = {
  [ROLES.PATIENT]: [
    { section: "Overview" },
    { to: "/patient", label: "Dashboard", icon: <FiGrid />, end: true },
    { section: "Health records" },
    { to: "/patient/records", label: "My records", icon: <FiFileText /> },
    { to: "/patient/upload", label: "Upload report", icon: <FiUpload /> },
    { to: "/patient/access", label: "Shared access", icon: <FiShield /> },
    { section: "Care" },
    { to: "/patient/appointments", label: "Appointments", icon: <FiCalendar /> },
    { to: "/patient/vitals", label: "Vitals", icon: <FiTrendingUp /> },
    { to: "/patient/proofs", label: "Provable claims", icon: <FiCheckSquare /> },
    { to: "/patient/health-id", label: "Health ID", icon: <FiCreditCard /> },
    { section: "Account" },
    { to: "/profile", label: "Profile", icon: <FiUser /> },
    { to: "/security", label: "Security", icon: <FiLock /> },
  ],
  [ROLES.DOCTOR]: [
    { section: "Overview" },
    { to: "/doctor", label: "Dashboard", icon: <FiGrid />, end: true },
    { section: "Clinical" },
    { to: "/doctor/patients", label: "My patients", icon: <FiUsers /> },
    { to: "/doctor/records", label: "Shared records", icon: <FiFileText /> },
    { to: "/doctor/diagnoses", label: "Diagnoses", icon: <FiActivity /> },
    { section: "Care" },
    { to: "/doctor/appointments", label: "Appointments", icon: <FiCalendar /> },
    { section: "Account" },
    { to: "/profile", label: "Profile", icon: <FiUser /> },
    { to: "/security", label: "Security", icon: <FiLock /> },
  ],
  [ROLES.ADMIN]: [
    { section: "Overview" },
    { to: "/admin", label: "Dashboard", icon: <FiGrid />, end: true },
    { section: "Management" },
    { to: "/admin/doctors", label: "Verify doctors", icon: <FiUserCheck /> },
    { to: "/admin/users", label: "Manage users", icon: <FiUsers /> },
    { section: "Audit" },
    { to: "/admin/audit", label: "Audit log", icon: <FiFileText /> },
    { to: "/admin/blockchain", label: "Blockchain", icon: <FiShield /> },
    { section: "Account" },
    { to: "/profile", label: "Profile", icon: <FiUser /> },
    { to: "/security", label: "Security", icon: <FiLock /> },
  ],
};

const useTheme = () => {
  const [theme, setTheme] = useState(() => localStorage.getItem("bts.theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bts.theme", theme);
  }, [theme]);

  return [theme, () => setTheme((current) => (current === "light" ? "dark" : "light"))];
};

const DashboardLayout = () => {
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const items = NAV_BY_ROLE[role] || [];

  // Awaited so the server revokes the refresh cookie before we navigate away.
  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = (user?.name || "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="bts-shell">
      <aside className={`bts-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="bts-brand">
          <span className="bts-brand-mark">
            <FiShield />
          </span>
          <span>
            MedChain
            <div className="text-muted fw-normal" style={{ fontSize: "0.7rem" }}>
              Secure Telemedicine
            </div>
          </span>
        </div>

        <nav className="bts-nav">
          {items.map((item, index) =>
            item.section ? (
              <div className="bts-nav-label" key={`s-${index}`}>
                {item.section}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `bts-nav-link ${isActive ? "active" : ""}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>

        <div className="p-3 border-top" style={{ borderColor: "var(--bts-border)" }}>
          <div className="text-muted" style={{ fontSize: "0.7rem" }}>
            Signed in as
          </div>
          <div className="fw-semibold text-truncate" style={{ fontSize: "0.85rem" }}>
            {user?.email}
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="bts-backdrop d-lg-none" onClick={() => setSidebarOpen(false)} />}

      <div className="bts-main">
        <header className="bts-topbar">
          <button
            type="button"
            className="btn btn-sm btn-light d-lg-none"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            <FiMenu />
          </button>

          <div className="d-none d-lg-block fw-semibold text-capitalize">{role} portal</div>

          <div className="d-flex align-items-center gap-2">
            {role === ROLES.DOCTOR && user?.doctorProfile?.verificationStatus !== "verified" && (
              <Badge bg="warning" text="dark">
                Awaiting verification
              </Badge>
            )}

            <NotificationBell />

            <button
              type="button"
              className="btn btn-sm btn-light"
              onClick={toggleTheme}
              aria-label="Toggle colour theme"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <FiMoon /> : <FiSun />}
            </button>

            <Dropdown align="end">
              <Dropdown.Toggle variant="light" size="sm" className="d-flex align-items-center gap-2">
                <span className="bts-avatar" style={{ width: 26, height: 26, fontSize: "0.68rem" }}>
                  {initials}
                </span>
                <span className="d-none d-sm-inline">{user?.name}</span>
              </Dropdown.Toggle>

              <Dropdown.Menu>
                <Dropdown.Item onClick={() => navigate("/profile")}>
                  <FiUser className="me-2" />
                  Profile
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item onClick={handleLogout} className="text-danger">
                  <FiLogOut className="me-2" />
                  Sign out
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </header>

        <main className="bts-content bts-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
