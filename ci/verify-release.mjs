const url = process.env.APP_URL;
if (!url || !url.startsWith("https://"))
  throw new Error("APP_URL must be HTTPS");
const response = await fetch(new URL("/health", url));
const health = await response.json();
if (!response.ok || health.release !== process.env.EXPECTED_SHA)
  throw new Error("Deployed revision does not match");
const protectedResponse = await fetch(new URL("/api/session", url), {
  redirect: "manual",
});
if (![401, 302].includes(protectedResponse.status))
  throw new Error("Private API is not protected");
console.log(
  "Deployed source and anonymous-access denial verified. CAD runtime acceptance is a separate authenticated check.",
);
