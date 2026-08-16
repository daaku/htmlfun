/**
 * Succinct, async HTML generation.
 *
 * Inspired by [hiccup](https://github.com/weavejester/hiccup) and
 * [gomponents](https://github.com/maragudk/gomponents), with a twist: everything
 * can be async, including streaming async iterators. Components are just
 * reusable functions.
 *
 * @example
 * ```ts
 * import { h, ha, klass, renderString } from 'jsr:@daaku/htmlfun'
 *
 * interface Card {
 *   name: string
 *   url: string
 *   pictureURL: string
 * }
 *
 * function renderCard(card: Card) {
 *   return h.div(
 *     klass('card'),
 *     h.img(ha.src(card.pictureURL), ha.alt('Profile Picture')),
 *     h.a(ha.href(card.url), card.name),
 *   )
 * }
 *
 * await renderString(h.div(renderCard({
 *   name: 'foo',
 *   url: '/',
 *   pictureURL: '/a.png',
 * })))
 * // => <div class="card"><img src="/a.png" alt="Profile Picture"><a href="/">foo</a></div>
 * ```
 *
 * Async sources work out of the box:
 *
 * ```ts
 * interface CardSource {
 *   all(): Promise<Card[]>
 * }
 *
 * async function renderCards(source: CardSource) {
 *   return (await source.all()).map(renderCard)
 * }
 * ```
 */

/**
 * Symbol used to define interface method for Renderable.
 */
export const RenderHTML: unique symbol = Symbol.for('RenderHTML')

/**
 * Implement to provide custom HTML rendering.
 */
export interface Renderable {
  /**
   * This method can be defined to return HTML by any object.
   *
   * @example
   * ```ts
   * class Name {
   *   #opts: string
   *   constructor(opts: string) {
   *     this.#opts = opts
   *   }
   *   [RenderHTML]() {
   *     return renderTag('name', false, this.#opts)
   *   }
   * }
   * ```
   */
  [RenderHTML](): HTML
}

const isRenderable = (o: any): o is Renderable =>
  typeof o?.[RenderHTML] === 'function'

/**
 * Defer rendering with a function until required.
 */
export function renderable(f: () => HTML): Renderable {
  return { [RenderHTML]: f }
}

/**
 * Raw chunk from `primitives`. Strings are escaped and ready for output.
 */
export type Primitive = string | Uint8Array

const kindUnsafeHTML: unique symbol = Symbol.for('UnsafeHTML')

interface UnsafeHTML {
  kind: typeof kindUnsafeHTML
  value: string
}

/**
 * Wrap pre-escaped HTML so it skips escaping.
 */
export function unsafeHTML(value: string): UnsafeHTML {
  return { kind: kindUnsafeHTML, value }
}

const isWrappedUnsafe = (o: any): o is UnsafeHTML => o?.kind === kindUnsafeHTML

/**
 * Recursive value flattened by `primitives` into a stream of `Primitive`s.
 * Composes standard, async, iterable, and async iterable values.
 */
export type HTML =
  | undefined
  | null
  | string
  | number
  | Uint8Array
  | UnsafeHTML
  | Renderable
  | Promise<HTML>
  | Iterable<HTML>
  | AsyncIterable<HTML>

const isAsyncIterable = (o: any): o is AsyncIterable<unknown> =>
  typeof o?.[Symbol.asyncIterator] === 'function'

const isIterable = (o: any): o is Iterable<unknown> =>
  typeof o?.[Symbol.iterator] === 'function'

function escapeHTML(s: string) {
  return s.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#039;'
      default:
        return char
    }
  })
}

/**
 * Flatten `html` into escaped strings and raw `Uint8Array`s, streaming
 * async iterables and awaiting promises as it goes.
 *
 * @example
 * ```ts
 * for await (const chunk of primitives(html)) {
 *   // write to a response, socket, or file
 * }
 * ```
 */
export async function* primitives(html: HTML): AsyncIterable<Primitive> {
  // null and undefined
  if (html == null) return

  // Uint8Array are sent as-is
  if (html instanceof Uint8Array) {
    yield html
    return
  }

  // strings are escaped
  if (typeof html === 'string') {
    yield escapeHTML(html)
    return
  }

  // special number handling
  if (typeof html === 'number') {
    yield String(html)
    return
  }

  // pre-escaped unsafe strings
  if (isWrappedUnsafe(html)) {
    yield html.value
    return
  }

  // custom renderables
  if (isRenderable(html)) {
    yield* primitives(html[RenderHTML]())
    return
  }

  // wait on promises
  if (html instanceof Promise) {
    yield* primitives(await (html as any))
    return
  }

  // iterables get recursed
  if (isIterable(html)) {
    for (const each of html) {
      yield* primitives(each as HTML)
    }
    return
  }

  // iterables, but with await
  if (isAsyncIterable(html)) {
    for await (const each of html) {
      yield* primitives(each)
    }
    return
  }

  throw new Error(`unable to process as HTML: ${html}`)
}

/**
 * Render `html` to a string.
 */
export async function renderString(html: HTML): Promise<string> {
  let s = ''
  let decoder = new TextDecoder('utf-8')
  for await (const each of primitives(html)) {
    if (typeof each === 'string') {
      s += each
    } else {
      s += decoder.decode(each)
    }
  }
  return s
}

const tagOpPresence: unique symbol = Symbol.for('tag-op-presence')
const tagOpSet: unique symbol = Symbol.for('tag-op-set')
const tagOpJoin: unique symbol = Symbol.for('tag-op-join')

type TagValue = string | number | boolean

type TagOp =
  | { kind: typeof tagOpPresence; name: string }
  | { kind: typeof tagOpSet; name: string; value: TagValue }
  | { kind: typeof tagOpJoin; name: string; value: string | string[] }

const isTagOp = (o: any): o is TagOp =>
  o?.kind === tagOpPresence || o?.kind === tagOpSet || o?.kind === tagOpJoin

/**
 * Attribute rendered as a bare boolean flag, e.g. `disabled`.
 */
export function attrPresence(name: string): TagOp {
  return { kind: tagOpPresence, name }
}

/**
 * Attribute rendered with a value, e.g. `href="..."`.
 */
export function attrSet(name: string, value: TagValue): TagOp {
  return { kind: tagOpSet, name, value }
}

/**
 * Attribute that joins values with a space, merging with any existing value.
 */
export function attrJoin(
  name: string,
  value: string | string[],
): TagOp {
  return { kind: tagOpJoin, name, value }
}

/**
 * Join CSS classes - the common `attrJoin('class', ...)` case.
 */
export function klass(value: string | string[]): TagOp {
  return attrJoin('class', value)
}

/**
 * Sets an attribute value. If a value is not provided, just name will be in
 * the output. This is for value-less attribues like `disabled` etc.
 */
export type AttrFunc = (value?: TagValue) => TagOp

/**
 * Attribute by name.
 *
 * @example
 * ```ts
 * h.img(ha.src('/a.png'), ha.alt('Profile Picture'), ha.disabled)
 * ```
 */
export const ha: Record<string, AttrFunc> = new Proxy({}, {
  get(_target, prop, receiver) {
    return (value?: TagValue) => {
      if (typeof prop === 'symbol') return receiver[prop]
      if (typeof value === 'undefined') return attrPresence(prop)
      return attrSet(prop, value)
    }
  },
})

/**
 * Sets TagContent for a tag.
 */
export type TagFunc = (...content: TagContent[]) => HTML

const selfClosingTags = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]

/**
 * Tag by name.
 *
 * @example
 * ```ts
 * h.div(klass('card'), h.span('hi'))
 * ```
 */
export const h: Record<string, TagFunc> = new Proxy({}, {
  get(_target, prop, receiver) {
    return (...content: TagContent[]) => {
      if (typeof prop === 'symbol') return receiver[prop]
      const selfClose = selfClosingTags.includes(prop)
      return renderTag(prop, selfClose, ...content)
    }
  },
})

type TagContent = TagOp | HTML

/**
 * Render a tag with attributes and content. With `selfClose`, omits the
 * closing tag.
 */
export async function* renderTag(
  tag: string,
  selfClose: boolean,
  ...ops: TagContent[]
): HTML {
  yield unsafeHTML('<')
  yield tag

  const attrs: Record<string, string | boolean> = {}
  const body = []
  for (const each of ops) {
    // collect html contents
    if (!isTagOp(each)) {
      body.push(each as HTML)
      continue
    }

    // process tag attributes
    switch (each.kind) {
      case tagOpPresence:
        attrs[each.name] = true
        break
      case tagOpSet:
        attrs[each.name] = String(each.value)
        break
      case tagOpJoin:
        const existing = attrs[each.name]
        if (existing && existing !== '') {
          if (Array.isArray(each.value)) {
            attrs[each.name] += ' ' + each.value.join(' ')
          } else {
            attrs[each.name] += ' ' + each.value
          }
        } else {
          if (Array.isArray(each.value)) {
            attrs[each.name] = each.value.join(' ')
          } else {
            attrs[each.name] = each.value
          }
        }
        break
    }
  }

  for (const [name, value] of Object.entries(attrs)) {
    yield ' '
    yield name
    if (typeof value !== 'boolean') {
      yield unsafeHTML('="')
      yield String(value)
      yield unsafeHTML('"')
    }
  }

  yield unsafeHTML('>')
  yield* body

  if (selfClose) return

  yield unsafeHTML('</')
  yield tag
  yield unsafeHTML('>')
}
