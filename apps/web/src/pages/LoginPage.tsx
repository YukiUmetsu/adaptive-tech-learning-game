import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/context";
import { sanitizeReturnTo } from "../auth/returnTo";

/**
 * Sign-in page.
 *
 * WorkOS hosted AuthKit renders the actual credential UI (Google OAuth or a
 * passwordless email code), so this page only frames the flow and preserves the
 * learner's intended destination.
 */
export default function LoginPage() {
  const { status, configured, devSignIn, authError, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo")) ?? "/";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      navigate(returnTo, { replace: true });
    }
  }, [status, navigate, returnTo]);

  const start = async (loginHint?: string) => {
    setBusy(true);
    setError(null);
    try {
      await signIn({ returnTo, loginHint: loginHint?.trim() || undefined });
      // Local/dev sign-in resolves here; WorkOS redirects the whole page first.
      navigate(returnTo, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login-page">
      <div className="login-card">
        <p className="login-kicker">Adaptive Learning</p>
        <h1>Welcome back</h1>
        <p className="muted">
          Sign in to keep your missions, history, and Bits in sync across every
          device.
        </p>

        {configured ? (
          <>
            <button
              type="button"
              className="primary login-provider"
              disabled={busy}
              onClick={() => void start()}
            >
              Continue with Google
            </button>

            <div className="login-divider" aria-hidden="true">
              <span>or</span>
            </div>

            <form
              className="login-email-form"
              onSubmit={(event) => {
                event.preventDefault();
                void start(email);
              }}
            >
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" className="login-email-submit" disabled={busy}>
                Continue
              </button>
            </form>
          </>
        ) : devSignIn ? (
          <>
            <p className="muted">
              WorkOS is not configured here. A local developer session is
              available. To test Google sign-in, set{" "}
              <code>VITE_WORKOS_CLIENT_ID</code> in{" "}
              <code>apps/web/.env.local</code>, set the matching{" "}
              <code>WORKOS_*</code> values for the API, and restart both
              servers.
            </p>
            <button
              type="button"
              className="primary login-provider"
              disabled={busy}
              onClick={() => void start()}
            >
              Continue as local developer
            </button>
          </>
        ) : (
          <p role="status">
            Sign-in is not configured in this environment.
          </p>
        )}

        {error ? <p role="alert">{error}</p> : null}
        {authError ? <p role="alert">{authError}</p> : null}

        <p className="login-alternatives">
          <Link to={returnTo}>Continue exploring without an account</Link>
        </p>
        <p className="muted login-demo-link">
          <Link to="/demo">or try the free demo</Link>
        </p>
      </div>
    </section>
  );
}
