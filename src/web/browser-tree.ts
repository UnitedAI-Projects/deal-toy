import { ORIGIN_ITEMS } from "./origin";

export type BrowserFolder = {
  folder: "Origin" | "Bodies" | "Construction";
  items: { id: string; label: string }[];
};

/** The Browser card's folders: the origin always, then bodies and construction planes if any. */
export function browserTree(input: {
  parts: string[];
  steps: { name: string; action: string }[];
}): BrowserFolder[] {
  const folders: BrowserFolder[] = [
    {
      folder: "Origin",
      items: ORIGIN_ITEMS.map((item) => ({ id: item, label: item })),
    },
    {
      folder: "Bodies",
      items: input.parts.map((label) => ({ id: label, label })),
    },
    {
      folder: "Construction",
      items: input.steps
        .filter((s) => s.action === "plane")
        .map((s) => ({ id: s.name, label: s.name })),
    },
  ];
  return folders.filter((f) => f.folder === "Origin" || f.items.length);
}
