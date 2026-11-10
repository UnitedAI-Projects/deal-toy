---
name: inspecting
description: Read a Deal Toy build's exact measurements, set up and report the model's checks, and point the team at faces and parts while explaining them.
---

1. Every succeeded build has an inspection record measured by OCCT, never by the mesh. After `builds_get` reports `succeeded`, call `inspect_get` with the build's id. Ask for the sections you need (`stability`, `embeds`, `dimensions`, `pairs`, `holes`, `parts`, `faces`, `joints`, `warnings`) so results stay small. Face and part numbers in the record are indices within that build only.
2. Report, with values and units, the things that decide whether a deal toy works:
   - **Stability:** the tip angle in degrees and its direction. If `uniform_density` is true, say the result assumes uniform density and treat stability as unknown, not as a pass. Ask for `MATERIALS` densities when they are missing.
   - **Embeds:** for each declared embed, whether it is fully contained and its wall to the outside in mm.
   - **Declared dimensions:** each value, and any with `matches_param: false`. Those mean the geometry does not match the parameter that is supposed to drive it.
   - **Overlaps:** any part pair with `overlap_volume > 0` that is not a declared embed.
   - **Warnings:** every warning, word for word.
3. When you talk about a specific face or part, call `view_highlight` with your session, the build's id, the face indices or part labels, and a one-sentence message, so the people watching see what you mean.
4. Measurements are evidence, not approval. A valid record does not mean the toy can be manufactured. Say which requirements in the brief are still unchecked, and leave `manufacturing_approval` to people.
5. Never invent supplier limits such as a minimum acrylic wall or a minimum engraving depth. When the brief does not give one, ask, or record it as an open question in a document.
6. **Checks** are the model's saved requirements, shared with the team. Set them up from the brief:
   - Call `checks_list` for the current list, its `version` and the `presets` (ordinary checks for deal-toy processes, every limit unset).
   - Save with `checks_save`, passing `expectedVersion`. A 409 means someone changed the list: read it again and redo your change on top. Never drop a person's checks to make yours fit.
   - Fill a limit only with a number the brief or a person states. Otherwise leave it `null`; it shows as "TBD: confirm with your maker".
   - To check picked faces, read their indices with `inspect_get` and pass `{"index": n}` with `buildId`; Mantel stores a reference that follows the face across rebuilds.
7. After every build, call `checks_results`. Report each failure with its value and limit, and each unknown with its reason, word for word. `previous` says what the last revision measured; say what changed. A result with `measure` set needs `inspect_measure`: call it with the result's `a` and `b`, poll `builds_get` with its `jobId`, then read `checks_results` again. Measure jobs count toward the daily build limit, so queue only the ones a check or a person needs.
8. Unknown is never a pass. A disabled check, a missing density, a face that needs re-picking or an unmeasured gap is unknown until it is resolved, and all-pass checks are still not manufacturing approval.
9. **Joints** say how parts attach: `joints` in the record lists, for each moving `part`, the part it attaches `to`, its kind (`rigid`, `linear` or `revolute`), axis, range and current value. A placement is a declared dimension with `joint` set, in mm or degrees. Set it with `models_set_parameter` on its `param`, never by editing geometry. A joint warning, such as a part moved by two joints, means the viewer cannot move that part; fix the script. Exploding or moving parts in the viewer is the person's view only and changes no measurement.
