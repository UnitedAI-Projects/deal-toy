---
name: modeling
description: Create or revise a build123d solid in a Deal Toy project and verify its exported geometry.
---

1. Read the project brief and current revision with `projects_get`. Resolve missing dimensions that affect fit; label aesthetic choices as assumptions.
2. Create a model with `models_create` if needed. Write Python with `import build123d as bd` and a `build()` function returning a solid Shape. Use millimetres, Z up, named dimensions and labelled parts. Keep scripts deterministic and self-contained.
3. Save with `models_save` using the revision you read as `expectedRevision`. On conflict, read the new source and reconcile the user's change before saving.
4. Call `models_build` once. Poll `builds_get` until succeeded or failed. A failed build has no validated output. Fix the cause rather than silently removing requested features.
5. Inspect bounds, solid count and volume. Open the GLB preview for appearance and arrangement; use geometry measurements for numerical requirements. STEP retains exact exchange geometry, STL is a mesh, GLB is a preview, and Python remains the editable source.
6. Record checks, assumptions and unresolved requirements in a revision-linked document. A valid solid is not a manufacturing approval.

The runtime has no network access, credentials, package installation or persistent filesystem. It accepts one Python source, up to 100 KB. Use built-in dependencies only; heavy builds have bounded runtime and output size. Scripts cannot access other projects.
