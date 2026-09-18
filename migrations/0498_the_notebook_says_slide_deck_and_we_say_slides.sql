/*
  One vocabulary for an artifact kind (#260).

  The provider answers `slide_deck` and `mind_map`. This office says `slides`
  and `mindmap` — in `ARTIFACT_KINDS`, in the request matcher, in the job
  payloads, and in the page's `KIND_SAID`. Adoption stored the wire word
  verbatim, and `public.artifacts.kind` has no CHECK to refuse it, so the page
  fell through to the raw string for a kind it has no English for: a slide
  deck Grant made himself appeared on his Sources tab as **slide_deck**.

  Nothing failed, which is why nothing caught it. The unknown-kind fallback
  exists so a NEW type cannot break enumeration (0429's third rule), and it
  did exactly its job over a type that is not new at all.

  Found by listing Grant's four real notebooks rather than by reading code:
  12 artifacts, 3 of them slide decks or mind maps. One had already been
  adopted and is corrected below.

  0311 is the migration about this shape — two words for one thing, and no
  reader able to tell them apart. The translation now happens once, at the
  adapter boundary, in `officeKind`.

  ## Why there is deliberately NO check constraint here

  The obvious hardening is a CHECK restricting `kind` to the office's list.
  It would be wrong. 0429's third rule is that an unknown kind must not break
  enumeration — a provider shipping a type nobody has mapped yet should still
  be listed, with the stored word shown plainly, rather than refused. A CHECK
  would turn a new artifact type into a lost artifact, which is a worse
  failure than an ugly label.

  What replaces it is a property a suite can assert: no stored kind is a
  KNOWN library word that should have been translated. That catches
  `slide_deck` and permits `some_future_thing`, which is exactly the
  distinction a CHECK cannot make.

  No backticks in any comment in this file.
*/

update public.artifacts set kind = 'slides' where kind = 'slide_deck';
update public.artifacts set kind = 'mindmap' where kind = 'mind_map';
update public.artifacts set kind = 'study_guide' where kind = 'studyguide';

/*
  Asserted rather than assumed. A migration that matched nothing looks exactly
  like one that worked, which this repository records about teardowns and
  which is just as true of a data correction.
*/
do $check$
declare
  v_left int;
begin
  select count(*) into v_left from public.artifacts
   where kind in ('slide_deck', 'mind_map', 'studyguide');
  if v_left <> 0 then
    raise exception 'the wire vocabulary is still stored on % row(s)', v_left;
  end if;
  /*
    And the office's own words survived the correction. An update keyed on the
    wrong side would have left this at zero, which would read as success.
  */
  select count(*) into v_left from public.artifacts where kind in ('slides', 'mindmap');
  if v_left = 0 then
    raise exception 'there are now no slide decks or mind maps at all, which is not a fix';
  end if;
  raise notice 'artifact kinds speak one vocabulary: % row(s) of slides or mindmap', v_left;
end
$check$;
