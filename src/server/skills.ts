import modeling from "../../skills/modeling/SKILL.md";
import manufacturing from "../../skills/manufacturing/SKILL.md";
import inspecting from "../../skills/inspecting/SKILL.md";
export const builtinSkills = [
  {
    id: "modeling",
    version: 5,
    title: "Model and verify",
    description:
      "Build123d modeling, revision handling and geometry validation.",
    content: modeling,
  },
  {
    id: "inspecting",
    version: 2,
    title: "Inspect and check",
    description:
      "Read a build's exact measurements, set up and report the model's checks, and point at faces.",
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
