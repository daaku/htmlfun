/**
 * Example HTTP server built on htmlfun and Deno's standard library.
 *
 * Serves two pages rendered with htmlfun: a home page linking to a second
 * page, which links back. Responses stream directly from htmlfun's
 * `primitives` async generator into a `ReadableStream`, so the server never
 * builds a full document string in memory.
 *
 * The `@std/http` dependency (declared in deno.json) is pinned to 0.224.5,
 * the last release with the classic `serve` function: it was removed from
 * the package when it moved to 1.0.0. Only `--allow-net` is needed to run
 * the server itself; `--allow-import` lets Deno fetch the pinned std
 * library dependency.
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

import { serve } from '@std/http'
import { h, ha, klass, primitives, unsafeHTML, type HTML } from './mod.ts'

// Inline SVG data URIs, so the example needs no external assets and no
// network access beyond serving the pages themselves.
function placeholderImage(label: string, fill: string, text: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">` +
    `<rect width="100%" height="100%" fill="${fill}"/>` +
    `<text x="50%" y="50%" font-family="sans-serif" font-size="28" fill="${text}" ` +
    `text-anchor="middle" dominant-baseline="middle">${label}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
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
  return h.html(
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
  )
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
      h.img(
        ha.src(placeholderImage('Home page', '#e2e8f0', '#64748b')),
        ha.alt('Placeholder image'),
        ha.width(640),
        ha.height(360),
      ),
      h.h2('Dummy content'),
      h.p(
        klass('lorem'),
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
          'Pellentesque habitant morbi tristique senectus et netus et malesuada ' +
          'fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ' +
          'ultricies eget, tempor sit amet, ante.',
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
      h.img(
        ha.src(placeholderImage('Second page', '#dbeafe', '#1d4ed8')),
        ha.alt('Another placeholder image'),
        ha.width(640),
        ha.height(360),
      ),
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

const handler = (request: Request): Response => {
  const url = new URL(request.url)
  switch (url.pathname) {
    case '/':
      return htmlResponse(homePage())
    case '/about':
      return htmlResponse(aboutPage())
    default:
      return new Response('Not found', { status: 404 })
  }
}

const HOSTNAME = '0.0.0.0'
const PORT = 56789

console.log(`Listening on http://${HOSTNAME}:${PORT}`)
await serve(handler, { hostname: HOSTNAME, port: PORT })
