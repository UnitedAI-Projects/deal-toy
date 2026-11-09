import type { CheckKind, CheckLimit, CheckTarget } from "../../shared/checks";
import type { InspectRecord } from "../../shared/inspect-types";

export type CheckDraft = {
  name: string;
  kind: CheckKind;
  enabled: true;
  target: CheckTarget;
  limit: CheckLimit;
};
export type CheckPreset = {
  id: string;
  name: string;
  description: string;
  checks: CheckDraft[];
};

const draft = (
  name: string,
  kind: CheckKind,
  target: CheckTarget,
  limit: CheckLimit,
): CheckDraft => ({ name, kind, enabled: true, target, limit });

/**
 * Process presets only add ordinary checks. Every limit is left unset: Mantel does not invent a
 * supplier's minimums, so each shows "TBD: confirm with your maker" until a person enters it.
 */
export function presetsFor(record: InspectRecord | null): CheckPreset[] {
  const label = (index: number) => record?.parts[index]?.label ?? "";
  const embeds = record?.embeds ?? [];
  const engraved = (record?.dimensions ?? []).filter((d) =>
    /engrav/i.test(d.name),
  );
  const pulled = record?.draft ?? [];
  return [
    {
      id: "acrylic-embedment",
      name: "Acrylic embedment",
      description:
        "Stands without tipping, every declared embed keeps a wall of acrylic, and no parts overlap except the embeds.",
      checks: [
        draft("Stands up", "stability", {}, { min: null }),
        ...embeds.map((e) =>
          draft(
            `${label(e.part)} wall`,
            "embed_wall",
            { part: label(e.part) },
            { min: null },
          ),
        ),
        draft("No overlaps", "no_overlap", { all: true }, {}),
      ],
    },
    {
      id: "engraved-plaque",
      name: "Engraved plaque",
      description:
        "Each declared engraving depth is within tolerance, and the piece fits its envelope.",
      checks: [
        ...engraved.map((d) =>
          draft(
            d.name,
            "dimension",
            { dimension: d.name },
            {
              nominal: null,
              tolerance: null,
            },
          ),
        ),
        draft("Fits the envelope", "envelope", {}, { size: null }),
      ],
    },
    {
      id: "moulded-part",
      name: "Moulded part",
      description:
        "Every part with a pull direction has draft on its walls, and no parts overlap.",
      checks: [
        ...pulled.map((d) =>
          draft(
            `${label(d.part)} draft`,
            "draft",
            { part: label(d.part) },
            { min: null },
          ),
        ),
        draft("No overlaps", "no_overlap", { all: true }, {}),
      ],
    },
  ];
}
