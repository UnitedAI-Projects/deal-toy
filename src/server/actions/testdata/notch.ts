import type { ActionRecord } from "../catalog";

/** The record the engine reads from the finger-notch example action, as stored once ready. */
export const notchRecord = (key = "finger-notch@1"): ActionRecord => ({
  id: key,
  version: Number(key.split("@")[1]),
  title: "Finger notch",
  category: "Custom",
  summary: "Cut a rounded finger notch into a face so a lid can be lifted.",
  description: "Use on the front edge of a lid or drawer.",
  inputs: {
    type: "object",
    properties: {
      on: { "x-ref": "face", description: "Face the notch opens onto" },
      width: {
        type: "number",
        description: "Notch width",
        unit: "mm",
        minimum: 8,
        maximum: 40,
      },
      depth: {
        type: "number",
        description: "How far the notch cuts in",
        unit: "mm",
        minimum: 1,
        maximum: 10,
        default: 3,
      },
    },
    required: ["on", "width"],
    additionalProperties: false,
  },
  selections: [{ input: "on", kind: "face", min: 1, max: 1 }],
  creates: { notch: "The curved notch face" },
  failures: [
    {
      code: "invalid_input",
      explanation: "An input is wrong.",
      fix: "Correct it.",
    },
  ],
  preview: "none",
  example: `m.custom("Lid notch", action="${key}", on=m.face("Lid", "front"), width=18)`,
});
