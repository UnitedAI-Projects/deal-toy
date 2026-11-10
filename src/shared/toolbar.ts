/** The tool bar's groups, in the order the bar shows them. */
export const TOOLBAR_GROUPS = [
  "Sketch",
  "Create",
  "Modify",
  "Arrange",
  "Construct",
  "Custom",
] as const;
export type ToolbarGroup = (typeof TOOLBAR_GROUPS)[number];
