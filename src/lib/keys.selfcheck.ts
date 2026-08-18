/**
 * Self-check for the keybinding table. Run:
 *   npx esbuild src/lib/keys.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/k.cjs && node /tmp/k.cjs
 */
import assert from 'node:assert/strict'
import { BINDINGS, comboOf, findBinding, groupedBindings, normalizeKey, prettyKeys } from './keys'

const ev = (o: Partial<KeyboardEvent>) => o as KeyboardEvent

// --- Key normalisation ------------------------------------------------------
{
  assert.equal(normalizeKey(ev({ code: 'KeyP', key: 'p' })), 'p')
  assert.equal(normalizeKey(ev({ code: 'Digit4', key: '4' })), '4')
  assert.equal(normalizeKey(ev({ code: 'Comma', key: ',' })), ',')
  assert.equal(normalizeKey(ev({ code: 'ArrowRight', key: 'ArrowRight' })), 'right')

  // The reason e.code is used at all: on macOS ⌥F reports key 'ƒ', and ⇧P
  // reports 'P'. Position-based codes survive both.
  assert.equal(normalizeKey(ev({ code: 'KeyF', key: 'ƒ' })), 'f')
  assert.equal(normalizeKey(ev({ code: 'KeyP', key: 'P' })), 'p')
}

// --- Combos -----------------------------------------------------------------
{
  assert.equal(comboOf(ev({ code: 'KeyP', key: 'p', metaKey: true })), 'mod+p')
  assert.equal(comboOf(ev({ code: 'KeyP', key: 'P', metaKey: true, shiftKey: true })), 'mod+shift+p')
  assert.equal(
    comboOf(ev({ code: 'KeyF', key: 'ƒ', altKey: true, shiftKey: true })),
    'alt+shift+f',
    'modifier order is fixed so lookups match',
  )
  assert.equal(comboOf(ev({ code: 'Backquote', key: '`', ctrlKey: true })), 'ctrl+`')
}

// --- Display ----------------------------------------------------------------
{
  assert.equal(prettyKeys('mod+shift+p'), '⌘⇧P')
  assert.equal(prettyKeys('alt+up'), '⌥↑')
  assert.equal(prettyKeys('mod+k mod+s'), '⌘K ⌘S', 'chords keep their space')
  assert.equal(prettyKeys('mod+,'), '⌘,')
}

// --- Lookup and context -----------------------------------------------------
{
  assert.equal(findBinding('mod+p', 'always')?.id, 'quick-open')

  // Review shortcuts must not fire outside the review surface, or ⌘Z would
  // fight the editor's own undo.
  assert.equal(findBinding('mod+z', 'changes')?.id, 'undo-review')
  assert.equal(findBinding('mod+z', 'always'), undefined)

  // Monaco owns these; we must not also claim them.
  assert.equal(findBinding('mod+d', 'always'), undefined, 'multi-cursor stays with Monaco')
  assert.equal(findBinding('mod+f', 'editor'), undefined)
  assert.equal(findBinding('mod+s', 'always'), undefined)
}

// --- Table hygiene ----------------------------------------------------------
{
  // Two of our own handlers on one combo means one silently never runs.
  const own = BINDINGS.filter((b) => !b.native && (b.when ?? 'always') !== 'editor')
  const seen = new Map<string, string>()
  for (const b of own) {
    const key = `${b.keys}|${b.when ?? 'always'}`
    const prior = seen.get(key)
    // Aliases are allowed only when they run the same thing.
    if (prior) {
      assert.ok(
        b.label === BINDINGS.find((x) => x.id === prior)!.label,
        `${b.keys} is claimed by both ${prior} and ${b.id} with different actions`,
      )
    }
    seen.set(key, b.id)
  }

  assert.ok(BINDINGS.every((b) => b.label && b.group && b.keys))
  assert.ok(groupedBindings().some((g) => g.group === 'Multiple cursors'))
  assert.equal(groupedBindings('cursor').every((g) => g.items.length > 0), true)
  assert.equal(groupedBindings('zzzznope').length, 0)
}

console.log('keybindings: all checks passed')
