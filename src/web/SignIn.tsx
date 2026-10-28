import { lazy, Suspense, useRef, useState } from "react";
import { send } from "./api";

const NameStage = lazy(() => import("./NameStage"));
const errors: Record<string, string> = {
  state: "Sign-in expired. Try again.",
  google: "That Google account is linked to a different Mantel account.",
  unverified: "Use a Google account with a verified email.",
  suspended: "This account is suspended.",
  rate: "Too many attempts. Wait a minute.",
  unavailable: "Google sign-in isn't set up yet.",
  link: "That sign-in link has expired or was already used.",
};
/** Reads and clears ?auth_error= and /link#token so a reload doesn't repeat them. */
function arrival() {
  const url = new URL(location.href);
  const code = url.searchParams.get("auth_error");
  const token =
    url.pathname === "/link" ? url.hash.slice(1) || undefined : undefined;
  if (code || url.pathname === "/link") history.replaceState(null, "", "/");
  return {
    error: code ? (errors[code] ?? "Sign-in failed. Try again.") : "",
    token,
  };
}

export function SignIn(props: {
  theme: "light" | "dark";
  onSignedIn: () => Promise<void>;
}) {
  const [{ error: initialError, token }] = useState(arrival);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  async function redeem() {
    setBusy(true);
    setError("");
    try {
      await send("/api/auth/link", "POST", { token });
      await props.onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : errors.link);
      setBusy(false);
    }
  }
  return (
    <main className="signin">
      <Suspense fallback={null}>
        <NameStage theme={props.theme} avoid={card} />
      </Suspense>
      <p className="signin-hint" aria-hidden="true">
        ↻ Drag to spin · modelled in Mantel
      </p>
      <div className="signin-card" ref={card}>
        <div className="signin-brand">
          <span className="mark" aria-hidden="true" /> Mantel
        </div>
        {token ? (
          <>
            <h1>Sign in with this link</h1>
            <p className="muted">
              The link works once. Continue to open Mantel in this browser.
            </p>
            <button
              className="primary wide"
              disabled={busy}
              onClick={() => void redeem()}
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <div className="segmented wide" role="tablist">
              {(
                [
                  ["signin", "Sign in"],
                  ["signup", "Create account"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={mode === value}
                  className={mode === value ? "on" : ""}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <a
              className="google"
              href="/api/auth/google/start"
              onClick={() => setBusy(true)}
              aria-disabled={busy}
            >
              <GoogleMark />
              {mode === "signin"
                ? "Continue with Google"
                : "Create an account with Google"}
            </a>
            <p className="muted small">
              {mode === "signin"
                ? "Sign in with the Google account you use for Mantel."
                : "New accounts start with the demo. An admin can give you more access."}
            </p>
          </>
        )}
        <p className="muted small">
          <a href="/info/">About Mantel</a> ·{" "}
          <a href="/info/privacy/">Privacy policy</a>
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
