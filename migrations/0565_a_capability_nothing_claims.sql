/*
  Two capabilities this office HAS and no agent had ever been told about.

  0298 added `tool_permissions.delivered_by` because a registry row claimed
  `web.search` with nothing in the repository implementing it, and every agent
  was told it could search the web. That migration fixed one direction and
  named the other in its own comment without closing it: being told NO about
  something possible costs a feature request.

  This is that other direction, measured. Eight executable handler kinds are
  named by no row at all, and of the eight job kinds a CONVERSATION can start
  -- the set `office.instruction` enqueues -- three were unrepresented:

    artifact.report   139 jobs, completing, producing real PDFs on real
                      projects since 17 September
    browser.gather    5 jobs, completing
    (and two kinds covered by a row whose delivered_by did not name them)

  `capabilityBrief` builds every agent's prompt from this table. So the office
  could make a beautifully typeset PDF and deliver it on Telegram, had done so
  139 times, and not one of the eight agents knew -- which is why, asked for a
  better version of a PDF it had just made, it answered "I can't create a PDF
  directly in Telegram" and offered a Notion page to export by hand (#320).
  The model was not hallucinating. It was reading its brief.

  ## The levels

  Both are 1, matching `drive.ingest` and `task.create`: they write something
  into a dashboard project, which is a change Grant can see and undo, and
  neither reaches outside the office on its own authority.

  ## web.read is not web.search, and the difference is the point

  `web.search` is OFF (0298) because nothing implements it. Opening a NAMED
  address is a different capability with a real runtime behind it, and
  conflating them is how an agent that has been told "no web" declines to read
  a link Grant just pasted. Two rows, two truths.

  ## in_reply, which 0508 made load-bearing

  Both true: the answering colleague CAN cause these now, because the
  conversation enqueues the child itself. The verbs carry the honest
  qualification that the file ARRIVES SEPARATELY -- so an agent says it has
  started one, never that it is attached to the sentence being written.
*/

insert into public.tool_permissions
  (tool, level, description, enabled, delivered_by, in_reply, verbs)
values
  ('document.create', 1,
   'Produce a finished, typeset PDF document and deliver it on the channel that asked',
   true,
   'job kind artifact.report',
   true,
   array[
     'produce a real PDF -- cover, headings, tables, charts -- and deliver it on this channel',
     'say you have STARTED one: it arrives shortly after your reply, never attached to it'
   ]),
  ('web.read', 1,
   'Open a web address Grant has named, read the page, and file what it says on the project',
   true,
   'job kind browser.gather',
   true,
   array[
     'open a web address Grant names and file what the page says on the project',
     'not a search: you can open an address given to you, not go looking for one'
   ])
on conflict (tool) do update
  set description  = excluded.description,
      enabled      = excluded.enabled,
      delivered_by = excluded.delivered_by,
      in_reply     = excluded.in_reply,
      verbs        = excluded.verbs;

/*
  Two rows whose delivered_by did not name every kind they deliver.

  Not cosmetic: the check added beside this migration asks whether the kind a
  conversation enqueues is named by an enabled row, and a row that performs
  three kinds while naming two leaves the third looking unimplemented.
*/
update public.tool_permissions
   set delivered_by = 'job kinds notebook.ask, notebook.collect and notebook.list_artifacts'
 where tool = 'notebook.read';

update public.tool_permissions
   set delivered_by = 'job kinds office.notion_import, office.notion_sync and office.notion_adopt'
 where tool = 'notion.write';

/*
  And granted, to everybody who already holds the neighbouring tools.

  A capability enabled and granted to nobody lands in `mustAsk`, whose brief
  sentence is "the office can do this but you do not hold it -- ask rather than
  saying it is impossible". That is the right sentence for a tool a person
  genuinely may not use, and the wrong one here: the office has been making
  these PDFs on request, without asking anybody, for six days. The registry
  should describe what happens.

  Keyed off `db.read`, which every one of the eight holds, rather than a list
  of slugs that the next hire would fall out of.
*/
insert into public.staff_tools (staff_slug, tool)
select st.staff_slug, t.tool
  from public.staff_tools st
 cross join (values ('document.create'), ('web.read')) as t(tool)
 where st.tool = 'db.read'
on conflict do nothing;
