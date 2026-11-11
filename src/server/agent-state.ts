import { z } from "zod";

/** Model-produced state must retain the structures the phase UI reads.
 * Approval objects pass through unchanged for the existing people-only guard to compare.
 */
const object = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).passthrough();
const field = object({
  key: z.string(),
  section: z.string(),
  label: z.string(),
  required: z.boolean(),
  value: z.string(),
  state: z.enum(["answered", "assumed", "open", "na"]),
  source: z.enum(["you", "agent", "file"]),
  note: z.string().optional(),
  hint: z.string().optional(),
});
const file = object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().nonnegative(),
  field: z.string(),
  url: z.string().optional(),
  dataUrl: z.string().optional(),
});
export const agentState = object({
  brief: object({
    version: z.number().int().positive(),
    fields: z.array(field),
    files: z.array(file),
  }),
  art: object({
    kinds: z.record(
      z.string(),
      z.enum(["logo", "lettering", "illustration", "other"]),
    ),
  }),
  concepts: z.array(
    object({
      id: z.string(),
      name: z.string(),
      size: z.string(),
      materials: z.string(),
      components: z.string(),
      notes: z.string(),
      starred: z.boolean(),
      discarded: z.boolean(),
      createdAt: z.string(),
      image: z.string().optional(),
      mesh: z.string().optional(),
    }),
  ),
  docs: z.record(
    z.enum([
      "proof",
      "drawings",
      "parts",
      "assembly",
      "files",
      "inspection",
      "revisions",
    ]),
    object({ kind: z.string(), content: z.string() }),
  ),
  suppliers: z.array(
    object({
      id: z.string(),
      name: z.string(),
      scope: z.string(),
      quote: object({ price: z.string(), lead: z.string() }).optional(),
      messages: z.array(
        object({
          id: z.string(),
          from: z.enum(["us", "them"]),
          text: z.string(),
          at: z.string(),
        }),
      ),
    }),
  ),
});
