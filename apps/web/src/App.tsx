import { Route, Routes } from "react-router-dom";

import RequireAuth from "./auth/RequireAuth";
import AppShell from "./layout/AppShell";
import AccountPage from "./pages/AccountPage";
import CertificationDashboardPage from "./pages/CertificationDashboardPage";
import CertificationsPage from "./pages/CertificationsPage";
import DemoPage from "./pages/DemoPage";
import DomainLearningPage from "./pages/DomainLearningPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MissionPage from "./pages/MissionPage";
import NotFoundPage from "./pages/NotFoundPage";
import TaskPage from "./pages/TaskPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="certifications" element={<CertificationsPage />} />
        <Route
          path="certifications/:certificationId"
          element={<CertificationDashboardPage />}
        />
        <Route
          path="certifications/:certificationId/domains/:domainId/learn"
          element={
            <RequireAuth>
              <DomainLearningPage />
            </RequireAuth>
          }
        />
        <Route
          path="certifications/:certificationId/tasks/:taskId"
          element={<TaskPage />}
        />
        <Route path="missions/:missionId" element={<MissionPage />} />
        <Route path="demo" element={<DemoPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
