/**
 * Keyboard bindings, in one place.
 *
 * The handler and the shortcuts reference read the same table, so the help can
 * never claim a key that does nothing. Combos are canonical strings —
 * `mod+shift+p` — with `mod` meaning ⌘ here and Ctrl elsewhere.
 */

export type When = 'always' | 'editor' | 'changes'

export interface Binding {
  id: string
  keys: string
  label: string
  group: string
  /** Where it applies. `editor` entries are handled by Monaco, listed for reference. */
  when?: When
  /** Monaco's own binding, listed but not implemented by us. */
  native?: boolean
}

/**
 * `e.key` is unreliable with Option held on macOS — ⌥F reports `ƒ` — so letters
 * and digits come from `e.code`, which is layout-position based.
 */
export function normalizeKey(e: KeyboardEvent): string {
  const code = e.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const named: Record<string, string> = {
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Space: 'space',
    Enter: 'enter', Escape: 'escape', Tab: 'tab', Backspace: 'backspace',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  }
  return named[code] ?? e.key.toLowerCase()
}

/** Canonical combo for an event. Modifier order is fixed so lookups match. */
export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('mod')
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(normalizeKey(e))
  return parts.join('+')
}

const SYMBOL: Record<string, string> = {
  mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧',
  enter: '⏎', escape: 'esc', tab: '⇥', backspace: '⌫', space: 'space',
  up: '↑', down: '↓', left: '←', right: '→',
}

/** `mod+shift+p` -> `⌘⇧P`, and chords `mod+k mod+s` -> `⌘K ⌘S`. */
export function prettyKeys(keys: string): string {
  return keys
    .split(' ')
    .map((chord) =>
      chord
        .split('+')
        .map((p) => SYMBOL[p] ?? (p.length === 1 ? p.toUpperCase() : p))
        .join(''),
    )
    .join(' ')
}

export const BINDINGS: Binding[] = [
  // --- Navigation ---
  { id: 'quick-open', keys: 'mod+p', label: 'Go to file…', group: 'Navigation' },
  { id: 'palette', keys: 'mod+shift+p', label: 'Command palette', group: 'Navigation' },
  { id: 'palette-alt', keys: 'mod+k', label: 'Command palette', group: 'Navigation' },
  { id: 'explorer', keys: 'mod+shift+e', label: 'Show Explorer', group: 'Navigation' },
  { id: 'search-view', keys: 'mod+shift+f', label: 'Show Search', group: 'Navigation' },
  { id: 'git-view', keys: 'mod+shift+g', label: 'Show Source control', group: 'Navigation' },
  { id: 'changes-view', keys: 'mod+shift+d', label: 'Show Changes', group: 'Navigation' },
  { id: 'view-1', keys: 'mod+1', label: 'Show Explorer', group: 'Navigation' },
  { id: 'view-2', keys: 'mod+2', label: 'Show Changes', group: 'Navigation' },
  { id: 'view-3', keys: 'mod+3', label: 'Show Source control', group: 'Navigation' },
  { id: 'view-4', keys: 'mod+4', label: 'Show API', group: 'Navigation' },
  { id: 'next-tab', keys: 'mod+alt+right', label: 'Next tab', group: 'Navigation' },
  { id: 'prev-tab', keys: 'mod+alt+left', label: 'Previous tab', group: 'Navigation' },

  // --- Workspace ---
  { id: 'close-tab', keys: 'mod+w', label: 'Close tab', group: 'Workspace' },
  { id: 'toggle-sidebar', keys: 'mod+b', label: 'Toggle sidebar', group: 'Workspace' },
  { id: 'terminal', keys: 'mod+j', label: 'Toggle terminal', group: 'Workspace' },
  { id: 'terminal-alt', keys: 'ctrl+`', label: 'Toggle terminal', group: 'Workspace' },
  { id: 'open-folder', keys: 'mod+o', label: 'Open folder…', group: 'Workspace' },
  { id: 'settings', keys: 'mod+,', label: 'Settings', group: 'Workspace' },
  { id: 'shortcuts', keys: 'mod+k mod+s', label: 'Keyboard shortcuts', group: 'Workspace' },

  // --- Claude ---
  { id: 'send-selection', keys: 'mod+l', label: 'Send selection to chat', group: 'Claude', when: 'editor' },
  { id: 'focus-chat', keys: 'mod+i', label: 'Focus the chat input', group: 'Claude' },
  { id: 'stop', keys: 'mod+escape', label: 'Stop Claude', group: 'Claude' },

  // --- Review ---
  { id: 'undo-review', keys: 'mod+z', label: 'Undo review decision', group: 'Review', when: 'changes' },
  { id: 'redo-review', keys: 'mod+shift+z', label: 'Redo review decision', group: 'Review', when: 'changes' },
  { id: 'accept-all', keys: 'mod+enter', label: 'Accept all changes', group: 'Review', when: 'changes' },
  { id: 'refresh-changes', keys: 'mod+r', label: 'Refresh changes', group: 'Review' },

  // --- Editing: Monaco's own, listed so the reference is complete ---
  { id: 'save', keys: 'mod+s', label: 'Save', group: 'Editing', when: 'editor', native: true },
  { id: 'format', keys: 'alt+shift+f', label: 'Format document', group: 'Editing', when: 'editor' },
  { id: 'find', keys: 'mod+f', label: 'Find', group: 'Editing', when: 'editor', native: true },
  { id: 'replace', keys: 'mod+alt+f', label: 'Replace', group: 'Editing', when: 'editor', native: true },
  { id: 'comment', keys: 'mod+/', label: 'Toggle line comment', group: 'Editing', when: 'editor', native: true },
  { id: 'delete-line', keys: 'mod+shift+k', label: 'Delete line', group: 'Editing', when: 'editor', native: true },
  { id: 'move-line-up', keys: 'alt+up', label: 'Move line up', group: 'Editing', when: 'editor', native: true },
  { id: 'move-line-down', keys: 'alt+down', label: 'Move line down', group: 'Editing', when: 'editor', native: true },
  { id: 'copy-line-up', keys: 'alt+shift+up', label: 'Copy line up', group: 'Editing', when: 'editor', native: true },
  { id: 'copy-line-down', keys: 'alt+shift+down', label: 'Copy line down', group: 'Editing', when: 'editor', native: true },
  { id: 'indent', keys: 'mod+]', label: 'Indent line', group: 'Editing', when: 'editor', native: true },
  { id: 'outdent', keys: 'mod+[', label: 'Outdent line', group: 'Editing', when: 'editor', native: true },
  { id: 'goto-line', keys: 'ctrl+g', label: 'Go to line…', group: 'Editing', when: 'editor', native: true },
  { id: 'rename', keys: 'f2', label: 'Rename symbol', group: 'Editing', when: 'editor', native: true },

  // --- Multiple cursors ---
  { id: 'cursor-below', keys: 'mod+alt+down', label: 'Add cursor below', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'cursor-above', keys: 'mod+alt+up', label: 'Add cursor above', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'add-next', keys: 'mod+d', label: 'Add selection to next match', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'select-all-occurrences', keys: 'mod+shift+l', label: 'Select all occurrences', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'skip-match', keys: 'mod+k mod+d', label: 'Skip to next match', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'cursor-line-ends', keys: 'alt+shift+i', label: 'Cursor at end of each selected line', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'alt-click', keys: 'alt+click', label: 'Add a cursor', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'column-select', keys: 'alt+shift+drag', label: 'Column (box) selection', group: 'Multiple cursors', when: 'editor', native: true },
  { id: 'undo-cursor', keys: 'mod+u', label: 'Undo last cursor', group: 'Multiple cursors', when: 'editor', native: true },
]

/** Bindings we handle ourselves; the rest belong to Monaco. */
export const ownBindings = () => BINDINGS.filter((b) => !b.native)

export function findBinding(combo: string, ctx: When): Binding | undefined {
  return ownBindings().find(
    (b) => b.keys === combo && (b.when ?? 'always') !== 'editor' && (!b.when || b.when === 'always' || b.when === ctx),
  )
}

export function groupedBindings(query = ''): { group: string; items: Binding[] }[] {
  const q = query.trim().toLowerCase()
  const match = (b: Binding) =>
    !q || b.label.toLowerCase().includes(q) || prettyKeys(b.keys).toLowerCase().includes(q) || b.group.toLowerCase().includes(q)

  const groups = new Map<string, Binding[]>()
  for (const b of BINDINGS) {
    if (!match(b)) continue
    groups.set(b.group, [...(groups.get(b.group) ?? []), b])
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }))
}
