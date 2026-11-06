import modeling from "../../skills/modeling/SKILL.md";
import manufacturing from "../../skills/manufacturing/SKILL.md";
import inspecting from "../../skills/inspecting/SKILL.md";
export const builtinSkills = [
  {
    id: "modeling",
    version: 3,
    title: "Model and verify",
    description:
      "Build123d modeling, revision handling and geometry validation.",
    content: modeling,
  },
  {
    id: "inspecting",
    version: 0,
    title: "Inspect and explain",
    description:
      "Read a build's exact measurements, report stability, embeds and dimensions, and point at faces.",
    content: inspecting,
  },
  {
    id: "manufacturing",
    version: 0,
    title: "Manufacturing handoff",
    description:
      "Revision-linked briefs, BOMs and production review requirements.",
    content: manufacturing,
  },
];
