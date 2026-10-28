import { useEffect, useMemo, useState } from "react";
import {
  can,
  PERMISSIONS,
  request,
  send,
  type Me,
  type Permission,
} from "./api";

type Key = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};
type Member = {
  email: string;
  name: string;
  owner: boolean;
  status: "active" | "suspended";
  level_id: string | null;
  allow: Permission[];
  revoke: Permission[];
  last_active_at: string | null;
  created_at: string | null;
};
type Level = {
  id: string;
  name: string;
  is_default: number;
  permissions: Permission[];
  members: number;
};
type Section = "account" | "keys" | "members" | "levels";
const get = async <T,>(path: string): Promise<T> =>
  (await request(path)).json();
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
    : "never";
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return day(iso);
};
const initials = (m: { name: string; email: string }) =>
  (m.name || m.email)
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

export function Settings(props: {
  me: Me;
  onSignedOut: () => void;
  onRenamed: () => void;
}) {
  const admin = can(props.me, "members.manage");
  const [section, setSection] = useState<Section>("account");
  const sections: [Section, string, boolean][] = [
    ["account", "Account", true],
    ["keys", "API keys", true],
    ["members", "Members", admin],
    ["levels", "Access levels", admin],
  ];
  return (
    <main className="settings">
      <aside className="settings-nav" aria-label="Settings sections">
        <span className="group">You</span>
        {sections.slice(0, 2).map(([id, label]) => (
          <button
            key={id}
            className={section === id ? "on" : ""}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
        {admin && <span className="group">Admin</span>}
        {sections.slice(2).map(
          ([id, label, shown]) =>
            shown && (
              <button
                key={id}
                className={section === id ? "on" : ""}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ),
        )}
      </aside>
      <section className="settings-main">
        {section === "account" && <Account {...props} />}
        {section === "keys" && <Keys me={props.me} />}
        {section === "members" && admin && <Members me={props.me} />}
        {section === "levels" && admin && <Levels />}
      </section>
    </main>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    fn()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return { busy, error, run, setError };
}

function Account(props: {
  me: Me;
  onSignedOut: () => void;
  onRenamed: () => void;
}) {
  const [account, setAccount] = useState<{
    level?: string;
    name: string;
  } | null>(null);
  const [name, setName] = useState(props.me.name);
  const { busy, error, run } = useAction();
  useEffect(() => {
    void get<{ level?: string; name: string }>("/api/settings/account").then(
      setAccount,
    );
  }, []);
  return (
    <>
      <h1>Account</h1>
      <p className="muted lede">You sign in with Google as {props.me.email}.</p>
      <p className="muted small">
        <a href="/info/privacy/">Privacy policy and data requests</a>
      </p>
      <div className="panel">
        <form
          className="panel-body stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await send("/api/settings/account", "PATCH", { name });
              props.onRenamed();
            });
          }}
        >
          <label>
            Name
            <input
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <dl className="facts">
            <dt>Email</dt>
            <dd>{props.me.email}</dd>
            <dt>Access</dt>
            <dd>
              {props.me.owner
                ? "Owner (every permission)"
                : (account?.level ?? "…")}
            </dd>
          </dl>
          <div className="row">
            <button
              disabled={busy || name === (account?.name ?? props.me.name)}
            >
              Save name
            </button>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </form>
      </div>
      <div className="panel">
        <div className="panel-body row spread">
          <div>
            <strong>Sign out everywhere</strong>
            <p className="muted small">
              Ends your sessions on every browser, including this one.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await send("/api/auth/signout", "POST", { everywhere: true });
                props.onSignedOut();
              })
            }
          >
            Sign out everywhere
          </button>
        </div>
      </div>
    </>
  );
}

function Keys({ me }: { me: Me }) {
  const allowed = can(me, "keys.use");
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(
    null,
  );
  const [copied, setCopied] = useState("");
  const { busy, error, run } = useAction();
  const load = async () => setKeys(await get<Key[]>("/api/settings/keys"));
  useEffect(() => {
    void load();
  }, []);
  const command = (key: string) =>
    `claude mcp add --transport http mantel ${location.origin}/mcp --header "Authorization: Bearer ${key}"`;
  const copy = (label: string, text: string) =>
    void navigator.clipboard.writeText(text).then(() => setCopied(label));
  return (
    <>
      <h1>API keys</h1>
      <p className="muted lede">
        Use a key to connect Claude Code or another MCP client. A key acts as
        you and has your current access.
      </p>
      {!allowed && (
        <div className="panel">
          <p className="panel-body muted">
            API keys need the “API keys and MCP” permission. Ask an admin.
          </p>
        </div>
      )}
      {allowed && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Your keys</h2>
              <p className="muted small">
                Up to 10 active keys. Revoking one stops it at once.
              </p>
            </div>
          </div>
          <form
            className="panel-body key-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await send<{ name: string; key: string }>(
                  "/api/settings/keys",
                  "POST",
                  { name, days },
                );
                setCreated(result);
                setCopied("");
                setName("");
                await load();
              });
            }}
          >
            <label>
              Name
              <input
                value={name}
                maxLength={60}
                required
                placeholder="MacBook Claude Code"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Expires after
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
            </label>
            <button disabled={busy}>Create key</button>
          </form>
          {error && <p className="inline-error panel-body">{error}</p>}
          {created && (
            <div className="key-reveal" role="status">
              <p>
                <strong>Copy “{created.name}” now.</strong> You won't see it
                again.
              </p>
              <code>{created.key}</code>
              <div className="row">
                <button onClick={() => copy("key", created.key)}>
                  {copied === "key" ? "Copied" : "Copy key"}
                </button>
                <button
                  className="secondary"
                  onClick={() => copy("command", command(created.key))}
                >
                  {copied === "command" ? "Copied" : "Copy Claude Code command"}
                </button>
                <button className="ghost" onClick={() => setCreated(null)}>
                  Done
                </button>
              </div>
              <p className="muted small">
                The command stores the key in Claude Code's settings on that
                computer.
              </p>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="hide-sm">Key</th>
                <th>Last used</th>
                <th className="hide-sm">Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="hide-sm mono">{k.prefix}…</td>
                  <td>{ago(k.last_used_at)}</td>
                  <td className="hide-sm">{day(k.expires_at)}</td>
                  <td className="right">
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await send(`/api/settings/keys/${k.id}`, "DELETE");
                          await load();
                        })
                      }
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {!keys.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No active keys.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Members({ me }: { me: Me }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const load = async () => {
    const [m, l] = await Promise.all([
      get<Member[]>("/api/settings/members"),
      get<Level[]>("/api/settings/levels"),
    ]);
    setMembers(m);
    setLevels(l);
  };
  useEffect(() => {
    void load();
  }, []);
  const shown = useMemo(
    () =>
      members.filter((m) =>
        `${m.name} ${m.email}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [members, query],
  );
  const levelName = (id: string | null) =>
    levels.find((l) => l.id === id)?.name ?? "—";
  const member = members.find((m) => m.email === selected);
  return (
    <>
      <h1>Members</h1>
      <p className="muted lede">
        Everyone has one access level. Adjust any one person on top of it.
      </p>
      <div className="members-split">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>People</h2>
              <p className="muted small">{members.length} members</p>
            </div>
            <input
              className="search"
              placeholder="Search"
              aria-label="Search members"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Level</th>
                <th className="hide-sm">Last active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr
                  key={m.email}
                  className={`clickable ${selected === m.email ? "selected" : ""}`}
                  onClick={() => setSelected(m.email)}
                >
                  <td>
                    <div className="who">
                      <span className="avatar-initials">{initials(m)}</span>
                      <div>
                        {m.name || m.email.split("@")[0]}
                        <small className="muted">{m.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.owner ? (
                      <span className="chip-tag owner">Owner</span>
                    ) : (
                      <span className="chip-tag">{levelName(m.level_id)}</span>
                    )}{" "}
                    {m.allow.length + m.revoke.length > 0 && (
                      <span className="chip-tag custom">
                        {m.allow.length ? `+${m.allow.length}` : ""}
                        {m.allow.length && m.revoke.length ? " " : ""}
                        {m.revoke.length ? `−${m.revoke.length}` : ""}
                      </span>
                    )}
                    {m.status === "suspended" && (
                      <span className="chip-tag bad">Suspended</span>
                    )}
                  </td>
                  <td className="hide-sm">{ago(m.last_active_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {member ? (
          <MemberEditor
            key={member.email}
            me={me}
            member={member}
            levels={levels}
            onSaved={load}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="panel">
            <p className="panel-body muted">
              Choose a person to change their access.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

type Effect = "level" | "allow" | "revoke";
function MemberEditor(props: {
  me: Me;
  member: Member;
  levels: Level[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { member } = props;
  const [levelId, setLevelId] = useState(member.level_id ?? "");
  const [effects, setEffects] = useState<Record<string, Effect>>(() =>
    Object.fromEntries([
      ...member.allow.map((p) => [p, "allow" as const]),
      ...member.revoke.map((p) => [p, "revoke" as const]),
    ]),
  );
  const [owner, setOwner] = useState(member.owner);
  const [status, setStatus] = useState(member.status);
  const { busy, error, run } = useAction();
  const base = props.levels.find((l) => l.id === levelId)?.permissions ?? [];
  const effective = (p: Permission) =>
    owner ||
    effects[p] === "allow" ||
    (effects[p] !== "revoke" && base.includes(p));
  const save = (next: { status?: Member["status"] } = {}) =>
    run(async () => {
      await send(
        `/api/settings/members/${encodeURIComponent(member.email)}`,
        "PATCH",
        {
          level_id: levelId || undefined,
          allow: Object.keys(effects).filter((p) => effects[p] === "allow"),
          revoke: Object.keys(effects).filter((p) => effects[p] === "revoke"),
          ...(props.me.owner && owner !== member.owner ? { owner } : {}),
          ...next,
        },
      );
      if (next.status) setStatus(next.status);
      await props.onSaved();
    });
  return (
    <div className="panel editor">
      <div className="panel-head">
        <div className="who">
          <span className="avatar-initials">{initials(member)}</span>
          <div>
            <strong>{member.name || member.email}</strong>
            <small className="muted">
              {member.email} · {status === "active" ? "active" : "suspended"}
            </small>
          </div>
        </div>
        <button
          className="icon ghost"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <div className="panel-body stack">
        <label>
          Level
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            {props.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {props.me.owner && (
          <label className="switch">
            <input
              type="checkbox"
              checked={owner}
              onChange={(e) => setOwner(e.target.checked)}
            />
            Owner (every permission; can manage other owners)
          </label>
        )}
        <span className="small muted">
          Adjust for {member.name || member.email} only
        </span>
        {PERMISSIONS.map(([p, label]) => {
          const value = effects[p] ?? "level";
          return (
            <div className="override" key={p}>
              <div>
                <strong>{label}</strong>
                <small className="muted">
                  {effective(p) ? "Has access" : "No access"}
                  {value === "level" && !owner ? " · from level" : ""}
                </small>
              </div>
              <div
                className="segmented tri"
                role="radiogroup"
                aria-label={label}
              >
                {(["level", "allow", "revoke"] as const).map((e) => (
                  <button
                    key={e}
                    role="radio"
                    aria-checked={value === e}
                    className={`${value === e ? "on" : ""} ${e}`}
                    onClick={() => setEffects({ ...effects, [p]: e })}
                  >
                    {e === "level"
                      ? "Level"
                      : e === "allow"
                        ? "Allow"
                        : "Revoke"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {error && <p className="inline-error">{error}</p>}
      </div>
      <div className="panel-foot row spread">
        <button
          className="danger"
          disabled={busy}
          onClick={() =>
            save({ status: status === "active" ? "suspended" : "active" })
          }
        >
          {status === "active" ? "Suspend" : "Reactivate"}
        </button>
        <button disabled={busy} onClick={() => save()}>
          Save
        </button>
      </div>
    </div>
  );
}

function Levels() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [newName, setNewName] = useState("");
  const { busy, error, run } = useAction();
  const load = async () =>
    setLevels(await get<Level[]>("/api/settings/levels"));
  useEffect(() => {
    void load();
  }, []);
  const toggle = (level: Level, p: Permission) =>
    run(async () => {
      const permissions = level.permissions.includes(p)
        ? level.permissions.filter((x) => x !== p)
        : [...level.permissions, p];
      await send(`/api/settings/levels/${level.id}`, "PATCH", { permissions });
      await load();
    });
  return (
    <>
      <h1>Access levels</h1>
      <p className="muted lede">
        A level is a set of permissions. Changing a level changes it for
        everyone at that level. Owners have every permission whatever their
        level.
      </p>
      <div className="panel">
        <div className="panel-head">
          <h2>Permissions by level</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await send("/api/settings/levels", "POST", {
                  name: newName,
                  permissions: ["demo.view"],
                });
                setNewName("");
                await load();
              });
            }}
          >
            <input
              aria-label="New level name"
              placeholder="New level"
              value={newName}
              maxLength={120}
              required
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="secondary" disabled={busy}>
              Add level
            </button>
          </form>
        </div>
        {error && <p className="inline-error panel-body">{error}</p>}
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th>Permission</th>
                {levels.map((l) => (
                  <th key={l.id}>
                    <LevelHeader
                      level={l}
                      busy={busy}
                      run={run}
                      reload={load}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(([p, label, detail]) => (
                <tr key={p}>
                  <td className="perm">
                    <strong>{label}</strong>
                    <small className="muted">{detail}</small>
                  </td>
                  {levels.map((l) => (
                    <td key={l.id}>
                      <input
                        type="checkbox"
                        className="check"
                        aria-label={`${label} for ${l.name}`}
                        checked={l.permissions.includes(p)}
                        disabled={busy}
                        onChange={() => toggle(l, p)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-foot muted small">
          New accounts start at the default level. A level can be deleted once
          nobody uses it.
        </p>
      </div>
    </>
  );
}

function LevelHeader(props: {
  level: Level;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
  reload: () => Promise<void>;
}) {
  const { level } = props;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(level.name);
  return (
    <div className="level-head">
      <button
        className="link"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {level.name}
      </button>
      <small className="muted">
        {level.is_default ? "default · " : ""}
        {level.members}
      </small>
      {open && (
        <div className="level-menu">
          <input
            aria-label="Level name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="secondary"
            disabled={props.busy || !name.trim() || name === level.name}
            onClick={() =>
              props.run(async () => {
                await send(`/api/settings/levels/${level.id}`, "PATCH", {
                  name,
                });
                await props.reload();
                setOpen(false);
              })
            }
          >
            Rename
          </button>
          {!level.is_default && (
            <button
              className="secondary"
              disabled={props.busy}
              onClick={() =>
                props.run(async () => {
                  await send(`/api/settings/levels/${level.id}`, "PATCH", {
                    is_default: true,
                  });
                  await props.reload();
                  setOpen(false);
                })
              }
            >
              Make default
            </button>
          )}
          {!level.is_default && level.members === 0 && (
            <button
              className="danger"
              disabled={props.busy}
              onClick={() =>
                props.run(async () => {
                  await send(`/api/settings/levels/${level.id}`, "DELETE");
                  await props.reload();
                })
              }
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
