
import { useState, useCallback, useEffect } from "react";
import { entities } from "./data";

import { LoginScreen, type AuthedUser } from "./components/Login";
import { Sidebar, Topbar } from "./components/Layout";
import { apiGet, apiPost, setUnauthorizedHandler } from "./lib/api";

import { OverviewScreen } from "./screens/OverviewScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { EntityScreen } from "./screens/EntityScreen";
import { GraphScreen } from "./screens/GraphScreen";
import { NetworkRiskScreen } from "./screens/NetworkRiskScreen";
import { AlertsScreen } from "./screens/AlertsScreen";
import { EntitiesScreen } from "./screens/EntitiesScreen";
import { ListingsScreen } from "./screens/ListingsScreen";
import { BlockchainScreen } from "./screens/BlockchainScreen";
import { InvestigationsScreen } from "./screens/InvestigationsScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { TimelineScreen } from "./screens/TimelineScreen";
import { EvidenceScreen } from "./screens/EvidenceScreen";
import { AnalyticsScreen } from "./screens/AnalyticsScreen";
import { ReportsScreen } from "./screens/ReportsScreen";
import { AuditScreen } from "./screens/AuditScreen";
import { AdminScreen } from "./screens/AdminScreen";
import { ScraperScreen } from "./screens/ScraperScreen";
import { AttributionScreen } from "./screens/AttributionScreen";
import { InfrastructureScreen } from "./screens/InfrastructureScreen";

// ─── ROOT APP ─────────────────────────────────────────────────────────────
// This file is now just routing + top-level auth state. Every screen lives
// in its own file under ./screens.

export default function App() {
  // `user` is the actual source of truth for auth state.
  // null means "not logged in", while a user object means "logged in".
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [screen, setScreen] = useState("overview");
  const [entityData, setEntityData] = useState(entities[0]);

  const [workspaceDisplayId, setWorkspaceDisplayId] =
    useState<string | null>(null);

  const [networkDisplayId, setNetworkDisplayId] =
    useState<string | null>(null);

  const [graphInvestigationId, setGraphInvestigationId] =
    useState<string | null>(null);

  const [selectedEvidenceId, setSelectedEvidenceId] =
    useState<string | null>(null);

  const [autoOpenNewInvestigation, setAutoOpenNewInvestigation] =
    useState(false);

  // On mount / hard refresh, ask the backend whether a valid
  // authentication session already exists.
  useEffect(() => {
    apiGet<{ user: AuthedUser }>("/api/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  // Any API 401 means the session is no longer valid.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  const navigate = useCallback((s: string, data?: any) => {
    if (s === "entity" && data) {
      setEntityData(data);
    }

    if (s === "workspace" && data) {
      const displayId =
        typeof data === "string"
          ? data
          : data.displayId ?? data.id;

      if (displayId) {
        setWorkspaceDisplayId(displayId);
      }
    }

    if (s === "evidence" && data?.selectedId) {
      setSelectedEvidenceId(data.selectedId);
    } else if (s !== "evidence") {
      // Reset selection when navigating away from evidence.
      setSelectedEvidenceId(null);
    }

    if (s === "graph") {
      // No data -> global graph.
      // String -> investigation/display ID.
      // Object -> use investigationId when provided.
      const investigationId = data
        ? typeof data === "string"
          ? data
          : data.investigationId ?? null
        : null;

      setGraphInvestigationId(investigationId);
    }

    if (s === "investigations") {
      // Only auto-open the "New Investigation" modal when explicitly
      // requested, e.g. from Overview's "+ New Investigation" button.
      setAutoOpenNewInvestigation(!!data?.openNew);
    }

    if (s === "network-risk" && data) {
      const displayId =
        typeof data === "string"
          ? data
          : data.displayId ?? data.id;

      if (displayId) {
        setNetworkDisplayId(displayId);
      }
    }

    setScreen(s);

    setTimeout(() => {
      document.querySelector(".main")?.scrollTo(0, 0);
    }, 0);
  }, []);

  // While the initial session check is in progress, render nothing.
  // This prevents the login screen from flashing during refresh.
  if (checkingSession) return null;

  // No authenticated user -> show login.
  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  // Admin and Audit Logs are Administrator-only.
  const isAdmin = user.role === "ADMINISTRATOR";

  const renderScreen = () => {
    switch (screen) {
      case "overview":
        return <OverviewScreen navigate={navigate} />;

      case "search":
        return <SearchScreen navigate={navigate} />;

      case "alerts":
        return <AlertsScreen navigate={navigate} />;

      case "entities":
        return <EntitiesScreen navigate={navigate} />;

      case "entity":
        return (
          <EntityScreen
            entity={entityData}
            navigate={navigate}
          />
        );

      case "graph":
        return (
          <GraphScreen
            navigate={navigate}
            investigationId={graphInvestigationId}
          />
        );

      case "network-risk":
        return (
          <NetworkRiskScreen
            navigate={navigate}
            displayId={networkDisplayId}
          />
        );

      case "listings":
        return <ListingsScreen />;

      case "attribution":
        return <AttributionScreen />;

      case "infrastructure":
        return <InfrastructureScreen />;

      case "blockchain":
        return <BlockchainScreen />;

      case "investigations":
        return (
          <InvestigationsScreen
            navigate={navigate}
            autoOpenNew={autoOpenNewInvestigation}
          />
        );

      case "workspace":
        return (
          <WorkspaceScreen
            navigate={navigate}
            displayId={workspaceDisplayId}
          />
        );

      case "timeline":
        return <TimelineScreen navigate={navigate} />;

      case "evidence":
        return (
          <EvidenceScreen
            selectedId={selectedEvidenceId}
          />
        );

      case "analytics":
        return <AnalyticsScreen />;

      case "scraper":
        return <ScraperScreen />;

      case "reports":
        return <ReportsScreen />;

      case "audit":
        return isAdmin ? <AuditScreen /> : <AccessDenied />;

      case "admin":
        return isAdmin ? <AdminScreen /> : <AccessDenied />;

      default:
        return <OverviewScreen navigate={navigate} />;
    }
  };

  const graphFull = screen === "graph";

  return (
    <div className="app-shell">
      <Topbar
        navigate={navigate}
        user={user}
        onLogout={logout}
      />

      <Sidebar
        current={screen}
        navigate={navigate}
        user={user}
        isAdmin={isAdmin}
      />

      <main
        className="main scroll-reveal"
        style={graphFull ? { overflow: "hidden" } : {}}
      >
        {renderScreen()}
      </main>
    </div>
  );
}

function AccessDenied() {
  return (
    <div
      style={{
        padding: "26px 28px",
        textAlign: "center",
        color: "var(--text-4)",
      }}
    >
      <div
        style={{
          fontSize: 32,
          marginBottom: 12,
          opacity: 0.3,
        }}
      >
        ⊘
      </div>

      <div>
        You don't have permission to view this page.
      </div>
    </div>
  );
}
