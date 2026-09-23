
import { useState, useEffect } from "react";
import { PulseIndicator } from "./shared";
import { ChangePasswordModal } from "./ChangePasswordModal";
import type { AuthedUser } from "./Login";

// ─── NAVIGATION ────────────────────────────────────────────────────────────
// Navigation keys are kept in sync with the screen keys used by App.tsx.
// Routing is handled by App.tsx's screen state rather than React Router.

export const NAV = [
  { key: "overview", icon: "◈", label: "Overview" },
  { key: "search", icon: "⌕", label: "Intelligence Search" },
  { key: "alerts", icon: "◉", label: "Alerts" },
  { key: "entities", icon: "◫", label: "Threat Actors" },
  { key: "graph", icon: "⬡", label: "Relationship Graph" },
  { key: "listings", icon: "▤", label: "Dark Web Intelligence" },
  { key: "attribution", icon: "◎", label: "Attribution Analysis" },
  { key: "infrastructure", icon: "⌁", label: "Infrastructure Intel" },
  { key: "blockchain", icon: "◇", label: "Wallet Intelligence" },
  { key: "investigations", icon: "◑", label: "Investigations" },
  { key: "evidence", icon: "◳", label: "Evidence" },
  { key: "analytics", icon: "▩", label: "Analytics" },
  { key: "reports", icon: "◫", label: "Reports" },
  { key: "scraper", icon: "🕷", label: "Web Scraper" },
];

const ADMIN_ONLY_NAV = {
  key: "audit",
  icon: "◻",
  label: "Audit Logs",
};

const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  INVESTIGATOR: "Investigator",
  ANALYST: "Analyst",
};

// ─── SIDEBAR ───────────────────────────────────────────────────────────────

export function Sidebar({
  current,
  navigate,
  user,
  isAdmin,
}: {
  current: string;
  navigate: (s: string) => void;
  user?: AuthedUser | null;
  isAdmin?: boolean;
}) {
  const active = (key: string) =>
    key === current ||
    (key === "entities" && current === "entity") ||
    (key === "investigations" &&
      (current === "workspace" || current === "timeline")) ||
    (key === "graph" && current === "network-risk");

  const navItems = isAdmin ? [...NAV, ADMIN_ONLY_NAV] : NAV;

  return (
    <div
      className="sidebar"
      style={{ gridRow: 2 }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "18px 16px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          className="display grad-text"
          style={{
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: "-0.02em",
          }}
        >
          NEXUS
        </div>

        <div
          style={{
            fontSize: 9,
            color: "var(--text-4)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginTop: 2,
          }}
        >
          Threat Actor Intelligence Platform
        </div>
      </div>

      {/* Nav items */}
      <div
        style={{
          flex: 1,
          padding: "8px 8px",
          overflowY: "auto",
        }}
        className="scroll-reveal"
      >
        <div
          style={{
            fontSize: 9,
            color: "var(--text-4)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "6px 12px 4px",
          }}
        >
          Navigation
        </div>

        {navItems.map((n) => (
          <div
            key={n.key}
            className={`nav-item ${active(n.key) ? "active" : ""}`}
            onClick={() => navigate(n.key)}
          >
            <span
              style={{
                fontSize: 13,
                flexShrink: 0,
                opacity: active(n.key) ? 1 : 0.7,
              }}
            >
              {n.icon}
            </span>

            <span
              className="label"
              style={{ fontSize: 12.5 }}
            >
              {n.label}
            </span>
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "10px 8px",
        }}
      >
        {isAdmin && (
          <div
            className={`nav-item ${
              current === "admin" ? "active" : ""
            }`}
            onClick={() => navigate("admin")}
          >
            <span style={{ fontSize: 13 }}>⊞</span>

            <span className="label">
              Admin
            </span>
          </div>
        )}

        <div
          style={{
            margin: "8px 4px 0",
            padding: "9px 12px",
            background: "rgba(99,102,241,0.08)",
            borderRadius: 8,
            border: "1px solid rgba(99,102,241,0.14)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-1)",
            }}
          >
            {user?.name ?? "—"}
          </div>

          <div
            style={{
              fontSize: 10,
              color: "var(--accent-hi)",
              marginTop: 1,
            }}
          >
            {user
              ? ROLE_LABEL[user.role] ?? user.role
              : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TOPBAR ────────────────────────────────────────────────────────────────

export function Topbar({
  navigate,
  user,
  onLogout,
  feedEvents = [],
}: {
  navigate: (s: string, d?: any) => void;
  user?: AuthedUser | null;
  onLogout?: () => void;
  feedEvents?: any[];
}) {
  const [time, setTime] = useState(new Date());
  const [showNotifications, setShowNotifications] =
    useState(false);
  const [showUserMenu, setShowUserMenu] =
    useState(false);
  const [showChangePassword, setShowChangePassword] =
    useState(false);

  useEffect(() => {
    const t = setInterval(
      () => setTime(new Date()),
      1000
    );

    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="topbar"
      style={{ gridColumn: "1/-1" }}
    >
      {/* Logo zone */}
      <div
        style={{
          width: 216,
          flexShrink: 0,
          paddingLeft: 20,
          borderRight: "1px solid var(--border)",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          className="display grad-text"
          style={{
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "-0.02em",
          }}
        >
          NEXUS INTEL
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Clock */}
      <div
        className="mono"
        style={{
          fontSize: 11.5,
          color: "var(--text-3)",
        }}
      >
        {time.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}{" "}
        ·{" "}
        {time.toLocaleTimeString()}
      </div>

      {/* Notifications */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => {
            if (feedEvents.length > 0) {
              setShowNotifications((v) => !v);
            } else {
              navigate("alerts");
            }
          }}
          aria-label="Notifications"
          style={{
            position: "relative",
            cursor: "pointer",
            padding: "4px 6px",
            background: "transparent",
            border: "none",
            color: "var(--text-3)",
            fontSize: 17,
            lineHeight: 1,
          }}
        >
          🔔

          {feedEvents.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--critical)",
                boxShadow:
                  "0 0 6px var(--critical-glow)",
              }}
            />
          )}
        </button>

        {showNotifications && (
          <div
            style={{
              position: "absolute",
              top: 34,
              right: 0,
              width: 340,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow:
                "0 14px 40px rgba(0,0,0,0.35)",
              zIndex: 1000,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "13px 15px",
                borderBottom:
                  "1px solid var(--border)",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--text-1)",
                  }}
                >
                  Notifications
                </div>

                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-4)",
                    marginTop: 2,
                  }}
                >
                  {feedEvents.length} recent event
                  {feedEvents.length === 1
                    ? ""
                    : "s"}
                </div>
              </div>

              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowNotifications(false);
                  navigate("alerts");
                }}
                style={{ fontSize: 10 }}
              >
                View all
              </button>
            </div>

            {/* Notifications */}
            <div
              style={{
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              {feedEvents.length === 0 ? (
                <div
                  style={{
                    padding: "35px 20px",
                    textAlign: "center",
                    color: "var(--text-4)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      marginBottom: 8,
                    }}
                  >
                    🔔
                  </div>

                  <div style={{ fontSize: 11.5 }}>
                    No new notifications
                  </div>
                </div>
              ) : (
                feedEvents
                  .slice(0, 8)
                  .map((evt, i) => (
                    <button
                      key={evt.id ?? i}
                      onClick={() => {
                        setShowNotifications(false);
                        navigate("alerts");
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "11px 14px",
                        background:
                          i === 0
                            ? `${evt.meta.color}08`
                            : "transparent",
                        border: "none",
                        borderBottom:
                          "1px solid var(--border)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {/* Event icon */}
                      <div
                        style={{
                          width: 27,
                          height: 27,
                          borderRadius: 7,
                          flexShrink: 0,
                          background: `${evt.meta.color}18`,
                          border: `1px solid ${evt.meta.color}35`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          color: evt.meta.color,
                        }}
                      >
                        {evt.meta.icon}
                      </div>

                      {/* Event content */}
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: evt.meta.color,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            marginBottom: 3,
                          }}
                        >
                          {evt.meta.label}
                        </div>

                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-2)",
                            lineHeight: 1.4,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {evt.detail ||
                            "New intelligence event detected."}
                        </div>

                        <div
                          className="mono"
                          style={{
                            fontSize: 9.5,
                            color: "var(--text-4)",
                            marginTop: 4,
                          }}
                        >
                          {evt.time}
                        </div>
                      </div>
                    </button>
                  ))
              )}
            </div>

            {/* Footer */}
            {feedEvents.length > 8 && (
              <button
                onClick={() => {
                  setShowNotifications(false);
                  navigate("alerts");
                }}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "none",
                  background: "transparent",
                  color: "var(--accent-hi)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                View all {feedEvents.length} events →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 11px",
          background: "rgba(22,163,74,0.08)",
          border: "1px solid rgba(22,163,74,0.2)",
          borderRadius: 6,
        }}
      >
        <PulseIndicator color="#16a34a" />

        <span
          style={{
            fontSize: 11,
            color: "var(--low-light)",
            fontWeight: 600,
          }}
        >
          Secure
        </span>
      </div>

      {/* Avatar */}
      <div
        style={{
          position: "relative",
          paddingLeft: 4,
        }}
      >
        <button
          onClick={() =>
            setShowUserMenu((v) => !v)
          }
          aria-label="Account"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
            border: "none",
            cursor: "pointer",
          }}
        >
          {initials(user?.name)}
        </button>

        {showUserMenu && (
          <div
            style={{
              position: "absolute",
              top: 38,
              right: 0,
              width: 200,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow:
                "0 14px 40px rgba(0,0,0,0.35)",
              zIndex: 1000,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom:
                  "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "var(--text-1)",
                }}
              >
                {user?.name ?? "—"}
              </div>

              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-4)",
                  marginTop: 2,
                }}
              >
                {user?.email}
              </div>
            </div>

            <button
              onClick={() => {
                setShowUserMenu(false);
                setShowChangePassword(true);
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "none",
                borderBottom:
                  "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-2)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Change Password
            </button>

            <button
              onClick={() => {
                setShowUserMenu(false);
                onLogout?.();
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "none",
                background: "transparent",
                color: "var(--critical-light)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() =>
            setShowChangePassword(false)
          }
        />
      )}
    </div>
  );
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function initials(name?: string): string {
  if (!name) return "?";

  const parts = name.trim().split(/\s+/);

  return (
    (parts[0]?.[0] ?? "") +
    (parts[1]?.[0] ?? "")
  ).toUpperCase() || "?";
}
