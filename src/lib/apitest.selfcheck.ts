/**
 * Self-check for the API workbench logic. Run:
 *   npx esbuild src/lib/apitest.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/a.cjs && node /tmp/a.cjs
 */
import assert from 'node:assert/strict'
import {
  authHeaders, b64, generateCode, joinUrl, jsonPath, parseCurl, runAssertions, splitUrl, tokenize,
  type Assertion, type ResponseFacts,
} from './apitest'

// --- Auth -------------------------------------------------------------------
{
  assert.equal(b64('user:pass'), 'dXNlcjpwYXNz')
  assert.deepEqual(authHeaders({ kind: 'none' }), [])
  assert.deepEqual(authHeaders({ kind: 'bearer', token: 'abc' }), [
    { key: 'Authorization', value: 'Bearer abc', enabled: true },
  ])
  assert.equal(authHeaders({ kind: 'basic', username: 'user', password: 'pass' })[0].value, 'Basic dXNlcjpwYXNz')
  assert.equal(authHeaders({ kind: 'apikey', key: 'X-Key', value: 'k', in: 'header' })[0].key, 'X-Key')
  // A query-placed key is not a header; it belongs in the URL.
  assert.deepEqual(authHeaders({ kind: 'apikey', key: 'X-Key', value: 'k', in: 'query' }), [])
}

// --- Query params round-trip ------------------------------------------------
{
  const { base, params } = splitUrl('https://x.dev/s?q=hello%20world&page=2')
  assert.equal(base, 'https://x.dev/s')
  assert.deepEqual(params.map((p) => [p.key, p.value]), [['q', 'hello world'], ['page', '2']])

  assert.equal(joinUrl(base, params), 'https://x.dev/s?q=hello%20world&page=2')
  assert.equal(
    joinUrl('https://x.dev/s', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: false },
    ]),
    'https://x.dev/s?a=1',
  )
  assert.equal(joinUrl('https://x.dev/s', []), 'https://x.dev/s')
  assert.equal(
    joinUrl('https://x.dev', [], { kind: 'apikey', key: 'api_key', value: 'k', in: 'query' }),
    'https://x.dev?api_key=k',
  )
  // Malformed percent-encoding must not throw while typing.
  assert.equal(splitUrl('https://x.dev/s?bad=%E0%A4%A').params[0].value, '%E0%A4%A')
}

// --- JSON path --------------------------------------------------------------
{
  const body = '{"data":{"items":[{"id":7,"name":"a"}],"ok":true},"n":null}'
  assert.equal(jsonPath(body, 'data.items.0.id'), 7)
  assert.equal(jsonPath(body, 'data.ok'), true)
  assert.equal(jsonPath(body, 'data.items.5'), undefined)
  assert.equal(jsonPath(body, 'nope.deep'), undefined, 'missing path must not throw')
  assert.equal(jsonPath('not json', 'a'), undefined)
}

// --- Assertions -------------------------------------------------------------
{
  const res: ResponseFacts = {
    status: 201,
    ms: 120,
    headers: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: '{"data":{"items":[{"id":7}]}}',
  }
  const a = (o: Partial<Assertion>): Assertion =>
    ({ id: o.id ?? 'x', kind: o.kind!, expected: o.expected ?? '', enabled: true, ...o }) as Assertion

  const r = runAssertions(
    [
      a({ id: '1', kind: 'status', expected: '201' }),
      a({ id: '2', kind: 'status', expected: '300', op: 'lt' }),
      a({ id: '3', kind: 'time', expected: '500', op: 'lt' }),
      a({ id: '4', kind: 'header', target: 'content-type', expected: 'json', op: 'contains' }),
      a({ id: '5', kind: 'json-path', target: 'data.items.0.id', expected: '7' }),
      a({ id: '6', kind: 'body-contains', expected: 'items' }),
      a({ id: '7', kind: 'status', expected: '404' }),
      a({ id: '8', kind: 'json-path', target: 'data.missing', op: 'exists', expected: '' }),
    ],
    res,
  )
  assert.deepEqual(r.map((x) => x.passed), [true, true, true, true, true, true, false, false])
  assert.equal(r[3].actual, 'application/json; charset=utf-8')
  assert.equal(r[6].actual, '201', 'a failure reports what was actually seen')
  assert.equal(runAssertions([{ ...a({ kind: 'status', expected: '1' }), enabled: false }], res).length, 0)
}

// --- Code generation --------------------------------------------------------
{
  const spec = {
    method: 'POST',
    url: 'https://x.dev/v1/users',
    headers: [
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'X-Off', value: 'no', enabled: false },
    ],
    body: '{"a":1}',
  }
  const curl = generateCode(spec, 'curl')
  assert.ok(curl.includes("curl -X POST 'https://x.dev/v1/users'"))
  assert.ok(curl.includes("-H 'Content-Type: application/json'"))
  assert.ok(!curl.includes('X-Off'), 'disabled headers are not emitted')

  assert.ok(generateCode(spec, 'fetch').includes('method: "POST"'))
  assert.ok(generateCode(spec, 'axios').includes('method: "post"'))
  assert.ok(generateCode(spec, 'python').includes('import requests'))
  assert.ok(!generateCode({ ...spec, body: '' }, 'fetch').includes('body:'))
}

// --- cURL import ------------------------------------------------------------
{
  assert.deepEqual(tokenize(`curl -H "a: b c" 'x y'`), ['curl', '-H', 'a: b c', 'x y'])
  assert.deepEqual(tokenize("curl \\\n  -X GET \\\n  https://x.dev"), ['curl', '-X', 'GET', 'https://x.dev'])

  const p = parseCurl(`curl -X POST 'https://api.x.dev/login' \\
    -H 'Content-Type: application/json' \\
    -H 'Authorization: Bearer tok' \\
    -d '{"user":"a"}'`)
  assert.equal(p.method, 'POST')
  assert.equal(p.url, 'https://api.x.dev/login')
  assert.equal(p.headers.length, 2)
  assert.equal(p.body, '{"user":"a"}')

  assert.equal(parseCurl(`curl https://x.dev -d 'a=1'`).method, 'POST')
  assert.equal(parseCurl(`curl https://x.dev`).method, 'GET')
  assert.equal(parseCurl(`curl -sL --compressed https://x.dev/a`).url, 'https://x.dev/a')
  assert.equal(parseCurl(`curl -u me:secret https://x.dev`).headers[0].value, 'Basic bWU6c2VjcmV0')

  assert.throws(() => parseCurl('wget https://x.dev'), /not a curl/)
  assert.throws(() => parseCurl('curl -X POST'), /no URL/)
}

console.log('api workbench: all checks passed')
