-- 0865 - a staff title that the project team editor corrupted by escaping it again on every save is repaired.
--
-- Found by signing in as the Sample Person and opening Global Settings: Grace's role read "Quality &amp;amp;amp;amp;...".
-- The project team editor in the web shell built its inputs with an escaped value, and the input part escapes attribute
-- values itself, so the box held an escaped ampersand in place of the ampersand, Save wrote that, and the next open escaped
-- it again. One row had been saved enough times to carry thirteen. The page is fixed in the same change (the value is
-- passed raw); this puts the one damaged row back to what migrations 0019 and 0071 wrote.
--
-- Narrow on purpose: only the staff title, only where the text still contains an escaped ampersand, and only to the
-- canonical value for that slug. A scan of name, title, pronouns, responsibilities and communication_style found this one
-- row, so nothing else is rewritten.

update public.staff
   set title = 'Quality & Risk Director'
 where slug = 'quality-director'
   and title ~ '&(amp;)+';
