import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../auth/context";

/** Route guard for account-only pages. */
export default function RequireAuth({
  children,
}: {
  children: ReactNode;
}) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <p role="status">Checking your session…</p>;
  }

  if (status === "anonymous") {
    const target = `${location.pathname}${location.search}`;
    return (
      <Navigate to={`/login?returnTo=${encodeURIComponent(target)}`} replace />
    );
  }

  return <>{children}</>;
}
