/*
  0471 — what is waiting for Grant to approve, in the states that exist

  `app.awaiting_review` has existed since 0176 and has never returned a single
  row. It filters `state = 'review'`, and NOTHING in this repository has ever
  written that state: `public.documents` holds 98 approved, 13 made (7 of them
  archived) and exactly one `draft`, which is what `handlers/artifact.ts`
  writes when the office produces a file. So the function that answers "what
  has the team made that you have not looked at" answered "nothing", for
  months, while a PDF sat in draft.

  It is the found-nothing shape CLAUDE.md warns about three times: a reader
  whose happy path is an empty list cannot be told apart from a reader that
  cannot see. And it compounded a second gap — nothing in `web/` calls it, so
  0315's review gate had a state and no press. `#28`'s criterion that an
  unapproved output is not in the project is enforced (0315 filters the
  gallery), and the other half, that Grant can let one IN, had no control at
  all.

  Two changes, both narrow:

  * the predicate becomes `state in ('draft','review')` — the states that mean
    "made, not yet decided". `approved` and `archived` are decisions and stay
    out.
  * the row carries `state` and `kind`, because the page draws a PDF and a note
    differently and asking a second endpoint for that would be a second list of
    the same rows (0306's lesson about two assemblies).

  The return type changes, so both halves are dropped by their exact
  signatures first: `create or replace` does not replace a function whose
  result columns changed.
*/

drop function if exists public.awaiting_review(uuid);
drop function if exists app.awaiting_review(uuid);

create function app.awaiting_review(p_project uuid)
returns table (
  document_id uuid, title text, produced_by text, produced_by_job uuid,
  created_at timestamptz, derived_from text[], state text, kind text
)
language sql stable security definer set search_path = '' as $$
  select d.document_id, d.title,
         -- 0284: `produced_by` is NOT NULL defaulting to the empty string, so
         -- coalesce on it is dead code. nullif is what actually fires.
         coalesce(nullif(d.produced_by, ''), 'The team') as produced_by,
         d.produced_by_job, d.created_at,
         coalesce(array_agg(src.title order by src.title)
                    filter (where src.title is not null), '{}') as derived_from,
         d.state,
         case
           when coalesce(d.mime_type, '') like 'audio/%' then 'audio'
           when coalesce(d.mime_type, '') = 'application/pdf'
             or d.title ilike '%.pdf' then 'pdf'
           else 'doc' end as kind
    from public.documents d
    left join public.relations r
           on r.from_kind = 'document' and r.from_id = d.document_id
          and r.verb = 'derived_from' and r.to_kind = 'document'
    left join public.documents src on src.document_id = r.to_id
   where d.project_id = p_project
     and d.origin = 'made'
     and d.state in ('draft', 'review')
   group by d.document_id, d.title, d.produced_by, d.produced_by_job,
            d.created_at, d.state, d.mime_type
   order by d.created_at desc
$$;

create function public.awaiting_review(p_project uuid)
returns table (document_id uuid, title text, produced_by text, produced_by_job uuid,
               created_at timestamptz, derived_from text[], state text, kind text)
language sql stable security definer set search_path = '' as $$
  select * from app.awaiting_review(p_project)
$$;

comment on function app.awaiting_review(uuid) is
  'What the team has made and Grant has not decided about (#28). Draft AND '
  'review: nothing has ever written the review state, so the original '
  'predicate could not match a row and the queue was empty by construction.';

grant execute on function public.awaiting_review(uuid) to authenticated, anon, service_role;
