/**
 * What a page measures about itself, run inside the browser, shared by the surface lab and the component gallery so the two
 * cannot disagree about what a defect is. `auditScript(rootSelector)` returns the source of an expression; evaluate it in a page.
 *
 * It looks for: the page scrolling sideways, text clipped by its own box, elements spilling past the right edge, type under
 * 12px, touch targets under 40px on a touch device (a labelled checkbox counts as its label; an absolutely positioned
 * ::before/::after counts as part of the target), and saturated hues that are neither the accent nor a state or module role.
 */
export const auditScript = (rootSelector = ''): string => `(() => {
  const out = []
  /* A phone widens its layout viewport to fit whatever overflows, so innerWidth would agree with the overflow: measure against the device. */
  const vw = Math.min(window.innerWidth, screen.width || window.innerWidth)
  const doc = document.documentElement
  if (Math.max(doc.scrollWidth, document.body.scrollWidth) > vw + 1) out.push('page scrolls sideways: ' + Math.max(doc.scrollWidth, document.body.scrollWidth) + ' > ' + vw)
  const touch = window.matchMedia('(pointer: coarse)').matches
  const root = (${JSON.stringify(rootSelector)} !== '' && document.querySelector(${JSON.stringify(rootSelector)})) || document.querySelector('#settings .stg') || document.body
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 }
  const name = (e) => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : '') + (e.dataset && Object.keys(e.dataset)[0] ? '[' + Object.keys(e.dataset)[0] + ']' : ''))
  const hueOf = (css) => { const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(css); if (!m) return null; const R = +m[1] / 255, G = +m[2] / 255, B = +m[3] / 255; const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn; if (d < 0.12) return null; let h = 0; if (mx === R) h = ((G - B) / d) % 6; else if (mx === G) h = (B - R) / d + 2; else h = (R - G) / d + 4; return (h * 60 + 360) % 360 }
  const probe = document.createElement('span'); document.body.appendChild(probe)
  const roles = ['--bc-accent', '--bc-accent-2', '--bc-mod-tasks', '--bc-mod-board', '--bc-mod-documents', '--bc-mod-schedule', '--bc-mod-contacts', '--bc-mod-activity', '--bc-mod-other', '--bc-warn', '--bc-amber', '--bc-info', '--bc-success', '--bc-danger', '--bc-error', '--bc-gold', '--accent', '--ok', '--bad', '--warn'].map((v) => { probe.style.color = 'var(' + v + ')'; return hueOf(getComputedStyle(probe).color) }).filter((x) => x !== null)
  probe.remove()
  let clipped = 0, small = 0, tiny = 0, blue = 0
  const seen = new Set()
  for (const e of root.querySelectorAll('*')) {
    if (!vis(e) || e.closest('.bcvh, .bcskip, .aonly, [class*="sr-only"]')) continue
    const s = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    if (r.right > vw + 1 && !e.closest('[class*="scroll"], .bcstage, .bcboard, svg, .bdgrid')) { const k = 'off:' + name(e); if (!seen.has(k) && out.length < 14) { seen.add(k); out.push('spills off the right edge: ' + name(e) + ' (' + Math.round(r.right) + ' > ' + vw + ')') } }
    const direct = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    if (direct) {
      if (parseFloat(s.fontSize) < 11.5) { tiny += 1; const k = 'tiny:' + name(e); if (!seen.has(k) && out.length < 14) { seen.add(k); out.push('type under 12px: ' + name(e) + ' ' + s.fontSize) } }
      if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2 && !e.matches('.face')) { clipped += 1; const k = 'clip:' + name(e); if (!seen.has(k) && out.length < 14) { seen.add(k); out.push('text clipped by its box: ' + name(e) + ' ' + e.scrollWidth + ' > ' + e.clientWidth) } }
    }
    if (e.matches('input[placeholder], textarea[placeholder]') && e.value === '' && e.tagName === 'INPUT') {
      const m = document.createElement('span'); m.textContent = e.getAttribute('placeholder'); m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + s.font + ';letter-spacing:' + s.letterSpacing
      document.body.appendChild(m); const need = m.getBoundingClientRect().width; m.remove()
      const room = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
      if (need > room + 1) { const k = 'ph:' + name(e); if (!seen.has(k) && out.length < 14) { seen.add(k); out.push('placeholder is cut off: "' + e.getAttribute('placeholder') + '" needs ' + Math.round(need) + 'px, has ' + Math.round(room) + 'px') } }
    }
    let hw = r.width, hh = r.height
    const lab = e.matches('input[type="checkbox"], input[type="radio"]') ? e.closest('label') : null
    if (lab) { const lr = lab.getBoundingClientRect(); hw = Math.max(hw, lr.width); hh = Math.max(hh, lr.height) }
    for (const ps of ['::before', '::after']) { const pc = getComputedStyle(e, ps); if (pc.content !== 'none' && pc.position === 'absolute') { hw = Math.max(hw, parseFloat(pc.width) || 0); hh = Math.max(hh, parseFloat(pc.height) || 0) } }
    if (touch && (e.matches('button, a[href], [role="button"], input:not([type="hidden"]), select, summary')) && (hw < 40 || hh < 40) && !e.closest('[hidden]')) { small += 1; const k = 'tap:' + name(e); if (!seen.has(k) && out.length < 14) { seen.add(k); out.push('touch target ' + Math.round(hw) + 'x' + Math.round(hh) + ': ' + name(e)) } }
    for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
      const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(s[prop])
      if (!m) continue
      const a = m[4] === undefined ? 1 : Number(m[4])
      if (a < 0.4) continue
      const R = +m[1] / 255, G = +m[2] / 255, B = +m[3] / 255
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn
      if (d < 0.22 || mx < 0.25) continue
      let h = 0
      if (mx === R) h = ((G - B) / d) % 6; else if (mx === G) h = (B - R) / d + 2; else h = (R - G) / d + 4
      h = (h * 60 + 360) % 360
      if (d > 0.3 && !e.closest('.st-swatch, [data-palette-pick], .bcswatch, .bcpal, [data-bg-pick], .bcbgtile, .bcmat, svg, .st-logo, .bcvh')) {
        const near = (x) => Math.min(Math.abs(h - x), 360 - Math.abs(h - x)) < 28
        if (!roles.some(near)) { blue += 1; const k = 'hue:' + name(e) + prop; if (!seen.has(k) && out.length < 14) { seen.add(k); out.push('foreign hue ' + Math.round(h) + ' (' + prop + ' ' + s[prop] + ') matches neither the accent nor a state role: ' + name(e)) } }
      }
    }
  }
  return { out, clipped, small, tiny, blue }
})()`
