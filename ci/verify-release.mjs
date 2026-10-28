const url = process.env.APP_URL;
if (!url || !url.startsWith("https://"))
  throw new Error("APP_URL must be HTTPS");
const response = await fetch(new URL("/health", url));
const health = await response.json();
if (!response.ok || health.release !== process.env.EXPECTED_SHA)
  throw new Error("Deployed revision does not match");
// 302 covers the transition while Cloudflare Access still fronts the browser routes.
const session = await fetch(new URL("/api/session", url), {
  redirect: "manual",
});
if (![401, 302].includes(session.status))
  throw new Error("Private API is not protected");
const mcp = await fetch(new URL("/mcp", url), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  redirect: "manual",
});
if (mcp.status !== 401)
  throw new Error("MCP endpoint accepts requests without a key");
const google = await fetch(new URL("/api/auth/google/start", url), {
  redirect: "manual",
});
const location = google.headers.get("Location") ?? "";
if (google.status !== 302) throw new Error("Google sign-in does not redirect");
if (location.includes("auth_error=unavailable"))
  console.warn(
    "Google sign-in is not configured yet (GOOGLE_CLIENT_ID or secret missing).",
  );
console.log(
  "Deployed source, anonymous-access denial and the sign-in redirect verified. CAD runtime acceptance is a separate authenticated check.",
);
