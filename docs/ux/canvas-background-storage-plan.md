# Custom canvas backgrounds on every device: the smallest safe path

**Status, 10 October 2026: this plan is now IMPLEMENTED on the branch and proved on the isolated replica (ADR-0070); it is NOT applied to production
and NOT deployed.** What was built and how to ship it: `docs/ux/deploy-442-445.md`. Differences from the plan below: the revision is the object's
last-written time in base 36 (not a SHA-1) so a read needs no download; a project is named by slug inside the verified office through an optional `p_slug` on
`hq_upload_target` (migration 1024) rather than by project id; deletion of a project is handled by a fail-safe sweep on every put/delete, since the gateway has no
project delete. Until it is deployed, a person's own picture lives in that browser only and the picker says so.

Original plan follows, unchanged. Tracked by #445. Decisions so far: ADR-0069, ADR-0070.

## What already exists (read from the repository, not assumed)

| Piece | Where | What it gives us |
|---|---|---|
| A private object bucket, `files` | `migrations/0205_a_document_can_be_a_file.sql` (`public = false`, 100 MB per object) | Somewhere private to put bytes. Nothing in a browser can read it without a signed link. |
| One image action precedent | `hq-api` `contact_photo` (`supabase/functions/hq-api/index.ts`, about line 2473) | A base64 body, MIME allow-list (jpeg, png, webp, gif, avif), 2 MB cap, object path built from server-known ids, `x-upsert`, then a signed link (10 minutes) back. |
| Upload authorisation before the write | `app.hq_upload_target` / `public.hq_upload_target(p_office, p_kind, p_project_id, p_contact_id, p_by)` (`0650`, `0688`) | Authenticate, then ask the database whether the target is real INSIDE the verified office, then write the object. A foreign project and a missing one return the same refusal; a guest or a member without authority is refused by `app.authority_refusal`. The `kind` list is closed: `contact_photo`, `document_upload`, anything else is `no such upload`. |
| An office-prefixed key convention | `app.hq_contact_photo_set` (`0730`) accepts a path under the contact's project folder OR under `<office_id>/` | Object keys that begin with the office id are already an accepted shape. |
| A larger-file precedent | `document_upload`: 8 MB, base64 in a JSON body, path `<project>/upload/<uuid>.<ext>` | A 3 MB picture is well inside what the gateway already accepts. |
| The per-person, per-project reference | the workspace document (`layout.js`), saved by `dashboard_layout_set` | Already holds `bg`. No table is needed to remember WHICH picture a project uses. |
| Sample visitors are read-only | `hq-api` refuses guest writes (`sample_readonly`) | A visitor can never upload; the page already sends them no layout writes. |

## The smallest safe design

**Store one object per project in the private bucket and keep the reference in the layout document that already exists.**

1. **Object key (server-derived, never taken from the request):** `files/<office_id>/backgrounds/<project_id>.<ext>`. One image per project, replaced in place
   (`x-upsert`). `ext` comes from the SNIFFED type (jpeg, png, webp, avif), not from the file name.
2. **Write path (a new `hq-api` action, `project_background_put`):** body `{ p_slug, image (base64), mime }`. Order, as for every upload: verify the session and office;
   resolve `p_slug` to a project INSIDE that office; call `hq_upload_target` with the new kind; only then write the object. The action refuses a Sample visitor like every write.
   Server checks (do not trust the page): at most 3 MB after base64 decode; magic bytes are jpeg, png, webp or avif (same sniff as `web/studio/bc/backdrop.js`, which is pure and can be shared);
   header width and height at most 4096 on a side and 16 megapixels; no SVG; `Content-Type` set from the sniffed type. The page has already shrunk the picture to at most 2560px, so a
   legitimate upload is a few hundred KB.
3. **Read path (a new `hq-api` section, `project_background?slug=`, or a field on the existing project payload):** authorises the project inside the office, then returns a signed link
   (suggest 1 hour, not 10 minutes, because it is a background that stays on screen) plus the object's `rev`. A foreign or missing project answers `null`, the same as "no picture".
   The page loads the link into the same CSS variable it uses today, and keeps the bytes in the IndexedDB it already has as a cache, keyed by `rev`.
4. **Delete (`project_background_delete`):** same authorisation; removes the object; the page sets the project's background to the default (`{ id: 'default' }`), which is already a choice that wins the merge.
5. **The reference:** the layout document's `bg` for a custom picture gains one optional field, `rev` (the first 12 hex characters of the SHA-1 of the stored bytes, returned by the put).
   A device whose cached `rev` differs asks for the new link; a device whose reference names a `rev` the office no longer has shows the default and says so. Older pages ignore the field.
   Two devices that choose different pictures are settled by the existing newer-choice merge.
6. **Quota (no table needed):** at most 12 custom backgrounds per office, enforced by the gateway listing the `files/<office_id>/backgrounds/` prefix (Storage list API) before it writes
   a new key. Together with 3 MB per object, an office can hold at most about 36 MB of backgrounds.

## Security model

- **Authority is the verified session and nothing else.** No office, project id, path or owner appears in the request that is trusted; the object key is built from the office the
  session proved and the project the DATABASE resolved from the slug inside that office.
- **Tenant boundary:** the key begins with the office id; the authorisation question is asked inside the office before any byte is written (the 0650/0688 lesson); the same refusal
  for a foreign and a missing project; the bucket is private so there is no unsigned URL; signed links are minted only after the same question is answered for a read.
- **No new trust in the browser:** the server re-checks type, size and dimensions; it never executes or renders the file (it is served only as an image from the storage origin;
  active content is refused at the gate).
- **Guests:** refused (they are read-only by construction).
- **Nothing sensitive in the layout row:** it holds a `rev`, never bytes, never a link (links expire).
- **Removal of a person or a project:** the repository records that no code path removes a bucket object except teardown (the comment in `0907`), so a deleted project would leave its
  picture behind. Either have the gateway delete the one key when it deletes a project, or add a small sweep that lists `<office_id>/backgrounds/` against live projects. Without one,
  a deleted project leaves at most 3 MB behind.
- **Guests are refused by default:** the gateway refuses every action not on its guest allow-list (`GUEST_MAY`, `sample_readonly`), so a new upload action is closed to visitors until someone
  deliberately lists it, which this plan does not.

## Costs

- **Money:** none beyond the existing free tier. The `files` bucket and the signed-link API are already in use; no new service, provider or subscription.
- **Storage:** at most 3 MB per project and 12 per office, so at most about 36 MB per office; a handful of offices is well inside the free tier's 1 GB, but the real headroom
  must be read from the project's storage usage before relying on this (not measured here).
- **Egress:** a device fetches a picture once per `rev` (then serves it from its IndexedDB), so roughly 3 MB per device per change, not per visit.
- **Compute:** one extra edge-function path per upload (a base64 decode and a sniff; the larger `document_upload` precedent already does more).

## What it needs that I am not allowed to do without a decision

1. **One migration**, additive and reversible: replace `public.hq_upload_target` so the closed `kind` list also accepts `project_background` (project inside the office; the same guest
   refusal; the error text mapped like the other kinds). **No new table, no new column.** If the project-delete cleanup is chosen, one more `create or replace` of `app.project_delete`
   is NOT needed (the delete can be gateway-side); only a sweep duty would add a row to `public.responsibilities`.
2. **A deployment of the `hq-api` edge function** with the three new entries (and the matching `check:gateway-wrappers` and `check:pressable` baselines, which require a page caller: the picker).
3. **A frontend change** (on this branch, small): upload on Apply, signed-link read on load, `rev` in `cleanBg`, IndexedDB demoted to a cache.
4. **Production writes authority** for the migration and the function deploy, scoped to those two operations, with a rollback artefact for each (the previous `hq_upload_target`
   definition is the previous migration's; the function bundle can be captured with `scripts/forensics/capture-functions.ts`).

## Acceptance tests (all must pass before this replaces browser-only)

On a replica first (`scripts/isolated/`, the way `layout-isolation.ts` is proved), then once against production with a test office:

1. A member uploads a valid picture for their own project: stored under `<office>/backgrounds/<project>`, link returned, picture drawn.
2. **Cross-tenant write refused:** a session of office B naming office A's project slug (and, separately, A's project id) is refused with the same answer as a missing project, and NO object exists afterwards.
3. **Cross-tenant read refused:** office B asking for office A's project's background gets `null`; no signed link is ever minted for another office's key.
4. A Sample visitor / guest upload is refused; the bucket is unchanged.
5. Refused with a sentence and no object written: SVG, HTML renamed `.png`, a header claiming over 4096px or 16 MP, over 3 MB, an empty body, a type outside the list, base64 that does not decode.
6. A path-shaped slug (`../x`, `a/b`) writes nothing outside the office prefix.
7. The 13th picture in an office is refused; replacing one of the 12 is not.
8. Two devices choose different pictures at nearly the same time: both converge on the newer, and a Post-it written by a third device is untouched (the existing merge tests, extended with `rev`).
9. Device B opens a project whose picture was set on device A: it is drawn (loaded from the signed link, cached by `rev`), and a second open does not fetch it again.
10. Remove: the object is gone, the reference is the default on every device.
11. Delete the project: the object is removed (or swept), and a signed link minted before the delete stops working at expiry.
12. An expired signed link is refreshed by asking again; a missing object shows the default and says so.
13. `check:ownership`, `check:gateway-wrappers`, `check:pressable`, `check:callers`, `check:anon-exposure` stay green; `tests/safety` stays green for the new migration and function deploy.
14. Sabotage controls: remove the in-office authorisation call and tests 2 and 3 go red; widen the type list to SVG and test 5 goes red.

## Until then

The picker says a picture is kept in this browser, and a device without it shows the default and says why (verified: `verify:canvas-background`). #445 stays open for this.
