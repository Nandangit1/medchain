import { useState } from "react";
import { Button } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiLock, FiSave } from "react-icons/fi";

import { PageHeader, StatusChip, formatDate } from "../components/common";
import useAuth from "../hooks/useAuth";
import { authApi } from "../services";

const Profile = () => {
  const { user, setUser } = useAuth();

  const [profile, setProfile] = useState({
    name: user?.name ?? "",
    phone: user?.phone ?? "",
    gender: user?.gender ?? "",
    dateOfBirth: user?.dateOfBirth ? user.dateOfBirth.slice(0, 10) : "",
  });

  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    newPasswordConfirm: "",
  });

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);

    try {
      // Only send fields with a value; the API rejects empty enum strings.
      const payload = { name: profile.name };
      if (profile.phone) payload.phone = profile.phone;
      if (profile.gender) payload.gender = profile.gender;
      if (profile.dateOfBirth) payload.dateOfBirth = new Date(profile.dateOfBirth).toISOString();

      const data = await authApi.updateMe(payload);
      setUser(data.user);
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();

    if (passwords.newPassword !== passwords.newPasswordConfirm) {
      toast.error("The new passwords do not match.");
      return;
    }

    setSavingPassword(true);

    try {
      await authApi.changePassword(passwords);
      setPasswords({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
      toast.success("Password changed.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account details" />

      <div className="row g-3">
        <div className="col-lg-7">
          <form onSubmit={saveProfile} className="bts-card p-4 mb-3">
            <h6 className="fw-bold mb-3">Personal details</h6>

            <div className="mb-3">
              <label className="form-label small fw-semibold">Full name</label>
              <input
                required
                minLength={2}
                maxLength={80}
                className="form-control"
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
            </div>

            <div className="mb-3">
              <label className="form-label small fw-semibold">Email</label>
              <input className="form-control" value={user?.email ?? ""} disabled />
              <div className="form-text">Email cannot be changed.</div>
            </div>

            <div className="row g-2 mb-4">
              <div className="col-sm-4">
                <label className="form-label small fw-semibold">Phone</label>
                <input
                  maxLength={20}
                  className="form-control"
                  value={profile.phone}
                  onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                />
              </div>
              <div className="col-sm-4">
                <label className="form-label small fw-semibold">Gender</label>
                <select
                  className="form-select"
                  value={profile.gender}
                  onChange={(event) => setProfile({ ...profile, gender: event.target.value })}
                >
                  <option value="">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
              <div className="col-sm-4">
                <label className="form-label small fw-semibold">Date of birth</label>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  className="form-control"
                  value={profile.dateOfBirth}
                  onChange={(event) => setProfile({ ...profile, dateOfBirth: event.target.value })}
                />
              </div>
            </div>

            <Button type="submit" size="sm" disabled={savingProfile}>
              <FiSave className="me-1" />
              {savingProfile ? "Saving..." : "Save changes"}
            </Button>
          </form>

          <form onSubmit={savePassword} className="bts-card p-4">
            <h6 className="fw-bold mb-3">Change password</h6>

            <div className="mb-3">
              <label className="form-label small fw-semibold">Current password</label>
              <input
                required
                type="password"
                autoComplete="current-password"
                className="form-control"
                value={passwords.currentPassword}
                onChange={(event) =>
                  setPasswords({ ...passwords, currentPassword: event.target.value })
                }
              />
            </div>

            <div className="row g-2 mb-3">
              <div className="col-sm-6">
                <label className="form-label small fw-semibold">New password</label>
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  className="form-control"
                  value={passwords.newPassword}
                  onChange={(event) =>
                    setPasswords({ ...passwords, newPassword: event.target.value })
                  }
                />
              </div>
              <div className="col-sm-6">
                <label className="form-label small fw-semibold">Confirm new password</label>
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  className="form-control"
                  value={passwords.newPasswordConfirm}
                  onChange={(event) =>
                    setPasswords({ ...passwords, newPasswordConfirm: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-text mb-3">
              At least 8 characters, with an uppercase letter, a lowercase letter, a number and a
              special character.
            </div>

            <Button type="submit" size="sm" variant="outline-primary" disabled={savingPassword}>
              <FiLock className="me-1" />
              {savingPassword ? "Updating..." : "Change password"}
            </Button>
          </form>
        </div>

        <div className="col-lg-5">
          <div className="bts-card p-4">
            <h6 className="fw-bold mb-3">Account</h6>

            <dl className="row small mb-0">
              <dt className="col-5 text-muted fw-normal">Role</dt>
              <dd className="col-7 text-capitalize">{user?.role}</dd>

              <dt className="col-5 text-muted fw-normal">Member since</dt>
              <dd className="col-7">{formatDate(user?.createdAt)}</dd>

              <dt className="col-5 text-muted fw-normal">Last login</dt>
              <dd className="col-7">{formatDate(user?.lastLoginAt, true)}</dd>

              {user?.role === "doctor" && (
                <>
                  <dt className="col-5 text-muted fw-normal">Verification</dt>
                  <dd className="col-7">
                    <StatusChip status={user?.doctorProfile?.verificationStatus} />
                  </dd>

                  <dt className="col-5 text-muted fw-normal">Specialization</dt>
                  <dd className="col-7">{user?.doctorProfile?.specialization ?? "—"}</dd>

                  <dt className="col-5 text-muted fw-normal">Licence</dt>
                  <dd className="col-7 bts-mono">
                    {user?.doctorProfile?.medicalLicenseNumber ?? "—"}
                  </dd>
                </>
              )}

              {user?.walletAddress && (
                <>
                  <dt className="col-5 text-muted fw-normal">Wallet</dt>
                  <dd className="col-7">
                    <code className="bts-mono text-break">{user.walletAddress}</code>
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </>
  );
};

export default Profile;
