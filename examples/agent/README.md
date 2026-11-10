# Phase agent example

These are synthetic local-development results, not customer data or production acceptance.

- [brief.json](brief.json): editable phase-state snapshot after setting the deal to Harbor acquires Northline, quantity to 50 units and budget to $120 per unit. It preserves open fields and has no approvals. Open in a JSON editor; import through the authenticated phases_save tool with the target project's current expectedVersion, or use the values as a manual example.
- [Desktop](../../docs/images/mantel-agent-desktop.png) and [phone](../../docs/images/mantel-agent-mobile.png): the built-in conversation and resulting brief. The history deliberately retains an earlier interrupted answer and its successful save receipt, followed by a completed request; a failed model answer does not mean its actions rolled back.
- [Configuration and validation](../../docs/agent.md): provider, limits, current capabilities and reproducible checks.

Observed 2026-11-10: real Workers AI guidance, first-draft initialization and multiple brief-field edits through the MacBook's forwarded development server. Reloading and reopening the project retained the saved answer and conversation. Desktop 1440×900 and phone 390×844 were visually inspected in Chromium. Safari/Firefox and production deployment were not tested in this acceptance pass.

Validation: 511 TypeScript tests passed, including 18 agent cases; 151 Python tests passed with 11 skipped; formatting, type checks, browser build, dependency audit and Worker dry-run packaging passed. The isolated legacy CAD container smoke test passed STEP/STL/GLB/inspection, measurement, PDF/DXF and font checks. Native engine CI remains separate.
