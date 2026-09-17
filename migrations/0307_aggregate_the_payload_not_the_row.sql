begin;

/**
 * `jsonb_agg(x)` where x is the subquery alias aggregates the ROW, not the
 * payload.
 *
 * 0306 built the two halves of the Sources list as a union of
 * `(ord, at, v)` rows and then wrote `jsonb_agg(x order by x.ord, x.at)`.
 * `x` there is the whole row, so every element of the array came back as
 * `{"ord": 0, "at": "...", "v": {...}}` — and the page, reading `kind` and
 * `name` off the top level, got null for every field of every source.
 *
 * It did not throw and it did not return an empty list. It returned the right
 * NUMBER of sources with nothing in them, which is the failure shape this
 * repository keeps meeting: a card with nothing in it has no overflow, no
 * small type and no bad contrast, and every check passes.
 *
 * The sort keys have to stay out of the aggregate's payload, so the fix is to
 * name the column rather than the row: `jsonb_agg(both_kinds.v order by
 * both_kinds.ord, both_kinds.at)`.
 */

create or replace function app.studio_sources(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(both_kinds.v order by both_kinds.ord, both_kinds.at), '[]'::jsonb)
    from (
      select 0 as ord, a.created_at as at, jsonb_build_object(
               'kind', 'connector',
               'id', a.attachment_id,
               'connector', a.connector,
               'ref', a.external_ref,
               'url', a.external_url,
               -- The individual thing here, because that is what a Sources row
               -- is for: which notebook, which database, which folder. The
               -- card above says the kind.
               'name', coalesce(nullif(a.display_name, ''), app.connector_label(a.connector)),
               'via', app.connector_label(a.connector),
               'what', a.role,
               'health', case when a.enabled then 'ok' else 'blocked' end,
               'problem', a.disabled_reason,
               'last', case when a.last_synced_at is null then 'never'
                            else to_char(a.last_synced_at, 'FMDD Mon') end,
               'gave', (select count(*)::int from public.documents d
                         where d.project_id = p_project_id
                           and coalesce(d.connector, '') = a.connector)
             ) as v
        from public.project_attachments a
       where a.project_id = p_project_id

      union all

      /*
        A reference carries no `health`, no `last` and no `gave`, and that is
        the point rather than an omission: it is a pointer, it never fails, and
        nothing has read it. A null health is what tells the page to draw it as
        the other kind of thing.
      */
      select 1 as ord, r.created_at as at, jsonb_build_object(
               'kind', 'reference',
               'id', r.reference_id,
               'ref', r.kind,
               'url', r.url,
               'name', r.title,
               'via', case r.kind
                        when 'api' then 'An API'
                        when 'folder' then 'A folder'
                        when 'document' then 'A document'
                        when 'application' then 'An application'
                        when 'website' then 'A website'
                        else 'A reference'
                      end,
               'what', nullif(r.note, ''),
               'health', null,
               'problem', null,
               'last', null,
               'gave', null
             ) as v
        from public.project_references r
       where r.project_id = p_project_id
    ) both_kinds
$$;


commit;
