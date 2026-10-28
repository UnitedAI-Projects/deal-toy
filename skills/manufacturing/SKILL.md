---
name: manufacturing
description: Prepare a draft manufacturing handoff for a specific CAD revision and identify information still needed from the maker or customer.
---

1. Read the brief, model revision, build facts and existing documents. Choose the exact successful model revision that the handoff describes.
2. Write a manufacturing brief with quantity, material and grade, intended process, finish/colour, artwork, critical dimensions/tolerances, assembly/adhesives, inspection criteria, packaging and shipping. Mark unknown values TBD; do not invent supplier capabilities or tolerances.
3. Add a BOM for multipart products, including part identifiers, quantities, materials and purchased components. Add an inspection plan for critical dimensions and appearance.
4. Dimensioned engineering drawings must derive views and dimensions from the model, state units/projection/revision, and be visually reviewed. The first application release does not generate drawing PDFs; record this gap rather than calling a preview a drawing.
5. Identify process-specific DFM checks and obtain supplier feedback. Review a physical sample and artwork proof before a production commitment.
6. Save drafts with `documents_add`, linked to `revisionId`. Report which requirements remain unresolved and which files have been inspected. A document is complete only when its contents match the selected model revision; draft status never implies supplier approval.

Use STEP for geometric exchange; request the supplier's preferred formats. Mesh exports alone do not communicate finish, tolerance or assembly requirements. Contacting suppliers, placing orders and approving production are separate user-authorized actions outside these tools.
