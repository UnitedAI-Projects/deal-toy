# MantelMesh: a mesh modeller that runs in the browser

Status: proposed, 2026-11-10. Part of the [phase engines](2026-11-10-phase-engines-design.md): MantelMesh is the engine of the Concepts phase.

## Intent

The Concepts phase is where rough shape, proportion, depth, material and components get worked out before anything is dimensioned. That is polygon mesh modelling: free-form shapes made by pushing faces, edges and vertices around. It is not parametric CAD (MantelCAD), vector art (MantelArt) or documents (MantelPDF, MantelDocs). The product owner: "MantelMesh is different because it is a mesh modeller."

Every phase engine must run in the browser. The current MantelMesh is a Blender derivative, and Blender cannot run in a browser: its graphics rely on desktop OpenGL 3.x, it embeds Python, and it has no WebAssembly build. So MantelMesh becomes **a new mesh modeller built like the other backend apps**: Rust compiled to WebAssembly, on the same libraries, with a desktop app, a headless CLI and an MCP server from the same engine.

## Decisions already made

- MantelMesh is a polygon mesh modeller and the Concepts engine.
- It runs in the browser.
- It is built on the backend apps' stack, not three.js (decided 2026-11-10, "keep it based on the backend apps").
- It is not a Blender port.

## Goals

1. **Real mesh editing:** vertex, edge and face selection, with extrude, inset, bevel, loop cut and slide, knife, merge, dissolve, bridge, fill, and flip and recalculate normals. Also proportional editing, snapping, typed values (`G Z 10`), and undo and redo for every edit.
2. **Non-destructive modifiers in a stack:** subdivision surface (Catmull–Clark), mirror, array, solidify, bevel and boolean. They can be reordered and turned off, and are applied only on request.
3. **Objects and components:** an outliner of named objects with transforms, parenting and hide/show. Components map to the concept card's component list.
4. **Materials and looks:** PBR materials (base colour, metal, roughness, transmission for acrylic), presets for the deal-toy materials (satin nickel, brass, walnut, acrylic, marble), an environment light, and turntable and still renders for concept cards.
5. **Files:** a native format that keeps the editable mesh, modifiers, materials and objects. Import and export GLB and glTF, OBJ and STL. Export carries the evaluated modifiers.
6. **Inside Mantel:** the `craft-web-host` bridge (`mantelmesh:ready`, `:open`, `:save`, `:dirty`, `:failed`), so Mantel opens a concept's file and every save comes back as a new version.
7. **Agents use the same engine:** every operation is an engine command. The same commands serve the UI, a control channel, the `mantelmesh-cli` batch runner and an MCP server, so Mantel's agent can block out concepts headlessly.

## Non-goals (first release)

- Animation, rigging, physics, video editing, compositing and node-based shading.
- A production path tracer. Real-time PBR is enough for concept renders.
- `.blend` import or export.
- UV editing and texture painting beyond a simple automatic UV. _(my call)_
- Sculpting. It is the second release (see Order), unless the owner chooses it first.

## Anti-goals

- **A modeller that looks constrained but isn't:** operations that silently produce non-manifold or degenerate geometry. Every operation reports what it made, and a mesh check flags non-manifold edges, holes and flipped normals.
- **A UI that can't be driven:** an action in a panel that has no engine command, which the agent couldn't use.
- **Brand material without permission:** linking MantelCAD's `ui-kit`, `look` or `theme` crates (see Licensing).
- **A browser build that's a second-class port:** desktop and web must share the engine, commands and file format.

## How it is built

### Stack

- **UI:** egui and eframe, with controls from `craft-libs` (`craft-ui`, `craft-keymap`, `craft-menu`, `craft-settings`, `craft-dialogs`, `craft-i18n`), the same as MantelArt, MantelDocs and MantelPDF.
- **3D viewport:** MantelCAD's shared viewport crates (`viewport`, `viewport-gpu` on wgpu, `viewport-egui`). These are written for "the Craft apps" to share: orbit camera, projection and picking rays, offscreen pipelines. They run on WebGPU with a WebGL2 fallback.
- **Geometry:** MantelCAD's `geom` (vectors, frames, triangle meshes, BVH) for math, picking and evaluation output.
- **Automation:** `craft-web-host` and `craft-web-api` for the browser bridge and `window.mantelmesh`; MantelCAD's shared `control` and `mcp-server` crates for the control channel and MCP.
- **Web build:** Trunk producing a static site, like the siblings.

### Layers (same rule as the siblings: a crate depends only on lower layers)

| Layer | Crate                                            | Role                                                                                                                                                |
| ----- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0    | `mesh`                                           | The editable polygon mesh: vertices, edges, loops and faces with adjacency (a BMesh-style structure), validation and selection sets. No I/O, no UI. |
| L1    | `ops`                                            | Edit operations on `mesh`, each pure: input mesh and parameters in, new mesh and report out.                                                        |
| L1    | `modifiers`                                      | The modifier stack and its evaluation to a triangle mesh (`geom::Mesh`), cached per object.                                                         |
| L2    | `doc`                                            | The scene: objects, transforms, materials, modifier stacks, selection, and the undo journal.                                                        |
| L3    | `io`                                             | The native format (`.mmesh`: a JSON manifest plus binary mesh buffers in one zip), glTF/GLB, OBJ and STL.                                           |
| L4    | `engine`                                         | The session and the command registry. Everything is a command, and commands describe their own inputs.                                              |
| L5    | `ui-egui`, `mcp`                                 | The front end and the MCP tools.                                                                                                                    |
| apps  | `mantelmesh`, `mantelmesh-cli`, `mantelmesh-web` | Desktop, headless CLI (batch scripts, render, mcp) and the browser build.                                                                           |

### Licensing

MantelCAD's `ui-kit`, `look` and `theme` are under the SolidCraft Brand Licence. Using them in another program needs the SolidCraft maintainers' written permission, and the permission on record is for MantelCAD. MantelMesh therefore does **not** link them. It uses `craft-libs` (MIT OR Apache-2.0) for its UI and MantelCAD's MIT or Apache-licensed shared crates for the viewport, geometry, control and MCP. It needs its own name, icon and look: the teal-and-charcoal M from the current MantelMesh branding.

### In Mantel

- The Concepts board's cards become MantelMesh files. A card's preview is a render exported by the engine.
- "Open in MantelMesh" opens the card's `.mmesh` in `EngineFrame`. A save stores a new version and re-renders the card.
- The agent's "make three concepts" runs `mantelmesh-cli` in the isolated container, with no network and bounded time.
- The chosen concept's GLB is the ghost overlay in the Model phase.

## Order

1. **Core:** `mesh`, `ops` (extrude, inset, loop cut, bevel, merge), the `doc` undo journal, the native format and GLB export, and the CLI. Exhaustive tests on topology invariants.
2. **Browser app:** viewport, selection modes, transform tools with typed values, outliner, materials, and the web build with the host bridge. First usable release.
3. **Modifiers:** subdivision, mirror, array, solidify, bevel and boolean.
4. **Renders, MCP and Mantel wiring:** concept renders, MCP tools, and Concepts cards as MantelMesh files.
5. **Sculpting:** grab, draw, smooth, inflate and crease on subdivided meshes, using a BVH.

## Open for the owner

- **Repository:** `ichen27/MantelMesh` holds the Blender derivative. The new app needs a repository. GitHub names are case-insensitive, so `mantelmesh` can't sit beside it. The options are to replace the Blender code on a new default branch and archive it on a branch, or to use a new name.
- **Mesh editing or sculpting first?** This design puts mesh editing first.
- **The Blender-based desktop MantelMesh:** keep it as a separate desktop tool, or retire it.

## Validation

- Topology invariants (every edge has consistent loops, faces are closed, nothing dangles) are checked after every operation in tests, including randomised sequences of operations.
- Round trip: native save and load is identical; GLB export opens in other glTF viewers.
- The web build runs in Chrome, Safari and Firefox at desktop size, opens through the host bridge, and saves back.
- The same command script gives identical results in the CLI, the desktop app and the browser.
