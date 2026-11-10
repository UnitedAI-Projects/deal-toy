# Sequential editing and agent presence

Date: 2026-11-09. Status: draft for approval.

## Why

Mantel's models are meant to be built and changed one feature at a time, while people watch. In practice neither happens.

- **Every revision is a full rewrite.** Both production models (SpaceX IPO, DigitalBridge × ArcLight) are free-form build123d scripts of about 12 KB of geometry code each. The DigitalBridge script is 41.9 KB in total because it embeds two logo SVGs. The agent drafted each script locally in Claude Code and saved it whole. SpaceX revision 2 replaced the tower function and the plinth size by saving a new copy of the whole script.
- **The step structure is unused.** The steps layout (`mt.Model` and `# mantel:steps` markers), the action catalog, `steps_add` and `steps_edit` exist. The modeling skill asks for them. Neither real model uses them, because nothing makes the agent follow the skill. No saved actions or presets exist.
- **Nobody asks questions first.** The agent turned "build a deal toy for space x" into a detailed brief by itself and modeled that brief.
- **There is little to see while the agent works.** The activity panel lists events, but the canvas shows nothing until a build succeeds, and nothing shows which part of the model the agent is changing.

The person who asked for this wants three things. Models should be laid out as a framework first, then changed inside that framework. Questions should come before any geometry. And people should be able to see what the agent is working on, on the model itself, as it happens. Visibility is the priority: "physically seeing a selector or cursor on the screen of what the agent is working on and a live summary is major."

## Goals

1. Every model has a declared framework of layers. Later requests change layers in place. A whole-script rewrite is never accepted as an edit.
2. Before the first geometry, the agent questions the person about every section of the object (dimensions, shape, each feature, colours, designs) and records the answers in Mantel.
3. While the agent works, the canvas shows where it is working. That means a selector on the area, a placeholder animation inside it, and a short summary that keeps updating. This works on an empty project too.
4. A **layers panel** shows what the model is made of now. A **timeline** shows what happened to it, in order.
5. Feedback after each step is fast enough to feel live.

## Non-goals

- **No built-in agent.** Mantel will not call a model or store provider keys. People prompt in Claude Code (or another MCP client), and its questions appear there. This keeps the existing "no built-in chat model" boundary in `docs/roadmap.md`.
- **No streaming of code as it is typed, and no timed pushes.** The agent produces edits whole, partial Python cannot build, and builds cannot run every second.
- **No restoring an old revision from the timeline in this work.** Viewing the past is in scope. Making an old revision current again is a later, separate action.
- **No automatic conversion of existing free-form models.** See "Existing models" below.

## Anti-goals

The work fails, even if it technically works, if any of these happen:

- **The presence animation lies about progress.** Steps tick on a timer while the agent is stuck, the selector keeps moving after a failure, or "working" is shown after the session ended.
- **The rules live only in instructions.** That is today's failure: the skill already asks for steps, and agents ignore it.
- **Rewrites are disguised as edits.** A change plan says "edit Rim", but the whole script changes and is accepted.

## Words used here

- **Layer:** one named step in the model's steps section, in build order. The framework's sizes are a layer too. A layer can be geometry (a new part or a change to one), a construction aid, or an appearance (colour, finish). Today's code calls these "steps"; the interface calls them layers.
- **Design sheet:** the record of the agent's questioning, plus the framework it proposed. It is stored once per model and updated by later changes.
- **Change:** one request, carried out under one **change plan**. A change may save several revisions, because each step tool saves a revision today. On the timeline, one change is one dot.
- **Revision:** an immutable saved script. Unchanged from today.

## Part 1: enforced structure

### The design sheet

The modeling skill tells the agent to question the person in its own client before calling any geometry tool. It then sends a start record to Mantel, through a new tool the builder names. The record holds:

- **The request**, word for word.
- **Sections.** Each has a name (for a tea cup: overall size, body shape, rim, handle, foot, colours and finish, designs and markings), a value, and a source: `answered` (by the person) or `assumed` (the agent's guess). Every section the framework uses must be present. An empty value is refused.
- **The framework.** This is the ordered list of layers the agent will create. Each layer has a name, a kind (shape/new part, modify, size, appearance, construction), the `PARAMS` it reads, and a **target region**: an axis-aligned box in millimetres, used for presence before the layer has geometry.

Mantel stores the design sheet with the model and shows it to the team next to the project brief. Assumed sections stay marked "assumed" until someone confirms or changes them. Each change to the sheet appears on the timeline.

**Strictness (my call):** building may start with assumed sections. The first change summary lists every assumption so the person can confirm or correct it. Blocking until every answer comes from the person would stall whenever they are away.

### Change plans

Every change after the design sheet starts with a change plan. A plan holds:

- the request, word for word;
- the layers it will **add** (with target regions), **edit** or **remove**;
- the layers expected to **follow along**: unchanged code whose geometry moves because of the change (for example, the handle follows a height change).

The agent then reports progress against the plan: which layer it is on now, with optional short phrases for the summary card. It finishes with a summary. A plan that is not finished when its session ends, or after 30 minutes without activity, closes as **stopped**. The 30 minutes is my call.

A plan may also update design-sheet sections. "Make the rim oval" changes the Rim section from round to oval, and the sheet always shows current values.

Only one plan can be open per model at a time. If a person saves while a plan is open, the agent's next write hits the existing revision conflict, and it must reload and reconcile as it does today.

**People are not held to plans (my call).** A person's own edits from the interface (a parameter change, a layer form, the source editor) need neither a design sheet nor a plan. The refusals below apply to agent (MCP) writes. Mantel records each person's edit as a change by that person, with the layers it touched worked out by the same ownership comparison.

### What the tools refuse

Enforcement lives in the tool dispatcher, not in the skill. Every refusal tells the agent exactly what is missing and which tool to call. Each refusal needs a denial test.

1. **No design sheet yet:** any tool that writes a model's source (`models_save`, `steps_*`, `models_set_parameter` from MCP) is refused.
2. **First revision not in steps layout:** the first source must use the steps layout, and its layers must match the framework's layer names. `base()` must return `None`. All geometry lives in layers, with free Python only in `custom` steps whose `fn=` is a top-level function in the script. This is my call. It closes the escape hatch of putting the whole model in `base()`.
3. **No open change plan:** an agent write without one is refused.
4. **Undeclared code changed:** an agent write that changes code the plan did not declare is refused. Mantel compares the old and new source by ownership:
   - each step's line belongs to its layer;
   - each top-level function belongs to the layers whose `custom` steps call it;
   - each `PARAMS` entry belongs to the framework layer;
   - everything else (imports, shared helpers, module constants) is shared code, and changing it must be declared in the plan as "shared code".

   Refusing undeclared changes, rather than flagging them, is my call. Flagging would let rewrites through again.

`models_save` stays as the way to save whole-source edits that the step tools cannot express, such as a new `custom` function. It is checked like any other write.

### Actions the catalog needs

The current catalog (body, plane, extrude, hole, fillet, chamfer, text, combine, move, custom) cannot make a tea cup without `custom` code for nearly every layer. Part 1 therefore adds at least these actions:

- **revolve** (cup wall, rim profile);
- **sweep** along a path (handle);
- **loft** between profiles (oval rim to round base);
- **shell** (hollowing);
- **appearance** (colour and finish of a part or face, so "make the rim gold" is a layer edit, not a code change).

Each one is self-describing, with inputs, what it creates, its failures and an example, like the existing actions. The builder may find others are needed. The deal-toy examples (plinths, arches, lettering, logo inlays) should be checked against the catalog at the same time.

### Skill and connection instructions

Rewrite the `modeling` skill around this flow: question, send the design sheet, build the framework, then make each later change through a plan with progress reports. Update the README's "Connect an agent" sequence the same way. The skill describes the flow; the tools enforce it.

### Existing models

Revisions saved before this work stay viewable, buildable and downloadable. The first agent change to a free-form model must be a **restructure**: a design sheet plus a framework that rebuilds the same object in the steps layout, accepted as one change. Mantel makes no automatic conversion. People can still change `PARAMS` values on old models from the interface.

## Part 2: agent presence on the canvas

### What people see

Two mockups were reviewed and accepted. They are in `docs/design/` alongside this file: `2026-11-09-agent-presence-mockup.html` and `2026-11-09-agent-presence-edits-mockup.html`. Open them in a browser; they animate.

- **Selector:** a dashed box around the target area, with corner brackets that drift a few pixels and a small "Agent · editing handle" tag. The area is either an existing layer's geometry or the target region from the plan. Colours: green for a new layer, purple for one being edited, amber for layers that follow along. Follow-along areas get a soft outline without brackets.
- **Placeholder:** a translucent shape inside the area that slowly morphs and stretches. For an edit, the old geometry stays visible, faded, behind it. For a size change, the affected geometry may stretch gently, but the real geometry is never distorted in a way that could be mistaken for the result.
- **Summary card,** anchored near the selector:
  - the current layer and one short phrase about it, with the phrases rotating every few seconds;
  - a thin progress bar for the phrase period;
  - the plan's layer list, where finished layers show ✓, the current one ●, and the rest ○, with new/edit/follows badges.
- **Empty project:** the framework's overall region is marked the same way, and layers appear one by one as they build.
- **When it finishes:** motion stops, the outline of what changed fades over a few seconds, and the card shows the summary ("2 layers added, 6 unchanged") and any assumptions to confirm.

### Honesty rules (decided)

- A layer ticks only on real events: the agent moving to the next layer, or that layer's build state. Only the phrases under the current layer cycle on a timer.
- After about 45 seconds without an event, the motion calms and the card says "No update from the agent for 45 s". Steps stop advancing.
- On a failure, the animation stops at once. The failed layer shows its failure and fix, as the timeline does today.
- When a session ends without finishing its plan, the card says the agent stopped and names what was left.

### Data and delivery

Presence is driven by plan and progress events through the existing `ProjectLive` relay. No new transport is needed. Regions for existing layers come from the latest successful build's per-part and per-face bounds, which the inspection record already has. Regions for new layers come from the plan.

### Coordination with branches in flight

`design/floating-activity` (activity floating over the model, note box removed) and `feat/follow-agent-model` (open the model the agent changed) both touch `Workspace.tsx`. The card's position and the layers panel must fit whichever of them lands. The builder should merge or rebase onto them rather than redo them.

## Part 3: layers panel and timeline

The accepted mockup is `docs/design/2026-11-09-layers-and-timeline-mockup.html`.

### Layers panel

The layers panel sits on the right side of the workspace and shows what the model is made of. On a phone it moves below the canvas.

- **Rows:** one per layer of the revision being viewed. Each row shows its kind icon, name, a one-line value summary ("oval 86 × 72, rolled") and its state (ok, warning, failed, suppressed).
- **Selecting:** clicking a row highlights that layer on the canvas.
- **Hiding:** 👁 hides a layer in the view only. It saves nothing and is not the same as suppressing. Suppress, edit, rename, remove and reorder move here from today's chip timeline as row actions, and they keep saving revisions as they do now.
- **Change badges:** when a timeline dot is selected, rows show what that change did to them (new, edited, follows).

### Timeline

The timeline is a horizontal line under the model: one dot per change, oldest on the left.

- **Who made it:** agent changes are ✦. A person's own changes are ✋ with a dashed outline. An open plan's dot pulses.
- **Labels:** each dot shows the revision and a short label ("r5 · Oval rim").
- **Viewing the past:** clicking a dot, or dragging the marker to it, shows the model as of that change's last revision. The caption reads "Viewing r3 · 2 later changes not shown", later dots dim, and the layers panel follows. This is view only. Following live turns off until the person returns to the latest dot, matching today's rule for older revisions.
- **Details:** a line under the timeline shows the request text and a chip per touched layer.
- **No picture:** a dot whose last revision never built successfully is hollow, with "no build".
- **Older revisions:** revisions from before this work have no plan, so each becomes its own dot labelled with its revision number.

One dot per request, rather than per individual change, is my call. "Make the rim oval and gold" is one dot with two chips.

## Part 4: faster feedback

Today a build is about a minute from queue to result. The production demo took 57.9 s, including container start, about 8.5 s of interpreter start-up on a typical host, the model itself, and STEP, STL and GLB export. Presence works at that speed, but the model visibly catches up late.

**Target:** after the agent finishes a layer, its geometry is on screen within about 10 seconds on a typical host for a cup-sized model (about 8 layers). Full exports can wait until the plan finishes. The existing `view` build purpose already exports only the viewer mesh and facts, which is a likely starting point. The rest is the builder's to measure and choose: warm containers, building only from the changed layer, or skipping STEP mid-plan. Measure first and record the results in `docs/validation.md`.

## Order

Part 1 comes first, because parts 2 and 3 read its plans and design sheet. Then part 2 (visibility is the stated priority), then part 3. Part 4 is independent and can run alongside them.

## Calls I made (to check)

- Building may start with assumed sections, which are listed for confirmation afterwards.
- Undeclared code changes are refused, not flagged.
- In new models, `base()` returns `None` and all geometry lives in layers.
- A plan closes as "stopped" after the session ends or 30 minutes without activity. Only one plan is open per model.
- One timeline dot per request.
- 👁 in the layers panel hides in the view only. Suppress stays a saved action.
- Existing free-form models need one restructure change before agent edits. There is no automatic conversion.
- The appearance action makes colour a layer.
- The layers panel goes on the right; the timeline goes along the bottom.

## Left to the builder

- Tool names and exact schemas for the design sheet, plans and progress reports.
- How the ownership diff is implemented (the `actions/script.ts` parser already reads the steps section).
- Placeholder rendering in Three.js, motion amplitude and timing, within the honesty rules.
- How to reach the part 4 target.
- Any further catalog actions the tea cup and deal-toy examples need.

## Validation

- Worker tests for every refusal path: no design sheet, first source not in steps layout, no open plan, undeclared layer or shared-code change, a second open plan, and a plan from another project's session.
- Python tests for each new action.
- One end-to-end tea cup through MCP: questions, design sheet, framework, then three changes (a new part, a one-layer edit, a size change that ripples). Record the revisions and timeline in `docs/validation.md`.
- Interface checks at desktop and phone sizes in light and dark themes: an empty project with presence, an edit, a stall, a failure and a finished change.
- Part 4 timings measured in production, not only locally.
