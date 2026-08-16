// htmlfun is a succinct html generation library. It's very async.
//
// It is inspired by hiccup, gomponents and uses ideas that feel naturally
// simple and I'm sure show up in many other places.
//
// Components are just reusable functions.
//
//   interface Card {
//     name: string
//     url: string
//     pictureURL: string
//   }
//
//   function renderCard(card: Card): HTML {
//     return h.div(
//       klass('card'),
//       h.img(ha.src(card.pictureURL), ha.alt('Profile Picture')),
//       h.a(ha.href(card.url), card.name),
//     )
//   }
//
//   interface CardSource {
//     all(): Promise<Card[]>
//   }
//
//   async function renderCards(source: CardSource): Promise<HTML[]> {
//     return (await source.all()).map(renderCard)
//   }

/**
 * RenderHTML can be defined on a type to allow for custom HTML
 * generation. For example:
 *
 *   class Foo {
 *     #opts: string
 *     constructor(opts: string) {
 *       this.#opts = opts
 *     }
 *     [RenderHTML]() {
 *       return renderTag('name', this.#opts)
 *     }
 *   }
 */
export const RenderHTML: unique symbol = Symbol.for('RenderHTML')

// Renderable can be implemented by types to provide custom HTML rendering.
export interface Renderable {
  [RenderHTML](): HTML
}

const isRenderable = (o: any): o is Renderable =>
  typeof o?.[RenderHTML] === 'function'

// renderable allows for using a function to defer rendering until required.
export function renderable(f: () => HTML): Renderable {
  return { [RenderHTML]: f }
}

// Primitives are the raw renderable chunks coming out of `primitives`
// async iterator. The strings here are escaped HTML ready for output.
export type Primitive = string | Uint8Array

const kindUnsafeHTML: unique symbol = Symbol.for('UnsafeHTML')

interface UnsafeHTML {
  kind: typeof kindUnsafeHTML
  value: string
}

// Provide Unsafe HTML that wont be subject to HTML escaping.
export function unsafeHTML(value: string): UnsafeHTML {
  return { kind: kindUnsafeHTML, value }
}

const isWrappedUnsafe = (o: any): o is UnsafeHTML => o?.kind === kindUnsafeHTML

// HTML is a recursive type that can be flattened to a list of renderable
// Primitives. They afford a lot of freedom and power and allow composing
// functions of all kinds: standard, async, iterable, async iterable.
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

export function attrPresence(name: string): TagOp {
  return { kind: tagOpPresence, name }
}

export function attrSet(name: string, value: TagValue): TagOp {
  return { kind: tagOpSet, name, value }
}

export function attrJoin(
  name: string,
  value: string | string[],
): TagOp {
  return { kind: tagOpJoin, name, value }
}

// klass does the common operation of join css classes.
export function klass(value: string | string[]): TagOp {
  return attrJoin('class', value)
}

export type AttrFunc = (value?: TagValue) => TagOp

export const ha: Record<string, AttrFunc> = new Proxy({}, {
  get(_target, prop, receiver) {
    return (value?: TagValue) => {
      if (typeof prop === 'symbol') return receiver[prop]
      if (typeof value === 'undefined') return attrPresence(prop)
      return attrSet(prop, value)
    }
  },
})

export type TagFunc = (...content: TagContent[]) => HTML

export const h: Record<string, TagFunc> = new Proxy({}, {
  get(_target, prop, receiver) {
    return (...content: TagContent[]) => {
      if (typeof prop === 'symbol') return receiver[prop]
      return renderTag(prop, false, ...content)
    }
  },
})

type TagContent = TagOp | HTML

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
