/**
 * Where a step dropped on another chip goes, as steps_move's `after`: null for the start, the name of
 * the step it now follows, or undefined when nothing moves. Moving right lands after the target,
 * moving left lands before it.
 */
export function moveAfter(
  names: string[],
  dragged: string,
  target: string,
): string | null | undefined {
  const from = names.indexOf(dragged);
  const to = names.indexOf(target);
  if (from === -1 || to === -1 || from === to) return undefined;
  const rest = names.filter((n) => n !== dragged);
  const at = from < to ? rest.indexOf(target) + 1 : rest.indexOf(target);
  return at === 0 ? null : rest[at - 1];
}
