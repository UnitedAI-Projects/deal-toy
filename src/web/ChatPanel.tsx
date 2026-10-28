import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Activity, Job, ProjectEvent, Revision, Session } from "./api";
type Props = {
  activity: Activity;
  revisions: Revision[];
  jobs: Job[];
  me: string;
  draft: string;
  setDraft: (text: string) => void;
  composer: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => Promise<void>;
  onViewRevision: (revision: Revision) => void;
  /** When set, the composer is replaced by this explanation. */
  readOnly?: string;
};
type Item =
  | { type: "event"; event: ProjectEvent; count: number }
  | { type: "session"; session: Session | undefined; at: string };
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const WORKING_MS = 90_000;

/** Turns the activity log into chat items: session dividers, and repeated polls folded together. */
function feed(activity: Activity): Item[] {
  const sessions = new Map(activity.sessions.map((s) => [s.id, s]));
  const items: Item[] = [];
  // Calls an agent makes without its session id stay inside the conversation they belong to;
  // a divider marks only a change to a different session.
  let current: string | null = null;
  for (const event of activity.events) {
    if (event.session_id && event.session_id !== current) {
      current = event.session_id;
      items.push({
        type: "session",
        session: sessions.get(event.session_id),
        at: event.created_at,
      });
    }
    const last = items.at(-1);
    if (
      event.kind === "tool_call" &&
      last?.type === "event" &&
      last.event.kind === "tool_call" &&
      last.event.payload.tool === event.payload.tool &&
      last.event.payload.summary === event.payload.summary
    ) {
      last.count++;
      last.event = event;
      continue;
    }
    items.push({ type: "event", event, count: 1 });
  }
  return items;
}

export function ChatPanel(props: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const items = useMemo(() => feed(props.activity), [props.activity]);
  const running = props.activity.sessions.find((s) => s.active && !s.ended_at);
  const lastEvent = props.activity.events.at(-1);
  const working =
    running &&
    lastEvent &&
    Date.now() - new Date(lastEvent.created_at).getTime() < WORKING_MS;
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);
  const opened = useRef(false);
  useEffect(() => {
    const el = list.current;
    if (!el || !items.length) return;
    // Open at the latest activity; afterwards follow only if the reader is near the end.
    if (
      !opened.current ||
      el.scrollHeight - el.scrollTop - el.clientHeight < 160
    )
      el.scrollTop = el.scrollHeight;
    opened.current = true;
  }, [items.length]);
  async function send() {
    const text = props.draft.trim();
    if (!text) return;
    setSending(true);
    setError("");
    try {
      await props.onSend(text);
      props.setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Note was not saved");
    } finally {
      setSending(false);
    }
  }
  const revisionFor = (event: ProjectEvent) => {
    const number = /Saved revision (\d+)/.exec(
      String(event.payload.summary),
    )?.[1];
    const modelId = (event.payload.args as { modelId?: string } | undefined)
      ?.modelId;
    return number
      ? props.revisions.find(
          (r) =>
            r.number === Number(number) && (!modelId || r.model_id === modelId),
        )
      : undefined;
  };
  const buildState = (revision: Revision) => {
    const job = props.jobs.find((j) => j.revision_id === revision.id);
    return job?.status;
  };
  return (
    <section className="chat" aria-label="Agent activity">
      <div className="chat-list" ref={list}>
        {!items.length && (
          <div className="chat-empty">
            <strong>No agent activity yet</strong>
            <p>
              Prompt your agent with this project. Its prompt, updates and every
              revision appear here as it works.
            </p>
          </div>
        )}
        {items.map((item, index) => {
          if (item.type === "session")
            return (
              <div className="chat-divider" key={`s-${index}`}>
                <span>
                  {item.session?.title || "Agent session"} ·{" "}
                  {item.session?.client || "MCP client"} · {time(item.at)}
                </span>
              </div>
            );
          const { event, count } = item;
          const p = event.payload;
          switch (event.kind) {
            case "prompt":
              return (
                <div className="msg-you" key={event.id}>
                  <span
                    className="msg-label"
                    title="Sent by the agent with session_start; the app cannot verify it is word for word"
                  >
                    Prompt · reported by agent
                  </span>
                  <div className="bubble">{String(p.prompt)}</div>
                </div>
              );
            case "agent_update":
              return (
                <div className="msg-agent" key={event.id}>
                  <span className="avatar" aria-hidden="true" />
                  <p>{String(p.message)}</p>
                </div>
              );
            case "team_note":
              return (
                <div className="msg-you" key={event.id}>
                  <span className="msg-label">
                    Note from {event.actor === props.me ? "you" : event.actor} ·{" "}
                    {time(event.created_at)}
                  </span>
                  <div className="bubble note">{String(p.message)}</div>
                </div>
              );
            case "team_edit":
              return (
                <div className="msg-system" key={event.id}>
                  ✎ {event.actor === props.me ? "You" : event.actor}:{" "}
                  {String(p.message)}
                </div>
              );
            case "ended":
              return (
                <div className="msg-end" key={event.id}>
                  <strong>Session finished</strong>
                  {p.summary ? <p>{String(p.summary)}</p> : null}
                </div>
              );
            default: {
              const revision = revisionFor(event);
              const status = revision ? buildState(revision) : undefined;
              const icon = !p.ok
                ? "✕"
                : status === "failed"
                  ? "✕"
                  : status === "queued" || status === "running"
                    ? "◐"
                    : "✓";
              const tone =
                !p.ok || status === "failed"
                  ? "bad"
                  : icon === "◐"
                    ? "busy"
                    : "ok";
              return (
                <div className={`step ${tone}`} key={event.id}>
                  {revision ? (
                    <button
                      className="step-main"
                      onClick={() => props.onViewRevision(revision)}
                      title={`Show revision ${revision.number}`}
                    >
                      <span className="step-icon" aria-hidden="true">
                        {icon}
                      </span>
                      <span className="step-title">
                        {String(p.summary)}
                        {revision && status && (
                          <span className="step-status"> · build {status}</span>
                        )}
                      </span>
                      <span className="step-meta">
                        {count > 1 ? `×${count} · ` : ""}
                        {p.channel !== "http"
                          ? String(p.tool)
                          : event.actor === props.me
                            ? "you"
                            : "team"}
                      </span>
                    </button>
                  ) : (
                    <div className="step-main">
                      <span className="step-icon" aria-hidden="true">
                        {icon}
                      </span>
                      <span className="step-title">
                        {String(p.summary)}
                        {revision && status && (
                          <span className="step-status"> · build {status}</span>
                        )}
                      </span>
                      <span className="step-meta">
                        {count > 1 ? `×${count} · ` : ""}
                        {p.channel !== "http"
                          ? String(p.tool)
                          : event.actor === props.me
                            ? "you"
                            : "team"}
                      </span>
                    </div>
                  )}
                  <details>
                    <summary>Details</summary>
                    <pre>{JSON.stringify(p.args, null, 1)}</pre>
                  </details>
                </div>
              );
            }
          }
        })}
        {working && (
          <div className="thinking" aria-live="polite">
            <i />
            <i />
            <i /> Agent working
          </div>
        )}
      </div>
      {props.readOnly ? (
        <p className="composer composer-readonly">{props.readOnly}</p>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="composer-row">
            <textarea
              ref={props.composer}
              rows={2}
              maxLength={4000}
              aria-label="Note for the agent"
              placeholder="Leave a note for the agent…"
              value={props.draft}
              onChange={(e) => props.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="send"
              aria-label="Send note"
              disabled={sending || !props.draft.trim()}
            >
              ↑
            </button>
          </div>
          <p className="composer-hint">
            {running
              ? "Your agent sees this on its next step."
              : "The next agent to work on this project will see this."}
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
