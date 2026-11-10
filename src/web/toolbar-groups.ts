import { TOOLBAR_GROUPS } from "../shared/toolbar";
import type { ToolbarAction } from "./Toolbar";

/** The tool bar's groups, each with its featured buttons and the rest for its ▾ list. */
export function toolbarGroups(actions: ToolbarAction[]) {
  // A group with no actions is not shown.
  return TOOLBAR_GROUPS.map((group) => {
    const inGroup = actions.filter((a) => (a.group ?? a.category) === group);
    return {
      group,
      featured: inGroup.filter((a) => a.featured),
      more: inGroup.filter((a) => !a.featured),
    };
  }).filter((g) => g.featured.length || g.more.length);
}

/**
 * Actions matching a query, case-insensitively: title-prefix matches first, then other title
 * matches, then id and summary matches. An empty query matches nothing.
 */
export function searchActions(actions: ToolbarAction[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (a: ToolbarAction) => {
    const title = a.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    if (a.id.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q))
      return 2;
    return -1;
  };
  return actions
    .map((a, i) => ({ a, i, r: rank(a) }))
    .filter((x) => x.r >= 0)
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}
