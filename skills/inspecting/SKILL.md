---
name: inspecting
description: Read a Deal Toy build's exact measurements, report what matters for deal toys, and point the team at faces and parts while explaining them.
---

1. Every succeeded build has an inspection record measured by OCCT, never by the mesh. After `builds_get` reports `succeeded`, call `inspect_get` with the build's id. Ask for the sections you need (`stability`, `embeds`, `dimensions`, `pairs`, `holes`, `parts`, `faces`, `warnings`) so results stay small. Face and part numbers in the record are indices within that build only.
2. Report, with values and units, the things that decide whether a deal toy works:
   - **Stability:** the tip angle in degrees and its direction. If `uniform_density` is true, say the result assumes uniform density and treat stability as unknown, not as a pass. Ask for `MATERIALS` densities when they are missing.
   - **Embeds:** for each declared embed, whether it is fully contained and its wall to the outside in mm.
   - **Declared dimensions:** each value, and any with `matches_param: false`. Those mean the geometry does not match the parameter that is supposed to drive it.
   - **Overlaps:** any part pair with `overlap_volume > 0` that is not a declared embed.
   - **Warnings:** every warning, word for word.
3. When you talk about a specific face or part, call `view_highlight` with your session, the build's id, the face indices or part labels, and a one-sentence message, so the people watching see what you mean.
4. Measurements are evidence, not approval. A valid record does not mean the toy can be manufactured. Say which requirements in the brief are still unchecked, and leave `manufacturing_approval` to people.
5. Never invent supplier limits such as a minimum acrylic wall or a minimum engraving depth. When the brief does not give one, ask, or record it as an open question in a document.
