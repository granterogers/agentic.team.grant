-- 0104 — Voice has an actor too, and the trigger should resolve it
--
-- `verify:cross-interface` grew a voice row and it failed on one column:
-- `subject`. Slack's `U0BUNF6AALC` and Telegram's `1386648496` both resolve to
-- 'grant' through 0056's identity map; the voice row's subject was null.
--
-- The endpoint had been setting `subject` itself, which hid this — and hiding
-- it is the problem. §31's whole claim is that the backend sees one person
-- however he arrives, and it is `app.subject_for` that makes that true. A
-- channel that writes its own subject is a channel exempt from the mapping,
-- and the exemption is invisible until something compares the rows.
--
-- So: an identity row for voice, and the adapter stops asserting who Grant is.
-- The actor it presents is the one it knows — there is no device id worth
-- having on a web page — and the map turns that into the person, exactly as it
-- does for the other two.
--
-- The failure is worth keeping in mind: it took a THIRD interface to notice
-- that the equality was being asserted rather than resolved.

begin;

insert into public.subject_identities (subject, origin_channel, actor, note)
values ('grant', 'voice', 'grant',
        'Talk to Team in the web front end. The page has no device identity '
        'worth persisting, so the adapter presents the subject name and the '
        'map resolves it like any other actor.')
on conflict (origin_channel, actor) do nothing;

commit;
