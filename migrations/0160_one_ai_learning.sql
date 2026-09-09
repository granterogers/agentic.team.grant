-- One AI Learning.
--
-- Grant, asked whether the duplicate should be merged, renamed or archived:
-- *"1 merge"*.
--
-- ## What was actually there
--
-- Three projects, all created on 2026-09-07, all meaning the same thing:
--
--     ai-learning       "AI Learning"      archived   0 docs   notebook bef374e2
--     ai-learning-two   "AI Learning Two"  archived   0 docs   notebook 0235cb7b
--     ai-learning-2     "AI learning"      ACTIVE     1 doc    notebook 0eb1172a
--
-- So the merge is smaller than it sounds, and the shape of it is the finding.
-- Nothing has to move: the two archived rows hold no documents, and their
-- notebooks are gone from Google — `listNotebooks()` now returns three, and
-- neither `bef374e2` nor `0235cb7b` is among them. They are not projects with
-- content to fold in; they are the wreckage of the same intention expressed
-- three times.
--
-- What DOES have to happen is the part that stops it recurring: the names must
-- keep resolving. "AI Learning Two" is a phrase Grant used, and after a merge
-- that deleted it he would say it again and get nothing — or worse, a fourth
-- project. 0153 built the table for exactly this.
--
-- ## Why the slug changes
--
-- `ai-learning-2` is the artifact. The `-2` exists because
-- `app.hq_create_project` treated a name collision as a slug collision and
-- appended a number, which is the behaviour 0153 removed. Leaving the suffix in
-- place would leave the bug's signature on the canonical project forever.
--
-- The freed slug goes to the archived row rather than being vacated, because
-- slugs are unique and an archived project still has to be called something.
--
-- ## Nothing is deleted
--
-- Grant: *"you should always check before making any destructive action with
-- me."* He asked for a merge and this is one, but the two absorbed rows are
-- archived and stay archived — visible, restorable, and out of the way. Their
-- attachments are disabled with the reason, because a sync that keeps reaching
-- for a notebook Google no longer has is a recurring error with no fix.

begin;

-- ---------------------------------------------------------------------------
-- Free the slug
-- ---------------------------------------------------------------------------

update public.projects
   set slug = 'ai-learning-superseded-2026-09-07', updated_at = app.now_utc()
 where slug = 'ai-learning' and status = 'archived';

update public.projects
   set slug = 'ai-learning', channel_prefix = 'ai-learning', updated_at = app.now_utc()
 where slug = 'ai-learning-2';

-- ---------------------------------------------------------------------------
-- Every name it has ever been called still finds it
-- ---------------------------------------------------------------------------
--
-- Marked `grant`, not `inferred`: he authorised this merge, so these are names
-- he has used rather than guesses the system made. That matters because source
-- decides confidence, and confidence decides whether a match resolves silently.

insert into public.project_aliases (project_id, alias, source, confidence)
select p.project_id, x.alias, 'grant', 1.0
  from public.projects p
 cross join (values
   ('AI Learning Two'),
   ('AI learning 2'),
   ('ai-learning-2')
 ) as x(alias)
 where p.slug = 'ai-learning'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Stop reaching for notebooks that no longer exist
-- ---------------------------------------------------------------------------

update public.project_attachments a
   set enabled = false,
       disabled_reason = 'merged into ai-learning (0160); this notebook no longer '
                         'exists in Google — listNotebooks does not return it',
       updated_at = app.now_utc()
  from public.projects p
 where a.project_id = p.project_id
   and p.slug in ('ai-learning-superseded-2026-09-07', 'ai-learning-two')
   and a.enabled;

-- ---------------------------------------------------------------------------
-- And say what it is, so resolution has more than a name to work with
-- ---------------------------------------------------------------------------

update public.projects
   set description = coalesce(description,
         'Learning about AI: notes, sources and reading, in the notebook of the '
         'same name. Absorbed two duplicate projects on 2026-09-09 (0160).'),
       updated_at = app.now_utc()
 where slug = 'ai-learning';

commit;
