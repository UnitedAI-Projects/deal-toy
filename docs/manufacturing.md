# Manufacturing handoff

A CAD export is one component of a manufacturing package. The target handoff is an immutable release bundle referencing the same model revision across its contents.

| Deliverable          | Purpose                                                                                     | Initial foundation                        |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Python source        | Editable design intent and named dimensions                                                 | Versioned per model                       |
| STEP                 | Exact solid geometry for supplier exchange                                                  | Generated and downloadable                |
| STL                  | Triangulated geometry when the chosen process needs it                                      | Generated; 0.05 mm tessellation tolerance |
| GLB                  | Interactive visual review                                                                   | Generated and displayed                   |
| Geometry report      | Bounds, volume, solids, validity                                                            | Generated; not DFM approval               |
| Manufacturing brief  | Quantity, material/grade, finish, colour, artwork, critical tolerances, assembly, packaging | Versioned draft editor and MCP            |
| BOM                  | Component IDs, quantities, materials and purchased parts                                    | Versioned document via MCP                |
| Inspection plan      | Critical dimensions, visual standards, sample acceptance                                    | Versioned document via MCP                |
| Dimensioned drawings | Orthographic views, dimensions, tolerances, callouts, units, projection and revision        | Planned geometry-derived PDF adapter      |
| Release manifest     | Checksums and explicit reviewed/approved status for a complete bundle                       | Planned; artifact checksums exist         |

## Drawing implementation

Use a separate drawing adapter that takes a successful STEP or native build123d shape plus a versioned drawing specification. The text-to-cad `cadgen.eng_drawing` workflow is a reference: project views from the actual geometry, derive dimension values from geometric points, include hidden lines and centre marks, generate a PDF, then render and inspect the result for annotation collisions. Do not draw dimensions manually over a screenshot or invent values missing from the design.

Before integrating cadgen, pin a compatible release, test its build123d/OCCT dependency combination and retain required MIT attribution if code is reused. Keep the adapter replaceable; the application data model must not depend on the plugin's local paths, host UI, telemetry or warm-engine cache.

## Review and release

The proposed progression is draft → geometry verified → design reviewed → supplier confirmed → sample approved → released. These are separate attestations. The foundation records drafts only and has no production-approval action.

A model change makes previously approved drawings and briefs stale for the new revision; it must never silently transfer approval. A release should require all required files to reference the same revision, unresolved critical questions to be cleared, and a human reviewer identity and timestamp. Supplier communications, payments and orders remain separate actions.

For deal toys, pay particular attention to stability, finish quality, transparent-material appearance, engraving/logo fidelity, adhesive compatibility, handling, protective packaging, quantity and schedule. Validate processes with the selected manufacturer. A solid validity check does not prove strength, minimum wall thickness, tool accessibility, acceptable mould draft or achievable surface finish.
