/**
 * Example HTTP server built on htmlfun and Deno's standard library.
 *
 * Serves two pages rendered with htmlfun: a home page linking to a second
 * page, which links back. Responses stream directly from htmlfun's
 * `primitives` async generator into a `ReadableStream`, so the server never
 * builds a full document string in memory.
 *
 * The HTTP server itself is `Deno.serve` (native Deno); routing comes from
 * the current `@std/http` via its `unstable-route` module. The classic
 * `serve` function was removed from `@std/http` when it moved to 1.0.0, so
 * it is no longer part of the std library. `unstable-route` is still marked
 * experimental but needs no extra runtime flags. Only `--allow-net` is
 * needed to run the server itself; `--allow-import` lets Deno fetch the
 * std library dependency.
 *
 * Run it from the repository root:
 *
 * ```sh
 * deno task example
 * ```
 *
 * or directly:
 *
 * ```sh
 * deno run --allow-net --allow-import example.ts
 * ```
 *
 * Then open http://localhost:56789
 */

import { type Route, route } from '@std/http/unstable-route'
import {
  h,
  ha,
  type HTML,
  klass,
  primitives,
  renderString,
  unsafeHTML,
} from './mod.ts'

// Inline SVG data URIs, so the example needs no external assets and no
// network access beyond serving the pages themselves. The SVG itself is
// rendered with htmlfun instead of string concatenation.
async function placeholderImage(
  label: string,
  fill: string,
  text: string,
): Promise<string> {
  const svg = await renderString(
    h.svg(
      ha.xmlns('http://www.w3.org/2000/svg'),
      ha.width(640),
      ha.height(360),
      h.rect(ha.width('100%'), ha.height('100%'), ha.fill(fill)),
      h.text(
        ha.x('50%'),
        ha.y('50%'),
        ha['font-family']('sans-serif'),
        ha['font-size'](28),
        ha.fill(text),
        ha['text-anchor']('middle'),
        ha['dominant-baseline']('middle'),
        label,
      ),
    ),
  )
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

async function imgPlaceholder(
  label: string,
  fill: string,
  text: string,
): Promise<HTML> {
  return h.img(
    ha.src(await placeholderImage(label, fill, text)),
    ha.alt(`${label} placeholder`),
    ha.width(640),
    ha.height(360),
  )
}

// CSS is wrapped in unsafeHTML so the style element isn't escaped.
const STYLES = unsafeHTML(`
  body {
    font-family: system-ui, sans-serif;
    max-width: 40rem;
    margin: 2rem auto;
    padding: 0 1rem;
    line-height: 1.6;
    color: #1e293b;
  }
  img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
  }
  a {
    color: #2563eb;
  }
`)

function layout(title: string, body: HTML): HTML {
  return [
    unsafeHTML('<!doctype>'),
    h.html(
      h.head(
        h.meta(ha.charset('utf-8')),
        h.meta(
          ha.name('viewport'),
          ha.content('width=device-width, initial-scale=1'),
        ),
        h.title(title),
        h.style(STYLES),
      ),
      h.body(body),
    ),
  ]
}

function homePage(): HTML {
  return layout(
    'Home',
    h.main(
      h.h1('Hello from htmlfun'),
      h.p(
        'This home page is rendered with htmlfun and served by ',
        h.code('@std/http'),
        '. Follow the link at the bottom to the second page.',
      ),
      imgPlaceholder('Home page', '#e2e8f0', '#64748b'),
      h.h2('Dummy content'),
      h.p(
        klass('lorem'),
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '
          + 'Pellentesque habitant morbi tristique senectus et netus et malesuada '
          + 'fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, '
          + 'ultricies eget, tempor sit amet, ante.',
      ),
      h.p(h.a(ha.href('/about'), 'Go to the second page →')),
    ),
  )
}

function aboutPage(): HTML {
  return layout(
    'Second page',
    h.main(
      h.h1('Second page'),
      h.p(
        'You made it. This page renders a different htmlfun tree: a list of ',
        'things, an inline SVG placeholder, and a link back home.',
      ),
      imgPlaceholder('Second page', '#dbeafe', '#1d4ed8'),
      h.ul(
        h.li('Rendered on the fly for each request'),
        h.li('Streamed straight from htmlfun primitives'),
        h.li('Escaped, unless you ask for unsafeHTML'),
      ),
      h.p(h.a(ha.href('/'), '← Back to the home page')),
    ),
  )
}

// Stream htmlfun primitives into a response body, so pages are written to the
// socket as they render instead of being buffered into a single string.
function htmlResponse(html: HTML): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of primitives(html)) {
          // Enqueueing many small chunks is fine: the stream buffers
          // internally and Deno flushes each chunk to the socket as it
          // arrives, so no manual buffering is needed for page-sized output.
          controller.enqueue(
            typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
          )
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

const routes: Route[] = [
  {
    pattern: new URLPattern({ pathname: '/' }),
    handler: () => htmlResponse(homePage()),
  },
  {
    pattern: new URLPattern({ pathname: '/about' }),
    handler: () => htmlResponse(aboutPage()),
  },
]

const notFound = (): Response => new Response('Not found', { status: 404 })

const HOSTNAME = '0.0.0.0'
const PORT = 56789

// Deno.serve logs its own "Listening on" message by default; a single
// onListen callback replaces that default so it isn't printed twice.
Deno.serve(
  {
    hostname: HOSTNAME,
    port: PORT,
    onListen: ({ hostname, port }) =>
      console.log(`Listening on http://${hostname}:${port}`),
  },
  route(routes, notFound),
)
