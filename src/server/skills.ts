import modeling from "../../skills/modeling/SKILL.md";
import manufacturing from "../../skills/manufacturing/SKILL.md";
export const builtinSkills = [
  {
    id: "modeling",
    version: 0,
    title: "Model and verify",
    description:
      "Build123d modeling, revision handling and geometry validation.",
    content: modeling,
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
