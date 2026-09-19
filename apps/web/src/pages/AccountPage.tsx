import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { MeResponse } from "../api/types";
import { useAuth } from "../auth/context";

/**
 * Account page.
 *
 * Confirms that server-side authentication works end to end by reading
 * `GET /v1/me` with the session's access token.
 */
export default function AccountPage() {
  const { user, signOut } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api.GET("/v1/me");
        if (!active) {
          return;
        }
        if (result.data) {
          setMe(result.data);
        } else {
          setError(`Could not load your account (HTTP ${result.response.status})`);
        }
      } catch {
        if (active) {
          setError("Could not load your account");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="account-page">
      <h1>Your account</h1>
      <p className="muted">
        Signed in as {me?.email ?? user?.email ?? "your account"}.
      </p>

      {error ? <p role="alert">{error}</p> : null}

      {me ? (
        <dl className="account-details">
          <div>
            <dt>Account ID</dt>
            <dd>{me.id}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{me.email ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Authenticated</dt>
            <dd>{me.authenticated ? "Yes" : "No"}</dd>
          </div>
        </dl>
      ) : !error ? (
        <p role="status">Loading your account…</p>
      ) : null}

      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </section>
  );
}
