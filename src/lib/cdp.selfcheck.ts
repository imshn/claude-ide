/**
 * Self-check for CDP helpers. Run:
 *   npx esbuild src/lib/cdp.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/c.cjs && node /tmp/c.cjs
 */
import assert from 'node:assert/strict'
import { fileUrl, formatValue, isUserFrame, pathFromUrl, usefulScopes } from './cdp'

// --- File URLs --------------------------------------------------------------
{
  assert.equal(fileUrl('/a/b/app.js'), 'file:///a/b/app.js')
  // V8 reports percent-encoded URLs; a breakpoint on a path with a space only
  // resolves if we encode it the same way.
  assert.equal(fileUrl('/a/my project/app.js'), 'file:///a/my%20project/app.js')
  assert.equal(fileUrl('a/b.js'), 'file:///a/b.js', 'relative paths are made absolute')

  assert.equal(pathFromUrl('file:///a/my%20project/app.js'), '/a/my project/app.js')
  assert.equal(pathFromUrl('node:internal/modules/cjs/loader'), 'node:internal/modules/cjs/loader')
  // Round trip is the property that actually matters.
  for (const p of ['/x/y.js', '/x/a b/c.ts', '/x/ünïcode.js']) {
    assert.equal(pathFromUrl(fileUrl(p)), p)
  }
}

// --- Value rendering --------------------------------------------------------
{
  assert.equal(formatValue({ type: 'string', value: 'hi' }), '"hi"')
  assert.equal(formatValue({ type: 'number', value: 42 }), '42')
  assert.equal(formatValue({ type: 'boolean', value: false }), 'false')
  assert.equal(formatValue({ type: 'undefined' }), 'undefined')
  assert.equal(formatValue({ type: 'object', subtype: 'null' }), 'null', 'null is not "Object"')
  assert.equal(formatValue({ type: 'object', subtype: 'array', description: 'Array(3)' }), 'Array(3)')
  assert.equal(formatValue({ type: 'object', className: 'Map', description: 'Map(2)' }), 'Map(2)')
  // A multi-line function body would wreck a one-line tree row.
  assert.equal(formatValue({ type: 'function', description: 'function add(a, b) {\n  return a+b\n}' }), 'function add(a, b) {')
  assert.equal(formatValue({ type: 'number', unserializableValue: 'NaN' }), 'NaN')
  assert.equal(formatValue(undefined), 'undefined')
}

// --- Scopes -----------------------------------------------------------------
{
  const scopes = [
    { type: 'global', object: { type: 'object', objectId: '1' } },
    { type: 'closure', object: { type: 'object', objectId: '2' } },
    { type: 'local', object: { type: 'object', objectId: '3' } },
    { type: 'script', object: { type: 'object' } },
  ]
  const out = usefulScopes(scopes)
  // Global is thousands of entries and never what you are looking at.
  assert.deepEqual(out.map((s) => s.type), ['local', 'closure'])
  assert.ok(out.every((s) => s.object.objectId), 'scopes with no objectId cannot be expanded')
}

// --- Stack filtering --------------------------------------------------------
{
  assert.equal(isUserFrame('file:///repo/src/auth.ts'), true)
  assert.equal(isUserFrame('node:internal/modules/cjs/loader'), false)
  assert.equal(isUserFrame('file:///repo/node_modules/express/index.js'), false)
  assert.equal(isUserFrame(''), false)
}

console.log('cdp helpers: all checks passed')
