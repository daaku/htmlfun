import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attrJoin,
  attrPresence,
  attrSet,
  h,
  ha,
  klass,
  primitives,
  renderable,
  RenderHTML,
  renderString,
  renderTag,
  unsafeHTML,
} from './mod.ts'

const utf8 = new TextEncoder()

test('renders a tag with attributes and content', async () => {
  assert.equal(
    await renderString(h.a(ha.href('/x'), ha.title('t'), 'link')),
    '<a href="/x" title="t">link</a>',
  )
})

test('renders an empty tag', async () => {
  assert.equal(await renderString(h.div()), '<div></div>')
})

test('escapes text content', async () => {
  assert.equal(
    await renderString(h.div('a < b & c > d "e" \'f\'')),
    '<div>a &lt; b &amp; c &gt; d &quot;e&quot; &#039;f&#039;</div>',
  )
})

test('escapes attribute values', async () => {
  assert.equal(
    await renderString(h.div(ha.title('a & "b"'))),
    '<div title="a &amp; &quot;b&quot;"></div>',
  )
})

test('renders presence attributes without a value', async () => {
  assert.equal(await renderString(h.input(ha.disabled())), '<input disabled>')
})

test('self-closes void tags', async () => {
  assert.equal(await renderString(h.br()), '<br>')
  assert.equal(
    await renderString(h.img(ha.src('/a.png'))),
    '<img src="/a.png">',
  )
})

test('renders attribute values as strings', async () => {
  assert.equal(await renderString(h.div(attrSet('x', 1))), '<div x="1"></div>')
})

test('klass joins and merges classes', async () => {
  assert.equal(
    await renderString(h.div(klass('a'), klass(['b', 'c']))),
    '<div class="a b c"></div>',
  )
})

test('attrJoin joins values with spaces', async () => {
  assert.equal(
    await renderString(h.div(attrJoin('data-a', ['1', '2']))),
    '<div data-a="1 2"></div>',
  )
})

test('renders bare presence attrs', async () => {
  assert.equal(
    await renderString(h.div(attrPresence('hidden'))),
    '<div hidden></div>',
  )
})

test('renderTag selfClose omits the closing tag', async () => {
  assert.equal(await renderString(renderTag('br', true)), '<br>')
  assert.equal(await renderString(renderTag('br', false)), '<br></br>')
})

test('unsafeHTML skips escaping', async () => {
  assert.equal(
    await renderString(h.div(unsafeHTML('<b>raw</b>'))),
    '<div><b>raw</b></div>',
  )
})

test('renderable defers rendering', async () => {
  assert.equal(
    await renderString(renderable(() => h.b('later'))),
    '<b>later</b>',
  )
})

test('RenderHTML enables custom rendering', async () => {
  class Widget {
    constructor(private label: string) {}
    [RenderHTML]() {
      return h.span(this.label)
    }
  }
  assert.equal(await renderString(new Widget('hi')), '<span>hi</span>')
})

test('awaits promises', async () => {
  assert.equal(await renderString(Promise.resolve('lazy')), 'lazy')
})

test('flattens iterables', async () => {
  assert.equal(await renderString([1, 'two', [3]]), '1two3')
})

test('streams async iterables', async () => {
  async function* gen() {
    yield 'a'
    yield 'b'
    yield 'c'
  }
  assert.equal(await renderString(gen()), 'abc')
})

test('passes Uint8Array through unchanged', async () => {
  const bytes = utf8.encode('raw bytes')
  const chunks = []
  for await (const chunk of primitives(bytes)) {
    chunks.push(chunk)
  }
  assert.deepEqual(chunks, [bytes])
})

test('renderString decodes Uint8Array', async () => {
  assert.equal(await renderString(utf8.encode('bytes')), 'bytes')
})

test('throws on unsupported values', () => {
  assert.rejects(
    renderString({ nope: true } as any),
    /unable to process as HTML/,
  )
})
