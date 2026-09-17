/*
  0409 - twelve defaults named a mark nobody can draw (#221).

  0408's own header says a default naming an icon the page cannot draw "would
  be the registry-row defect with a friendlier face". It shipped with twelve of
  them: book-open, file-text, files, life-buoy, package, rocket, scale,
  shield-alert, shield-check, smartphone, trending-up and workflow are all real
  lucide icons and none is in the 451 this office selected.

  A comment claiming a property is worth nothing without a check - fourth
  instance in this repository, and the first where the comment and the defect
  were written in the same file, in the same hour.

  0407's app.icon_key_ok checks the SHAPE and every one of the twelve passes
  it, correctly: they are well-formed keys. Shape was the right check for the
  free-text field a person types into and it cannot answer "does this exist",
  because the database does not hold the library and should not - a copy of
  451 keys in SQL is a second place for them to rot.

  So the check lives where the library does. `npm run check:icons` reads
  web/studio/vendor/icons-library.js and public.icon_defaults and fails on any
  default the page cannot draw. It is in the pre-push set, which is the layer
  that can see both halves.
*/

update public.icon_defaults set icon = 'book' where icon = 'book-open';
update public.icon_defaults set icon = 'file' where icon in ('file-text', 'files');
update public.icon_defaults set icon = 'heart-handshake' where icon = 'life-buoy';
update public.icon_defaults set icon = 'boxes' where icon = 'package';
update public.icon_defaults set icon = 'target' where icon = 'rocket';
update public.icon_defaults set icon = 'gavel' where icon = 'scale';
update public.icon_defaults set icon = 'shield' where icon in ('shield-alert', 'shield-check');
update public.icon_defaults set icon = 'phone' where icon = 'smartphone';
update public.icon_defaults set icon = 'chart-line' where icon = 'trending-up';
update public.icon_defaults set icon = 'settings' where icon = 'workflow';
