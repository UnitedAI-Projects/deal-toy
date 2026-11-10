import { z } from "zod";
import type { Context } from "../core";

/**
 * A model's design sheet: the request, what the agent asked the person about each section (or
 * assumed), and the framework of layers the model is built from, each with the region it occupies.
 */
export const RESERVED_LAYER = "Framework";
export type Region = {
  min: [number, number, number];
  max: [number, number, number];
};
export type Section = {
  name: string;
  value: string;
  source: "answered" | "assumed";
};
export type LayerKind =
  "shape" | "modify" | "size" | "appearance" | "construction";
export type FrameworkLayer = {
  name: string;
  kind: LayerKind;
  params: string[];
  region: Region;
};
export type DesignSheet = {
  modelId: string;
  request: string;
  sections: Section[];
  framework: FrameworkLayer[];
  built: boolean;
  createdAt: string;
  updatedAt: string;
};

const mm = z.number().min(-2000).max(2000);
const point = z.tuple([mm, mm, mm]);
export const regionSchema: z.ZodType<Region> = z
  .object({ min: point, max: point })
  .strict()
  .refine((r) => r.min.every((v, k) => v < r.max[k]), {
    message: "min must be below max on every axis",
  });
export const sectionSchema: z.ZodType<Section> = z
  .object({
    name: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(2000),
    source: z.enum(["answered", "assumed"]),
  })
  .strict();
export const layerName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((name) => name !== RESERVED_LAYER, {
    message: `The layer name ${RESERVED_LAYER} is reserved for the model's PARAMS`,
  });
export const layerKind = z.enum([
  "shape",
  "modify",
  "size",
  "appearance",
  "construction",
]);
export const layerSchema: z.ZodType<FrameworkLayer> = z
  .object({
    name: layerName,
    kind: layerKind,
    params: z.array(z.string().min(1).max(80)).max(40).default([]),
    region: regionSchema,
  })
  .strict();

/** Refuses repeated names in a list of named items, naming the repeats. */
export function uniqueNames<T extends { name: string }>(what: string) {
  return (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const { name } of items) (seen.has(name) ? repeated : seen).add(name);
    if (repeated.size)
      ctx.addIssue({
        code: "custom",
        message: `${what} names must be unique: ${[...repeated].join(", ")}`,
      });
  };
}
export const sectionsSchema = z
  .array(sectionSchema)
  .min(1)
  .max(40)
  .superRefine(uniqueNames<Section>("Section"));
export const frameworkSchema = z
  .array(layerSchema)
  .min(1)
  .max(100)
  .superRefine(uniqueNames<FrameworkLayer>("Layer"));

type SheetRow = {
  model_id: string;
  request: string;
  sections: string;
  framework: string;
  built: number;
  created_at: string;
  updated_at: string;
};

export function parseSheet(row: SheetRow): DesignSheet {
  return {
    modelId: row.model_id,
    request: row.request,
    sections: JSON.parse(row.sections) as Section[],
    framework: JSON.parse(row.framework) as FrameworkLayer[],
    built: row.built === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The model's design sheet, or null. Callers check access to the model first. */
export async function sheetFor(
  c: Context,
  modelId: string,
): Promise<DesignSheet | null> {
  const row = await c.env.DB.prepare(
    "SELECT * FROM design_sheets WHERE model_id=?",
  )
    .bind(modelId)
    .first<SheetRow>();
  return row ? parseSheet(row) : null;
}

/** Replaces sections by name and appends new ones, keeping the sheet's order. */
export function mergeSections(
  current: Section[],
  updates: Section[],
): Section[] {
  const byName = new Map(updates.map((s) => [s.name, s]));
  const merged = current.map((s) => byName.get(s.name) ?? s);
  const known = new Set(current.map((s) => s.name));
  return [...merged, ...updates.filter((s) => !known.has(s.name))];
}
