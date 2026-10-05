-- The office told the team nothing from the files a person uploaded had been indexed, while holding the text of them (#408).
--
-- `app.project_knowledge` says what a search can and cannot speak for. It counted indexed documents by CONNECTOR, and a
-- file a person drops in has none (0414: a desktop is the absence of a connector), so a project with an `upload`
-- attachment and ten searchable files read as "attached, and nothing of it is in the index": `blank`, and not `complete`.
-- The note the model then reads said so in words ("the files you uploaded is attached to this project and nothing from it
-- has been indexed yet") directly beside the documents it had just been given. A model handed that and the evidence at once
-- answers "I have nothing on it" - which is what the benchmark's task and document questions did on some runs.
--
-- The count now speaks the attachment's vocabulary: a stored file of yours whose text has been read is indexed material
-- of the `upload` connector. One that has not been read (a PDF, a photograph) is still NOT counted, so an upload of nothing
-- searchable still reads as blank, which is true.
--
-- Spliced from the live definition, each anchor asserted to be found exactly once.

begin;

do $do$
declare
  v_def text := pg_get_functiondef('app.project_knowledge(uuid,uuid)'::regprocedure);
  v_next text;
  v_pairs text[][] := array[
    array[$a$    select d.connector,
           count(*)::int as documents,$a$,
          $b$    select case when coalesce(btrim(d.connector), '') = '' then 'upload' else d.connector end as connector,
           count(*)::int as documents,$b$],
    array[$a$       and coalesce(btrim(d.connector), '') <> ''
     group by d.connector$a$,
          $b$       and (coalesce(btrim(d.connector), '') <> ''
            or (d.origin = 'yours' and d.content is not null and d.state <> 'archived'))
     group by 1$b$]
  ];
  i integer;
  v_hits integer;
begin
  v_next := v_def;
  for i in 1 .. array_length(v_pairs, 1) loop
    v_hits := (length(v_next) - length(replace(v_next, v_pairs[i][1], ''))) / length(v_pairs[i][1]);
    if v_hits <> 1 then
      raise exception 'anchor % found % times in app.project_knowledge', i, v_hits;
    end if;
    v_next := replace(v_next, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_next;
end
$do$;

commit;
