/**
 * Editable-target guard for keyboard event handlers. [S7-6]
 *
 * Prevents global keyboard shortcuts from firing when the user
 * is typing in an input, textarea, select, or contentEditable element.
 *
 * @module
 */

/**
 * Returns true if the event target is an editable element where
 * keyboard input should not trigger canvas shortcuts.
 *
 * @param target - The event target (typically `event.target`)
 * @returns true if the target is an input, textarea, select, or contentEditable
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.contentEditable === 'true'
  );
}
