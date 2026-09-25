import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";

import RequireAuth from "./auth/RequireAuth";
import AppShell from "./layout/AppShell";
import AccountPage from "./pages/AccountPage";
import CertificationDashboardPage from "./pages/CertificationDashboardPage";
import CertificationsPage from "./pages/CertificationsPage";
import CyberDefenseMissionPage from "./pages/CyberDefenseMissionPage";
import CyberDefensePage from "./pages/CyberDefensePage";
import DailyMissionPage from "./pages/DailyMissionPage";
import DemoPage from "./pages/DemoPage";
import DomainLearningPage from "./pages/DomainLearningPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MissionPage from "./pages/MissionPage";
import NotFoundPage from "./pages/NotFoundPage";
import PracticeTestPage from "./pages/PracticeTestPage";
import SettingsPage from "./pages/SettingsPage";
import TaskPage from "./pages/TaskPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="tracks" element={<CertificationsPage />} />
        <Route
          path="tracks/:certificationId"
          element={<CertificationDashboardPage />}
        />
        <Route
          path="tracks/:certificationId/domains/:domainId/learn"
          element={
            <RequireAuth>
              <DomainLearningPage />
            </RequireAuth>
          }
        />
        <Route
          path="tracks/:certificationId/daily"
          element={
            <RequireAuth>
              <DailyMissionPage />
            </RequireAuth>
          }
        />
        <Route
          path="tracks/:certificationId/tasks/:taskId"
          element={<TaskPage />}
        />
        {/* Legacy paths kept as redirects so existing links keep working. */}
        <Route
          path="certifications"
          element={<Navigate to="/tracks" replace />}
        />
        <Route
          path="certifications/*"
          element={<LegacyTrackRedirect />}
        />
        <Route path="missions/:missionId" element={<MissionPage />} />
        <Route
          path="tracks/:certificationId/practice-tests/:practiceTestId"
          element={<PracticeTestPage />}
        />
        <Route path="demo" element={<DemoPage />} />
        <Route path="game" element={<CyberDefensePage />} />
        <Route
          path="game/missions/:missionId"
          element={
            <RequireAuth>
              <CyberDefenseMissionPage />
            </RequireAuth>
          }
        />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/**
 * Redirects a legacy `/certifications/...` path to its `/tracks/...` equivalent,
 * preserving the suffix and query string. Only used for old links and stored
 * return paths, so `/tracks` is the single canonical location.
 */
function LegacyTrackRedirect() {
  const params = useParams();
  const location = useLocation();
  const suffix = params["*"] ? `/${params["*"]}` : "";
  return <Navigate to={`/tracks${suffix}${location.search}`} replace />;
}
