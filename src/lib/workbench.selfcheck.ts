/**
 * Self-check for chat autocomplete and Postman import. Run:
 *   npx esbuild src/lib/workbench.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/wb.cjs && node /tmp/wb.cjs
 */
import assert from 'node:assert/strict'
import { applyCompletion, detectTrigger, expandMentions, rank, scoreMatch } from './mentions'
import {
  countRequests,
  interpolate,
  parseCollection,
  parseEnvironment,
  urlOf,
} from './postman'

// --- Trigger detection ------------------------------------------------------
{
  const t = (s: string, caret = s.length) => detectTrigger(s, caret)

  assert.deepEqual(t('@auth'), { kind: 'file', query: 'auth', start: 0 })
  assert.deepEqual(t('look at @src/a.ts'), { kind: 'file', query: 'src/a.ts', start: 8 })
  assert.equal(t('@auth then more')?.kind, undefined, 'a space closes the mention')
  // Emails are the classic false positive.
  assert.equal(t('mail me at shaan@example.com'), null, '@ inside a word is not a trigger')
  assert.deepEqual(t('(@a'), { kind: 'file', query: 'a', start: 1 }, 'brackets open a mention')

  assert.deepEqual(t('/cave'), { kind: 'skill', query: 'cave', start: 0 })
  assert.deepEqual(t('  /cave'), { kind: 'skill', query: 'cave', start: 2 })
  assert.equal(t('/')?.kind, 'skill', 'a bare slash opens the skill list')
  // A path mid-sentence must not open the skill menu.
  assert.equal(t('open src/auth.ts')?.kind, undefined)
  assert.equal(t('fix /etc/hosts')?.kind, undefined, 'slash only triggers at the start')
}

// --- Applying a completion --------------------------------------------------
{
  const trig = detectTrigger('see @au', 7)!
  assert.deepEqual(applyCompletion('see @au', trig, 'src/auth.ts'), {
    text: 'see @src/auth.ts ',
    caret: 17,
  })

  const s = detectTrigger('/cave', 5)!
  assert.deepEqual(applyCompletion('/cave', s, 'caveman'), { text: '/caveman ', caret: 9 })

  // Completing mid-string must keep the tail.
  const mid = detectTrigger('a @x b', 4)!
  assert.equal(applyCompletion('a @x b', mid, 'y.ts').text, 'a @y.ts  b')
}

// --- Ranking ----------------------------------------------------------------
{
  assert.ok(scoreMatch('src/services/authService.ts', 'auth') > scoreMatch('src/a/other.ts', 'auth'))
  assert.equal(scoreMatch('src/a.ts', 'zzz'), -1)
  assert.ok(scoreMatch('src/auth.ts', '') > 0, 'empty query matches everything')

  const files = ['src/components/Chat.tsx', 'src/lib/auth.ts', 'src/services/authService.ts']
  const top = rank(files, 'auth', (f) => f)
  assert.equal(top[0], 'src/lib/auth.ts', 'exact basename prefix wins')
  assert.ok(top.includes('src/services/authService.ts'))
  assert.ok(!top.includes('src/components/Chat.tsx'))
}

// --- Mention expansion ------------------------------------------------------
{
  const known = ['src/lib/auth.ts', 'tests/auth.test.ts']
  const r = expandMentions('fix @auth.ts and @tests/auth.test.ts', known)
  assert.equal(r.text, 'fix `src/lib/auth.ts` and `tests/auth.test.ts`')
  assert.deepEqual(r.files, ['src/lib/auth.ts', 'tests/auth.test.ts'])

  // An unknown mention is left exactly as typed rather than silently dropped.
  const miss = expandMentions('see @nope.ts', known)
  assert.equal(miss.text, 'see @nope.ts')
  assert.deepEqual(miss.files, [])
  assert.equal(expandMentions('mail shaan@x.com', known).text, 'mail shaan@x.com')
}

// --- Postman URLs -----------------------------------------------------------
{
  assert.equal(urlOf('https://x.dev/a'), 'https://x.dev/a')
  assert.equal(urlOf({ raw: 'https://x.dev/a' }), 'https://x.dev/a')
  assert.equal(
    urlOf({ protocol: 'https', host: ['api', 'x', 'dev'], path: ['v1', 'users'], port: '8443' }),
    'https://api.x.dev:8443/v1/users',
  )
  assert.equal(
    urlOf({
      host: ['x', 'dev'],
      path: ['s'],
      query: [{ key: 'q', value: '1' }, { key: 'skip', value: '2', disabled: true }],
    }),
    'x.dev/s?q=1',
    'disabled query params are dropped',
  )
  assert.equal(urlOf(undefined), '')
}

// --- Collection import ------------------------------------------------------
{
  const doc = JSON.stringify({
    info: { name: 'Shop API' },
    variable: [{ key: 'baseUrl', value: 'https://api.shop.dev' }],
    item: [
      {
        name: 'Auth',
        item: [
          {
            name: 'Login',
            event: [{ listen: 'test', script: { exec: ['pm.test(...)'] } }],
            request: {
              method: 'post',
              header: [
                { key: 'Content-Type', value: 'application/json' },
                { key: 'X-Off', value: 'no', disabled: true },
              ],
              auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc' }] },
              body: { mode: 'raw', raw: '{"user":"a"}', options: { raw: { language: 'json' } } },
              url: { raw: '{{baseUrl}}/login' },
            },
          },
        ],
      },
      { name: 'Health', request: { method: 'GET', url: '{{baseUrl}}/health' } },
    ],
  })

  const c = parseCollection(doc)
  assert.equal(c.name, 'Shop API')
  assert.equal(c.variables.baseUrl, 'https://api.shop.dev')
  assert.equal(countRequests(c.root), 2)

  const login = c.root.folders[0].requests[0]
  assert.equal(login.method, 'POST', 'method is normalised to upper case')
  assert.equal(login.url, '{{baseUrl}}/login')
  assert.equal(login.bodyType, 'json')
  assert.equal(login.headers.find((h) => h.key === 'X-Off')?.enabled, false)
  assert.equal(
    login.headers.find((h) => h.key === 'Authorization')?.value,
    'Bearer abc',
    'auth block folds into a header',
  )
  assert.ok(login.notes?.includes('not run'), 'scripts are flagged, never executed')

  assert.equal(c.root.requests[0].name, 'Health')

  // Bad input must fail loudly, not produce an empty collection.
  assert.throws(() => parseCollection('{'), /not valid JSON/)
  assert.throws(() => parseCollection('{"a":1}'), /not a Postman collection/)
}

// --- Environments and interpolation ----------------------------------------
{
  const env = parseEnvironment(
    JSON.stringify({
      values: [
        { key: 'baseUrl', value: 'https://staging.dev', enabled: true },
        { key: 'unused', value: 'x', enabled: false },
      ],
    }),
  )
  assert.deepEqual(env, { baseUrl: 'https://staging.dev' })

  assert.equal(interpolate('{{baseUrl}}/login', env), 'https://staging.dev/login')
  // Unknown variables stay visible so a broken request is obvious.
  assert.equal(interpolate('{{nope}}/x', env), '{{nope}}/x')
  assert.equal(interpolate('no vars', env), 'no vars')
}

console.log('workbench logic: all checks passed')
