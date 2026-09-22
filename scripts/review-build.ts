/*
 * A static, self-contained copy of the studio, for review.
 *
 * WHY THIS EXISTS. A deploy is the right way to give Grant something to click,
 * and this session cannot make one: the Vercel token IS present, and the
 * environment's egress policy answers 403 to CONNECT for api.vercel.com. So
 * the alternative is a bundle that works on a host with no rewrite rules.
 *
 * WHAT IT CHANGES, and it is deliberately almost nothing:
 *
 *   1. `window.STUDIO_REVIEW = true`, which moves the address into the hash.
 *      A static host has no rewrite, so a path address would 404 on reload.
 *   2. Root-absolute asset references become relative. The product asks for
 *      `/app.js` because it is served from a domain root and its routes are
 *      nested; a bundle is served from wherever it is put.
 *   3. A short banner saying what this is, because a reviewer who cannot tell
 *      a review copy from the product is the "invented data mistaken for real"
 *      failure this repository already records.
 *
 * It is GENERATED, never hand-maintained. A copied frontend that is edited by
 * hand is a second product, and this repository has a rule about that.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FROM = 'web/studio'
const TO = '.out/review'

await rm(TO, { recursive: true, force: true })
await mkdir(TO, { recursive: true })
await cp(FROM, TO, { recursive: true })

/* ------------------------------------------------------------- the page -- */

let html = await readFile(join(FROM, 'index.html'), 'utf8')

const before = html
html = html.replace(/(href|src)="\/(?!\/)/g, '$1="')
if (html === before)
  throw new Error('no root-absolute references were rewritten — the page has changed shape')

/*
  The flag goes in BEFORE the module that reads it. `app.js` is a module, so it
  is deferred and runs after this inline script whatever the order — but an
  inline script placed after it would still be a bet on that, and the bet is
  free to avoid.
*/
/*
  The screen this build exists to show. Taken from the data rather than
  written down, so a rename of the example project cannot leave the review
  build opening on a project that is not there.
*/
const dataSrc = await readFile(join(FROM, 'data.js'), 'utf8')
/*
  The first slug after the fallback PROJECTS array begins. The first `slug:`
  in the file belongs to a member of the crew, so an unanchored match produced
  `/basecamp/p/claire` - a project that does not exist, and a review build that
  opened on the portfolio instead. `export const PROJECTS` is not the anchor
  either: it is assigned from `FALLBACK_PROJECTS`, which is where the data is.
  Asserted, because a wrong start address is the kind of defect that looks
  like a preference.
*/
const projectsAt = dataSrc.indexOf('const FALLBACK_PROJECTS = [')
const firstSlug =
  projectsAt < 0 ? undefined : /slug:\s*'([^']+)'/.exec(dataSrc.slice(projectsAt))?.[1]
if (firstSlug === undefined)
  throw new Error('data.js names no project slug — the start address would be a guess')

const flag = `<script>window.STUDIO_REVIEW = true; window.STUDIO_START = '/basecamp/p/${firstSlug}'</script>\n`
if (!html.includes('<script type="module"'))
  throw new Error('the page no longer loads app.js as a module')
html = html.replace('<script type="module"', `${flag}<script type="module"`)

const banner = `<div style="position:fixed;inset-block-start:0;inset-inline:0;z-index:99999;
  background:#3a2a12;color:#f0d9a8;border-block-end:1px solid #6b5623;
  font:500 12px/1.4 system-ui,sans-serif;padding:7px 12px;text-align:center">
  Review copy of the experimental Team HQ — a static bundle, not a deployment.
  Addresses live in the # so this works without a server.
  <a href="#/basecamp" style="color:#f0d9a8">Project home</a> ·
  <a href="#/" style="color:#f0d9a8">Today's Team HQ</a>
</div>
<div style="height:30px"></div>\n`
html = html.replace('<body>', `<body>\n${banner}`)
if (!html.includes('Review copy'))
  throw new Error('the banner did not land — the page has no body tag')

await writeFile(join(TO, 'index.html'), html)

/* ------------------------------------------------------------- the data -- */

/*
  The sample files are asked for root-absolutely for the same reason the
  stylesheets are, and have to travel the same way.
*/
const dataPath = join(TO, 'data.js')
const data = await readFile(dataPath, 'utf8')
const n = (data.match(/'\/samples\//g) ?? []).length
if (n === 0) throw new Error('data.js names no sample files — the rewrite would be silent')
await writeFile(dataPath, data.replaceAll("'/samples/", "'samples/"))

/* ------------------------------------------------------- the pdf worker -- */

/*
  THE WORKER TRAVELS AS BASE64, because it cannot travel as text.

  `pdf.worker.mjs` is minified and contains an ESC byte, and the artifact host
  refuses text carrying one. pdf.js will not render without a worker - dropping
  it was tried and every real page stopped appearing, which the review check
  caught - so the bytes go as base64 in a plain ASCII module and the page
  rebuilds them into a blob URL at load.

  SAME BYTES, different transport: the base64 is the file, decoded in the
  browser, and a blob URL is same-origin so it is a legal worker source. The
  PRODUCT is untouched; this happens in the copy.
*/
const workerFile = join(TO, 'vendor', 'pdf.worker.mjs')
const workerBytes = await readFile(workerFile)
await writeFile(
  join(TO, 'vendor', 'pdf-worker-b64.js'),
  `/* Generated by scripts/review-build.ts — the pdf.js worker, byte for byte. */\nexport const WORKER_B64 = '${workerBytes.toString('base64')}'\n`,
)
await rm(workerFile, { force: true })

const pdfPath = join(TO, 'pdf.js')
const pdfSrc = await readFile(pdfPath, 'utf8')
const workerLine =
  "pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href"
if (!pdfSrc.includes(workerLine)) {
  throw new Error('pdf.js no longer wires the worker the way this rewrite expects')
}
await writeFile(
  pdfPath,
  pdfSrc.replace(
    workerLine,
    [
      '{',
      "    const { WORKER_B64 } = await import('./vendor/pdf-worker-b64.js')",
      '    const bin = atob(WORKER_B64)',
      '    const bytes = new Uint8Array(bin.length)',
      '    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)',
      "    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))",
      '  }',
    ].join('\n  '),
  ),
)

/* ------------------------------------------------ the deployable copy -- */

/*
  A SECOND OUTPUT: the site as the product, for a real preview deploy.
  
  `.out/site/` is `web/studio` untouched, plus the rewrite rule that makes path
  addressing work. It exists because deploying the REPOSITORY does not work -
  Vercel finds `api/*.py`, cannot resolve a Python entrypoint, and the build
  fails before it ever reaches the page. Those functions are nothing to do with
  this experience, so the deploy gets the site and nothing else.
  
  This copy keeps the PATH addressing, because a real host has the rewrite -
  so `/basecamp/p/x` is a real address that survives a reload, which is the one
  thing the static review bundle can only approximate.
*/
const SITE = '.out/site'
await rm(SITE, { recursive: true, force: true })
await mkdir(SITE, { recursive: true })
await cp(FROM, SITE, { recursive: true })
await writeFile(
  join(SITE, 'vercel.json'),
  `${JSON.stringify(
    {
      rewrites: [
        { source: '/:path((?!api/|studio/|samples/|fonts/)[^.]*)', destination: '/index.html' },
      ],
    },
    null,
    2,
  )}\n`,
)
console.log(`deployable site in ${SITE}/ — the product, with its rewrite rule`)

/* --------------------------------------------------------------- report -- */

const count = async (dir: string): Promise<number> => {
  let out = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    out += e.isDirectory() ? await count(join(dir, e.name)) : 1
  }
  return out
}
console.log(`review build in ${TO}/ — ${String(await count(TO))} file(s)`)
console.log(
  `  hash addressing on, opens at /basecamp/p/${firstSlug}, ${String(n)} sample reference(s) made relative`,
)
