/**
 * Press a control in the studio, which is not the same as clicking it.
 *
 * Three things make a bare `click()` unreliable on this page, and each has
 * cost real time on its own:
 *
 * 1. **The studio never stops moving.** `breathe()` and `scatter()` run for as
 *    long as the page is open, so Playwright's "element is stable" check can
 *    never pass inside it.
 * 2. **A view transition paints an overlay over the WHOLE page** for about
 *    900ms, during which `elementFromPoint` at any coordinate returns the root.
 *    `force: true` skips the stability wait but still dispatches at a POINT, so
 *    a press during that window lands on the overlay and is silently lost.
 * 3. **The layout moves under the press.** Focusing a textarea on a phone
 *    profile reflows the page between the moment a bounding box is measured
 *    and the moment the click is dispatched — so the coordinates are right for
 *    a layout that no longer exists, and the press lands on whatever moved into
 *    that spot. `verify:chat` spent four runs on this: pressing Send on a phone
 *    navigated to the Overview tab, and reported as "the conversation
 *    disappeared".
 *
 * So: wait until the element at its own centre really IS the element, and only
 * then press. That is the hit-test CLAUDE.md prescribes, in one place, because
 * two copies of it would drift.
 *
 * Returns false rather than throwing when the control never becomes reachable
 * — a caller that wants that to be a failure can check for it and say so in
 * its own words, which is more use than a timeout stack.
 */
export const press = async (
  page: import('playwright').Page,
  selector: string,
  tries = 40,
): Promise<boolean> => {
  const el = page.locator(selector).first()

  /*
    Bring it into view first, centred.

    Not `scrollIntoViewIfNeeded`, which stops the moment the element is
    technically visible — and on a phone that is exactly where the fixed bottom
    navigation is, so the control ends up on screen and underneath it. Centring
    puts it clear of both fixed edges. This is the same trap `.navgroup`'s own
    comment records about the composer.
  */
  await page
    .evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (el !== null) el.scrollIntoView({ block: 'center' })
    })()`)
    .catch(() => undefined)
  await page.waitForTimeout(200)

  for (let attempt = 0; attempt < tries; attempt += 1) {
    const box = await el.boundingBox().catch(() => null)
    if (box !== null) {
      /*
        Passed as a STRING, for the reason `probe.ts` and `space.ts` both do
        it: this project's tsconfig has no `dom` lib, so a closure touching
        `document` cannot typecheck even though it only ever runs in a browser.
      */
      const mine = await page.evaluate(`(() => {
        const want = document.querySelector(${JSON.stringify(selector)})
        const at = document.elementFromPoint(${String(box.x + box.width / 2)}, ${String(
          box.y + box.height / 2,
        )})
        return want !== null && at !== null && (want === at || want.contains(at))
      })()`)
      if (mine === true) {
        await el.click({ force: true })
        return true
      }
      if (attempt === tries - 1 && process.env.PRESS_WHY === '1') {
        console.log(
          `    [press] ${selector} at ${String(Math.round(box.x + box.width / 2))},${String(
            Math.round(box.y + box.height / 2),
          )} — in the way: ${String(
            await page.evaluate(`(() => {
              const at = document.elementFromPoint(${String(box.x + box.width / 2)}, ${String(
                box.y + box.height / 2,
              )})
              return at === null ? 'nothing' : at.tagName + '.' + String(at.className).slice(0, 40)
            })()`),
          )}`,
        )
      }
    }
    /*
      Two more ways to get it clear, tried in turn.

      Centring is right for something mid-page and wrong for the last control
      in the document: there is no room below it, so the page cannot scroll far
      enough and the element settles under the fixed bottom navigation — which
      is where Send lives on a phone, and what "in the way: BUTTON.navitem"
      said when this was logged rather than counted. Scrolling the document to
      its end lets `.shell`'s reserved space do its job.
    */
    if (attempt === 8) {
      await page
        .evaluate(`window.scrollTo(0, document.scrollingElement.scrollHeight)`)
        .catch(() => undefined)
    }
    if (attempt === 16) {
      await page
        .evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          if (el !== null) el.scrollIntoView({ block: 'center' })
        })()`)
        .catch(() => undefined)
    }
    await page.waitForTimeout(100)
  }
  return false
}
