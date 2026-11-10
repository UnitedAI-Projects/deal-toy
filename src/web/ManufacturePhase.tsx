/* Phase 5: quotes, threads and the order. No manufacturing service is connected yet, so
   messages are kept here and labelled as not sent. A person moves the order along. */
import { useState } from "react";
import { Banner, OutputBar } from "./PhaseFrame";
import type { PhaseProps } from "./ProjectShell";
import {
  approvedBriefVersion,
  ORDER_STAGES,
  type OrderStage,
  type Supplier,
} from "./phases";

const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ManufacturePhase(props: PhaseProps) {
  const { state, update, readOnly, latestRevision } = props;
  const [selected, setSelected] = useState(state.suppliers[0]?.id ?? null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState<"us" | "them">("us");
  const supplier = state.suppliers.find((s) => s.id === selected) ?? null;
  const bv = approvedBriefVersion(state);
  const release = state.release;
  const releaseStale =
    !!release &&
    (release.revision < latestRevision || release.briefVersion < bv);
  const quantity =
    (state.brief.approved?.fields ?? state.brief.fields).find(
      (f) => f.key === "quantity",
    )?.value || "quantity not set";
  const deadline =
    (state.brief.approved?.fields ?? state.brief.fields).find(
      (f) => f.key === "deadline",
    )?.value || "";
  const quotes = state.suppliers.filter((s) => s.quote);
  const ordered = state.suppliers.find((s) => s.id === state.order?.supplierId);

  const patch = (id: string, p: (s: Supplier) => Supplier) =>
    update((s) => ({
      ...s,
      suppliers: s.suppliers.map((x) => (x.id === id ? p(x) : x)),
    }));

  return (
    <div className="mfg">
      <div className="mfg-banners">
        {!release && (
          <Banner
            action={{
              label: "Go to Documents",
              onClick: () => props.go("documents"),
            }}
          >
            No release yet. Requests should go out with an approved release so
            every supplier quotes the same revision.
          </Banner>
        )}
        {releaseStale && (
          <Banner
            action={{
              label: "Go to Documents",
              onClick: () => props.go("documents"),
            }}
          >
            The release is r{release.revision}, brief v{release.briefVersion};
            the model or brief has moved on since.
          </Banner>
        )}
      </div>
      <div className="mfg-grid">
        <nav className="card doc-list" aria-label="Suppliers">
          <div className="muted small">
            {release ? `Release r${release.revision}` : "No release"} ·{" "}
            {quantity}
          </div>
          {state.suppliers.map((s) => (
            <button
              key={s.id}
              className={`doc-row ${s.id === selected ? "sel" : ""}`}
              onClick={() => setSelected(s.id)}
            >
              <span>
                <span className="doc-t">{s.name}</span>
                <span className="doc-s">
                  {s.scope || "whole toy"} ·{" "}
                  {s.quote ? `quote ${s.quote.price}` : "no quote yet"} ·{" "}
                  {s.messages.length} messages
                </span>
              </span>
              {state.order?.supplierId === s.id && (
                <span className="tag ok">order</span>
              )}
            </button>
          ))}
          {!readOnly && (
            <form
              className="supplier-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                const s: Supplier = {
                  id: newId(),
                  name: name.trim(),
                  scope: scope.trim(),
                  messages: [],
                };
                update((st) => ({ ...st, suppliers: [...st.suppliers, s] }));
                setSelected(s.id);
                setName("");
                setScope("");
              }}
            >
              <input
                value={name}
                placeholder="Supplier name"
                onChange={(e) => setName(e.target.value)}
              />
              <input
                value={scope}
                placeholder="Parts (blank for all)"
                onChange={(e) => setScope(e.target.value)}
              />
              <button className="secondary">Add supplier</button>
            </form>
          )}
        </nav>

        <section className="card thread">
          {!supplier ? (
            <div className="concepts-empty">
              <h2>Quotes and conversations</h2>
              <p className="muted">
                Add the suppliers you want quotes from. Each one gets a thread
                about the parts it makes.
              </p>
            </div>
          ) : (
            <>
              <div className="thread-head">
                <div>
                  <strong>{supplier.name}</strong>
                  <div className="stages">
                    {ORDER_STAGES.map((st, i) => {
                      const on =
                        state.order?.supplierId === supplier.id &&
                        ORDER_STAGES.indexOf(state.order.stage) >= i;
                      return (
                        <span key={st} className={on ? "on" : ""}>
                          <span
                            className={`phase-dot ${on ? "approved" : ""}`}
                          />
                          {st}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {state.order?.supplierId === supplier.id ? (
                  <select
                    aria-label="Order stage"
                    disabled={readOnly}
                    value={state.order.stage}
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        order: {
                          ...s.order!,
                          stage: e.target.value as OrderStage,
                          by: props.email,
                          at: new Date().toISOString(),
                        },
                      }))
                    }
                  >
                    {ORDER_STAGES.map((st) => (
                      <option key={st}>{st}</option>
                    ))}
                  </select>
                ) : (
                  <button
                    className="secondary"
                    disabled={
                      readOnly || !supplier.quote || !release || !!state.order
                    }
                    title={
                      state.order
                        ? `Already ordered from ${ordered?.name}`
                        : !supplier.quote
                          ? "Record a quote first"
                          : undefined
                    }
                    onClick={() =>
                      update((s) => ({
                        ...s,
                        order: {
                          supplierId: supplier.id,
                          stage: "Ordered",
                          by: props.email,
                          at: new Date().toISOString(),
                        },
                      }))
                    }
                  >
                    Choose this quote
                  </button>
                )}
              </div>
              <div className="quote-row">
                <label>
                  Price
                  <input
                    value={supplier.quote?.price ?? ""}
                    placeholder="$152 / unit"
                    disabled={readOnly}
                    onChange={(e) =>
                      patch(supplier.id, (x) => ({
                        ...x,
                        quote: {
                          lead: x.quote?.lead ?? "",
                          price: e.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Lead time
                  <input
                    value={supplier.quote?.lead ?? ""}
                    placeholder="Sample 10 days · run 18 days"
                    disabled={readOnly}
                    onChange={(e) =>
                      patch(supplier.id, (x) => ({
                        ...x,
                        quote: {
                          price: x.quote?.price ?? "",
                          lead: e.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="thread-body">
                {supplier.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`bubble ${m.from === "us" ? "us" : "them"}`}
                  >
                    <div className="bubble-by">
                      {m.from === "us" ? "You" : supplier.name} ·{" "}
                      {new Date(m.at).toLocaleDateString()}
                      {m.from === "us" && " · saved here, not sent"}
                    </div>
                    {m.text}
                  </div>
                ))}
                {!supplier.messages.length && (
                  <p className="muted small">
                    No messages yet. Paste a supplier's reply here to keep it
                    with the project.
                  </p>
                )}
              </div>
              {!readOnly && (
                <form
                  className="thread-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!text.trim()) return;
                    patch(supplier.id, (x) => ({
                      ...x,
                      messages: [
                        ...x.messages,
                        {
                          id: newId(),
                          from,
                          text: text.trim(),
                          at: new Date().toISOString(),
                        },
                      ],
                    }));
                    setText("");
                  }}
                >
                  <select
                    aria-label="From"
                    value={from}
                    onChange={(e) => setFrom(e.target.value as "us" | "them")}
                  >
                    <option value="us">You</option>
                    <option value="them">{supplier.name}</option>
                  </select>
                  <textarea
                    value={text}
                    placeholder={
                      from === "us"
                        ? "Write to the supplier…"
                        : "Paste the supplier's message…"
                    }
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button>Save</button>
                </form>
              )}
              <p className="muted small thread-foot">
                No manufacturing service is connected, so nothing is sent from
                here. Messages are a record for the team.
              </p>
            </>
          )}
        </section>
      </div>

      <OutputBar>
        <span className="output-what">
          {state.order ? `Order · ${ordered?.name ?? ""}` : "Manufacture"}
        </span>
        <span className="output-facts">
          {state.order ? (
            <span>{state.order.stage}</span>
          ) : (
            <span>
              {quotes.length} {quotes.length === 1 ? "quote" : "quotes"} in
            </span>
          )}
          {deadline && <span>in hand by {deadline}</span>}
        </span>
      </OutputBar>
    </div>
  );
}
