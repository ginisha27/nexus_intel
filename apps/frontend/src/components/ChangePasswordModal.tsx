import { useState } from "react";
import { apiPost, ApiError } from "../lib/api";

// Self-service counterpart to the admin-triggered reset in AdminScreen.tsx
// (POST /api/users/:id/reset-password). This one is for a user who still
// knows their current password and just wants to set a new one — e.g.
// after logging in with a temp password from account creation, or as
// routine hygiene. Requires the current password so a session left open
// on a shared machine can't be used to lock the real owner out.
//
// On success, the backend revokes every session for this user (including
// this one) and immediately issues a fresh one — so this device stays
// logged in, but any other copy of this session elsewhere stops working
// the moment the password changes.
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await apiPost("/api/auth/change-password", { currentPassword, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>
              Password updated
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5, marginBottom: 20 }}>
              Your password has been changed. You're still signed in on this device — every other
              session has been signed out.
            </p>
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 16 }}>
              Change Password
            </div>

            <label style={{ display: "block", fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Current Password
            </label>
            <input
              className="input"
              style={{ marginBottom: 14 }}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
            />

            <label style={{ display: "block", fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              New Password
            </label>
            <input
              className="input"
              style={{ marginBottom: 14 }}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />

            <label style={{ display: "block", fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Confirm New Password
            </label>
            <input
              className="input"
              style={{ marginBottom: 8 }}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            {error && (
              <p style={{ fontSize: 11.5, color: "var(--high-light)", marginTop: 6, marginBottom: 6 }}>{error}</p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={submitting}
              >
                {submitting ? "Updating…" : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
