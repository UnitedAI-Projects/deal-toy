// One-off repair for demos seeded before art kinds were keyed by piece (no file extension):
//   node examples/spacex-ipo/fix-art-kinds.mjs <origin> <sign-in link file>
import { readFileSync } from "node:fs";
const [origin, linkFile] = process.argv.slice(2);
const link = new URL(readFileSync(linkFile, "utf8").trim());
const signin = await fetch(`${origin}/api/auth/link`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ token: link.hash.slice(1) }),
});
if (!signin.ok) throw new Error(await signin.text());
const cookie = signin.headers.get("set-cookie").split(";")[0];
const call = async (name, input) => {
  const r = await fetch(`${origin}/api/tools/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(input),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
};
const piece = (name) => name.replace(/\.[^.]+$/, "");
const fix = (state) => {
  if (!state?.art) return state;
  state.art.kinds = Object.fromEntries(
    Object.entries(state.art.kinds ?? {}).map(([k, v]) => [piece(k), v]),
  );
  return state;
};
const { own } = await call("projects_list", {});
for (const p of own.filter(
  (x) => x.has_demo && x.name === "SpaceX IPO deal toy",
)) {
  const { script } = await call("demo_get", { projectId: p.id });
  for (const step of script.steps) fix(step.state);
  await call("demo_save", { projectId: p.id, script });
  const { version, state } = await call("phases_get", { projectId: p.id });
  await call("phases_save", {
    projectId: p.id,
    expectedVersion: version,
    state: fix(state),
  });
  console.log("fixed", p.id);
}
