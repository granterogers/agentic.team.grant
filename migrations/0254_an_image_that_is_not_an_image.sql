-- An image that is not an image should be a sentence, not a 502 (#83).
--
-- 0253 put a CHECK on the column -- `image like 'data:image/%'` -- and left the
-- function to fall into it. Over the real network that reads as:
--
--     project_look -> http 502 undefined
--
-- A constraint violation is an unhandled exception by the time it reaches the
-- edge function, so the caller gets a gateway error with no message at all.
-- The hue is validated in the function and answers "chartreuse is not one of
-- the palette colours"; the image was not, and answered nothing.
--
-- The CHECK stays. It is the backstop for every caller that is not this
-- function, and it is what will make it obvious the day somebody tries to put
-- a storage path in this column. What changes is that the function gets there
-- first and says why.
--
-- Found by calling the deployed endpoint rather than the function: in SQL the
-- exception is legible, and it is only over HTTP that it becomes a bare 502.

CREATE OR REPLACE FUNCTION app.hq_project_look(
  p_slug  text,
  p_icon  text default null,
  p_hue   text default null,
  p_image text default null,
  p_clear text[] default array[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
begin
  select project_id into v_project
    from public.projects
   where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;

  if p_hue is not null and p_hue not in
     ('p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum') then
    return jsonb_build_object('error', format('%s is not one of the palette colours', p_hue));
  end if;

  -- The new one. A URL to somewhere else is the likeliest mistake and the one
  -- worth naming: an image the office does not hold is an image that vanishes
  -- when that host does.
  if p_image is not null and p_image not like 'data:image/%' then
    return jsonb_build_object('error',
      'an image has to be sent as data, not as a link -- the page resizes it to 256px '
      || 'and encodes it before it gets here, so a link means something else called this');
  end if;

  if p_image is not null and length(p_image) > 98304 then
    return jsonb_build_object('error',
      'that image is too large once encoded -- it is resized to 256px before it is sent, '
      || 'so an image this big means the resize did not run');
  end if;

  update public.projects
     set icon     = case when 'icon'  = any(p_clear) then null
                         else coalesce(p_icon, icon) end,
         icon_hue = case when 'hue'   = any(p_clear) then null
                         else coalesce(p_hue, icon_hue) end,
         image    = case when 'image' = any(p_clear) then null
                         else coalesce(p_image, image) end
   where project_id = v_project;

  return (
    select jsonb_build_object('ok', true, 'slug', p_slug,
             'icon', pr.icon, 'hue', pr.icon_hue,
             'image', case when pr.image is null then null else 'set' end)
      from public.projects pr where pr.project_id = v_project
  );
end;
$function$;
