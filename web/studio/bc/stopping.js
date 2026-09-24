/*
  WHICH JOBS THIS BROWSER HAS ASKED TO STOP  (§20.2)

  Its own module because two files need it and neither may import the other:
  `wire.js` records the asking when the press succeeds and `shell.js` draws the
  row that says so, and an import between them would be a cycle.

  WHY IT IS NOT READ FROM THE OFFICE. `app.request_stop` stamps
  `stop_requested_at` on the job -- the canonical fact -- and
  `app.studio_requests` does not project it. Adding the key is one spliced line
  in a migration and it cannot be applied from here: the shared database is 56
  migrations ahead of anything this branch can reach, all of them belonging to
  a branch whose files are not on main, so `npm run migrate` refuses to run at
  all and is right to. That is a blocker on somebody else's work, written down
  rather than worked around quietly, and the line is ready for the day the
  files arrive.

  So this remembers the ASKING, not the stopping, and the row says exactly
  that. It is per-browser and lost on a reload, which is honest about what it
  knows: the request reached the office, and whether the worker has noticed is
  not something this page can see. When the job really stops it leaves the list
  on the next payload, which is the confirmation that matters.
*/

const asked = new Set()

/** Remember that a stop was asked for, so the row stops offering it again. */
export const remember = (id) => {
  if (typeof id === 'string' && id !== '') asked.add(id)
}

/** Has this browser already asked for this one to stop? */
export const wasAsked = (id) => asked.has(String(id ?? ''))
