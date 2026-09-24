--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: job_transitions_allowed; Type: TABLE DATA; Schema: app; Owner: -
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE app.job_transitions_allowed DISABLE TRIGGER ALL;

INSERT INTO app.job_transitions_allowed VALUES
	('queued', 'running'),
	('queued', 'cancelled'),
	('queued', 'paused'),
	('queued', 'failed'),
	('running', 'waiting_external'),
	('running', 'waiting_user'),
	('running', 'output_created'),
	('running', 'retrying'),
	('running', 'paused'),
	('running', 'cancelled'),
	('running', 'failed'),
	('waiting_external', 'running'),
	('waiting_external', 'retrying'),
	('waiting_external', 'paused'),
	('waiting_external', 'cancelled'),
	('waiting_external', 'failed'),
	('waiting_user', 'running'),
	('waiting_user', 'paused'),
	('waiting_user', 'cancelled'),
	('waiting_user', 'failed'),
	('output_created', 'quality_review'),
	('output_created', 'retrying'),
	('output_created', 'paused'),
	('output_created', 'cancelled'),
	('output_created', 'failed'),
	('quality_review', 'committing'),
	('quality_review', 'running'),
	('quality_review', 'retrying'),
	('quality_review', 'paused'),
	('quality_review', 'cancelled'),
	('quality_review', 'failed'),
	('committing', 'committed'),
	('committing', 'retrying'),
	('committing', 'failed'),
	('committed', 'notifying'),
	('committed', 'failed'),
	('notifying', 'complete'),
	('notifying', 'retrying'),
	('notifying', 'failed'),
	('retrying', 'queued'),
	('retrying', 'cancelled'),
	('retrying', 'failed'),
	('retrying', 'paused'),
	('paused', 'queued'),
	('paused', 'cancelled'),
	('paused', 'failed');


ALTER TABLE app.job_transitions_allowed ENABLE TRIGGER ALL;

--
-- Data for Name: asset_actions; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.asset_actions DISABLE TRIGGER ALL;

INSERT INTO public.asset_actions VALUES
	('review', 'Review', 'Review %s and tell me what you think.', false, 0),
	('summarise', 'Summarise', 'Summarise %s.', false, 1),
	('research', 'Research', 'Research the questions %s raises, and come back with what you find.', false, 2),
	('critique', 'Critique', 'Critique %s — what is weak, what is missing, what would not survive scrutiny.', false, 3),
	('extract_tasks', 'Extract tasks', 'Read %s and pull out the things that need doing, as tasks on this project.', false, 4),
	('compare', 'Compare', 'Compare %s with the other one I have attached, and tell me how they differ.', true, 5);


ALTER TABLE public.asset_actions ENABLE TRIGGER ALL;

--
-- Data for Name: autonomy_policy; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.autonomy_policy DISABLE TRIGGER ALL;

INSERT INTO public.autonomy_policy VALUES
	('observe', 0, 'proceed', 'Reading is what observing is.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('observe', 1, 'refuse', 'Observing means it does not write, even internally.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('observe', 2, 'refuse', 'Nothing leaves the building.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('observe', 3, 'refuse', 'Nothing leaves the building.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('suggest', 0, 'proceed', 'Reading is never the thing worth asking about.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('suggest', 1, 'ask', 'It proposes; you decide, even for a draft.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('suggest', 2, 'ask', 'It proposes; you decide.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('suggest', 3, 'ask', 'It proposes; you decide.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act_with_review', 0, 'proceed', 'Reading is never the thing worth asking about.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act_with_review', 1, 'proceed', 'Internal work happens and you see it afterwards.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act_with_review', 2, 'ask', 'Anything that leaves the building still waits.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act_with_review', 3, 'ask', 'Consequential work always waits.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act', 0, 'proceed', 'Reading is never the thing worth asking about.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act', 1, 'proceed', 'It acts.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act', 2, 'proceed', 'It acts, including outward.', 'the default matrix', '2026-09-24 09:30:32.3403+00'),
	('act', 3, 'ask', 'Consequential work always waits, at every level.', 'the default matrix', '2026-09-24 09:30:32.3403+00');


ALTER TABLE public.autonomy_policy ENABLE TRIGGER ALL;

--
-- Data for Name: breadth_dimensions; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.breadth_dimensions DISABLE TRIGGER ALL;

INSERT INTO public.breadth_dimensions VALUES
	('agents', 'who', 'every member of the roster is reachable', '2026-09-24 09:30:31.10112+00'),
	('declared-capabilities', 'who', 'what an agent says it can do', '2026-09-24 09:30:31.10112+00'),
	('tools-and-integrations', 'who', 'the meaningful ones, not every registry row', '2026-09-24 09:30:31.10112+00'),
	('research', 'work', '', '2026-09-24 09:30:31.10112+00'),
	('analysis', 'work', '', '2026-09-24 09:30:31.10112+00'),
	('planning', 'work', '', '2026-09-24 09:30:31.10112+00'),
	('recommendations', 'work', '', '2026-09-24 09:30:31.10112+00'),
	('creation', 'work', 'writing and making, as opposed to answering', '2026-09-24 09:30:31.10112+00'),
	('actions', 'work', 'the office changes something outside itself', '2026-09-24 09:30:31.10112+00'),
	('project-management', 'work', '', '2026-09-24 09:30:31.10112+00'),
	('software-and-project-reasoning', 'work', '', '2026-09-24 09:30:31.10112+00'),
	('business-strategy', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('monetisation', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('finance', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('marketing-and-growth', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('communications', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('operations', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('quality-and-risk', 'domain', '', '2026-09-24 09:30:31.10112+00'),
	('connected-knowledge', 'context', 'work that depends on an attached source', '2026-09-24 09:30:31.10112+00'),
	('project-scoped-work', 'context', '', '2026-09-24 09:30:31.10112+00'),
	('cross-project-work', 'context', '', '2026-09-24 09:30:31.10112+00'),
	('memory-dependent-work', 'context', 'needs what was said earlier', '2026-09-24 09:30:31.10112+00'),
	('single-agent-work', 'shape', '', '2026-09-24 09:30:31.10112+00'),
	('multi-agent-work', 'shape', '', '2026-09-24 09:30:31.10112+00'),
	('tool-heavy-work', 'shape', '', '2026-09-24 09:30:31.10112+00'),
	('no-tool-reasoning', 'shape', '', '2026-09-24 09:30:31.10112+00'),
	('permission-gated-actions', 'shape', 'the office is allowed to refuse', '2026-09-24 09:30:31.10112+00'),
	('unavailable-capabilities', 'failure', 'asked for something it genuinely cannot do', '2026-09-24 09:30:31.10112+00'),
	('provider-failures', 'failure', '', '2026-09-24 09:30:31.10112+00'),
	('malformed-inputs', 'failure', '', '2026-09-24 09:30:31.10112+00'),
	('contradictory-instructions', 'failure', '', '2026-09-24 09:30:31.10112+00'),
	('corrections', 'failure', 'Grant says the previous answer was wrong', '2026-09-24 09:30:31.10112+00'),
	('changed-intent', 'failure', 'he wants something else now', '2026-09-24 09:30:31.10112+00'),
	('ambiguous-requests', 'language', '', '2026-09-24 09:30:31.10112+00'),
	('long-multi-clause', 'language', '', '2026-09-24 09:30:31.10112+00'),
	('voice-and-speech-style', 'language', 'how he actually talks into a phone', '2026-09-24 09:30:31.10112+00'),
	('hallucination-traps', 'failure', 'the answer is only available by making it up', '2026-09-24 09:30:31.10112+00');


ALTER TABLE public.breadth_dimensions ENABLE TRIGGER ALL;

--
-- Data for Name: ci_workflows; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.ci_workflows DISABLE TRIGGER ALL;

INSERT INTO public.ci_workflows VALUES
	('ci', 'Lint, typecheck, tests, the migration check and the secret scan, on a machine that is not the authoring session — the independent second opinion the local pre-push gate cannot give.', 6, 15, true, '', '2026-09-24 09:30:32.98918+00', '2026-09-24 09:30:32.98918+00');


ALTER TABLE public.ci_workflows ENABLE TRIGGER ALL;

--
-- Data for Name: knowledge_connectors; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_connectors DISABLE TRIGGER ALL;

INSERT INTO public.knowledge_connectors VALUES
	('upload', 'Direct upload', true, true, NULL, 'A document handed to the system with no external system behind it. external_ref is null, which is why the uniqueness index is partial.', '2026-09-24 09:30:23.532152+00', '2026-09-24 09:30:23.532152+00', NULL),
	('mcp', 'MCP client', true, true, NULL, 'Added by an MCP client (Claude, ChatGPT). A distinct connector from ''upload'' because "a model pasted this in" and "Grant uploaded this" are different provenances, and §10 is built on citations meaning something.', '2026-09-24 09:30:23.946475+00', '2026-09-24 09:30:23.946475+00', NULL),
	('notebooklm', 'Google NotebookLM', false, true, NULL, 'Re-enabled 2026-09-06 at Grant''s instruction. No public API, so the client impersonates a browser session - the behaviour the 2026-09-04 ban named. Everything it feeds is cached in public.documents, so if the account goes again the corpus stays (ADR-0013).', '2026-09-24 09:30:23.532152+00', '2026-09-24 09:30:26.091967+00', 'Google'),
	('notion', 'Notion', true, true, NULL, 'Official API, OAuth, documented rate limits, no policy exposure. The first-class connector under ADR-0013. Not yet implemented — a token from Grant is all it waits on.', '2026-09-24 09:30:23.532152+00', '2026-09-24 09:30:26.091967+00', 'Notion'),
	('github', 'GitHub', true, true, NULL, 'Official REST API, documented rate limits, no policy exposure — a first-class connector under ADR-0013, in the same tier as Notion. Public repositories need no credential at 60 requests an hour per address; private ones need a fine-grained token in the vault as `github.token`, which also raises the limit to 5,000. Read-only: `github.write` is registered at risk 3 and disabled (§13).', '2026-09-24 09:30:26.071384+00', '2026-09-24 09:30:26.091967+00', 'GitHub'),
	('drive', 'Google Drive', true, true, NULL, 'A folder per project, watched through the changes feed. Read-only: the scope is drive.readonly and nothing here writes to Grant''s Drive.', '2026-09-24 09:30:27.186102+00', '2026-09-24 09:30:27.186102+00', NULL),
	('browser', 'Signed-in browser', true, true, NULL, 'A real Chromium, opened somewhere ephemeral for one page at a time and then destroyed. The SESSION persists in the Vault; the browser does not, because a process held open between jobs is the one thing in this architecture that costs money. Reads and photographs. Does not press anything.', '2026-09-24 09:30:32.890859+00', '2026-09-24 09:30:32.890859+00', NULL);


ALTER TABLE public.knowledge_connectors ENABLE TRIGGER ALL;

--
-- Data for Name: connector_capabilities; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.connector_capabilities DISABLE TRIGGER ALL;

INSERT INTO public.connector_capabilities VALUES
	('notebooklm', 'list the notebooks', 'every notebook on the account', 'unofficial', 'no quota cost', 'job kind notebook.collect', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'read the account limits', 'tier, notebook and source ceilings', 'unofficial', 'no quota cost', 'app.notebook_allowance', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'list a notebook''s sources', 'each source and its text', 'unofficial', 'no quota cost', 'job kind notebook.collect', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'create a notebook', 'a new notebook', 'unofficial', 'counts against the notebook ceiling', 'job kind office.notion_import and the plan step create_project', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'add a source by URL or text', 'the source, indexed', 'unofficial', 'counts against the source ceiling', 'job kind notebook.add_source', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'ask the notebook a question', 'an answer grounded in the sources', 'unofficial', 'counts against the five-hour allowance', 'job kind notebook.ask', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'generate an artifact', 'audio overview, mind map, slide deck, report', 'unofficial', 'counts against the five-hour allowance; needs Grant''s approval first', 'job kind notebook.generate', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'download a generated artifact', 'the file itself', 'unofficial', 'no quota cost', 'job kind notebook.collect_artifact', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'create a note in a notebook', 'a note', 'unofficial', 'no quota cost', '', 'probe', '2026-09-24 09:30:29.742153+00'),
	('notebooklm', 'share a notebook with someone', 'nothing — a person must do this', 'browser_only', '', '', 'declared', NULL),
	('notebooklm', 'read another account''s notebook', 'nothing', 'none', '', '', 'declared', NULL),
	('notion', 'read the pages and databases shared with the integration', 'each page''s blocks as text', 'api', 'free tier', 'duty:notion-sync', 'suite', '2026-09-24 09:30:29.742153+00'),
	('notion', 'create a page in a data source', 'the page', 'api', 'free tier', 'job kind office.notion_import', 'suite', '2026-09-24 09:30:29.742153+00'),
	('notion', 'append blocks to a page', 'the updated page', 'api', 'free tier', 'job kind office.notion_import', 'suite', '2026-09-24 09:30:29.742153+00'),
	('notion', 'relate one page to another', 'the relation', 'api', 'free tier', 'job kind office.notion_import', 'suite', '2026-09-24 09:30:29.742153+00'),
	('notion', 'query a data source', 'matching rows', 'api', 'free tier', 'duty:notion-sync', 'suite', '2026-09-24 09:30:29.742153+00'),
	('notion', 'read or create a teamspace', 'nothing — Notion exposes none on any version', 'none', '', '', 'suite', '2026-09-24 09:30:29.742153+00'),
	('drive', 'watch a folder for changes', 'the changed files', 'api', 'free tier', 'job kind drive.watch', 'suite', '2026-09-24 09:30:29.742153+00'),
	('drive', 'write a file into Grant''s Drive', 'nothing — the scope is drive.readonly', 'none', '', '', 'declared', NULL),
	('github', 'read a repository''s tree, files, issues and releases', 'the content', 'api', 'free; 60 requests an hour unauthenticated, 5,000 with a token', 'src/github/api.ts', 'suite', '2026-09-24 09:30:29.742153+00'),
	('github', 'write to a repository', 'nothing — github.write is disabled at risk 3 (§13)', 'none', '', '', 'declared', NULL),
	('upload', 'accept a file handed to the office', 'a document row', 'api', 'free', 'hq-api, the studio upload', 'suite', '2026-09-24 09:30:29.742153+00'),
	('mcp', 'accept a document from an MCP client', 'a document row', 'api', 'free', 'the MCP server', 'suite', '2026-09-24 09:30:29.742153+00'),
	('drive', 'read a file — its text where Drive can export text, the file itself where it cannot', 'the text, or the bytes in the office''s own storage', 'api', 'free tier', 'job kind drive.read_file', 'suite', '2026-09-24 09:30:30.443533+00'),
	('browser', 'read a page the office is signed in to', 'the page''s words, kept as a source document', 'browser_only', 'ten browser-minutes a day free on Cloudflare''s Workers plan; metered by app.browser_budget', 'browser.gather', 'declared', NULL),
	('browser', 'photograph a page', 'a PNG in the private files bucket', 'browser_only', 'counts against the same ten minutes', 'browser.gather', 'declared', NULL),
	('browser', 'sign in on Grant''s behalf', 'nothing — the session is established by a person and stored in the Vault', 'none', 'a password typed by an agent is a password an agent can be talked into typing', '', 'declared', NULL),
	('browser', 'press a button, submit a form, or buy anything', 'nothing — the gather tier is read-only by design', 'none', 'acting needs its own approval path (#15), its own verbs and its own migration', '', 'declared', NULL);


ALTER TABLE public.connector_capabilities ENABLE TRIGGER ALL;

--
-- Data for Name: contact_labels; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.contact_labels DISABLE TRIGGER ALL;

INSERT INTO public.contact_labels VALUES
	('4a54dd06-23f3-4718-9a22-45a55465583b', 'grant', 'Client', 'p-moss', 0, '2026-09-24 09:30:29.375198+00'),
	('b9548393-b297-4d2c-b6a0-cf89e7f228ec', 'grant', 'Lead', 'p-amber', 1, '2026-09-24 09:30:29.375198+00'),
	('260355f1-3721-4d04-bfcd-704eb1f74d07', 'grant', 'Coach', 'p-iris', 2, '2026-09-24 09:30:29.375198+00'),
	('0722cdb7-b452-4ba2-be75-50891e461397', 'grant', 'Colleague', 'p-slate', 3, '2026-09-24 09:30:29.375198+00'),
	('eed0bc81-8c5b-42f9-835b-e92614c72eb2', 'grant', 'Referrer', 'p-rust', 4, '2026-09-24 09:30:29.375198+00');


ALTER TABLE public.contact_labels ENABLE TRIGGER ALL;

--
-- Data for Name: google_services; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.google_services DISABLE TRIGGER ALL;

INSERT INTO public.google_services VALUES
	('calendar', 'Google Calendar', 'Lets the team see what is on your diary, so they can answer questions about your week and avoid booking over it.', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly', true, 10),
	('gmail', 'Gmail', 'Lets the team search and read your mail, and draft replies for you. It can never send: §11 keeps sending off by policy, whatever the permission allows.', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose', true, 20),
	('drive', 'Google Drive', 'Lets the team read documents you point them at, so a brief can cite your own files instead of guessing.', 'https://www.googleapis.com/auth/drive.readonly', true, 30),
	('youtube', 'YouTube', 'Lets the team read your playlists and saved videos, so a video you saved can become a source like any other.', 'https://www.googleapis.com/auth/youtube.readonly', true, 40);


ALTER TABLE public.google_services ENABLE TRIGGER ALL;

--
-- Data for Name: icon_defaults; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.icon_defaults DISABLE TRIGGER ALL;

INSERT INTO public.icon_defaults VALUES
	('course', 'graduation-cap', 'migration', '2026-09-24 09:30:32.070069+00'),
	('coaching', 'graduation-cap', 'migration', '2026-09-24 09:30:32.070069+00'),
	('training', 'graduation-cap', 'migration', '2026-09-24 09:30:32.070069+00'),
	('school', 'school', 'migration', '2026-09-24 09:30:32.070069+00'),
	('research', 'microscope', 'migration', '2026-09-24 09:30:32.070069+00'),
	('study', 'microscope', 'migration', '2026-09-24 09:30:32.070069+00'),
	('analysis', 'chart-line', 'migration', '2026-09-24 09:30:32.070069+00'),
	('finance', 'coins', 'migration', '2026-09-24 09:30:32.070069+00'),
	('budget', 'calculator', 'migration', '2026-09-24 09:30:32.070069+00'),
	('pricing', 'banknote', 'migration', '2026-09-24 09:30:32.070069+00'),
	('invoice', 'receipt', 'migration', '2026-09-24 09:30:32.070069+00'),
	('accounts', 'landmark', 'migration', '2026-09-24 09:30:32.070069+00'),
	('marketing', 'megaphone', 'migration', '2026-09-24 09:30:32.070069+00'),
	('campaign', 'megaphone', 'migration', '2026-09-24 09:30:32.070069+00'),
	('brand', 'palette', 'migration', '2026-09-24 09:30:32.070069+00'),
	('design', 'palette', 'migration', '2026-09-24 09:30:32.070069+00'),
	('content', 'pen-tool', 'migration', '2026-09-24 09:30:32.070069+00'),
	('website', 'globe', 'migration', '2026-09-24 09:30:32.070069+00'),
	('web', 'globe', 'migration', '2026-09-24 09:30:32.070069+00'),
	('api', 'server', 'migration', '2026-09-24 09:30:32.070069+00'),
	('data', 'database', 'migration', '2026-09-24 09:30:32.070069+00'),
	('platform', 'server', 'migration', '2026-09-24 09:30:32.070069+00'),
	('ai', 'bot', 'migration', '2026-09-24 09:30:32.070069+00'),
	('agent', 'bot', 'migration', '2026-09-24 09:30:32.070069+00'),
	('roadmap', 'map', 'migration', '2026-09-24 09:30:32.070069+00'),
	('hiring', 'users', 'migration', '2026-09-24 09:30:32.070069+00'),
	('team', 'users', 'migration', '2026-09-24 09:30:32.070069+00'),
	('people', 'users', 'migration', '2026-09-24 09:30:32.070069+00'),
	('health', 'heart-pulse', 'migration', '2026-09-24 09:30:32.070069+00'),
	('wellness', 'heart-pulse', 'migration', '2026-09-24 09:30:32.070069+00'),
	('fitness', 'dumbbell', 'migration', '2026-09-24 09:30:32.070069+00'),
	('property', 'home', 'migration', '2026-09-24 09:30:32.070069+00'),
	('house', 'home', 'migration', '2026-09-24 09:30:32.070069+00'),
	('build', 'hammer', 'migration', '2026-09-24 09:30:32.070069+00'),
	('travel', 'plane', 'migration', '2026-09-24 09:30:32.070069+00'),
	('trip', 'plane', 'migration', '2026-09-24 09:30:32.070069+00'),
	('event', 'calendar', 'migration', '2026-09-24 09:30:32.070069+00'),
	('sales', 'handshake', 'migration', '2026-09-24 09:30:32.070069+00'),
	('client', 'handshake', 'migration', '2026-09-24 09:30:32.070069+00'),
	('operations', 'settings', 'migration', '2026-09-24 09:30:32.070069+00'),
	('archive', 'archive', 'migration', '2026-09-24 09:30:32.070069+00'),
	('podcast', 'mic', 'migration', '2026-09-24 09:30:32.070069+00'),
	('video', 'film', 'migration', '2026-09-24 09:30:32.070069+00'),
	('photo', 'camera', 'migration', '2026-09-24 09:30:32.070069+00'),
	('music', 'music', 'migration', '2026-09-24 09:30:32.070069+00'),
	('learning', 'book', 'migration', '2026-09-24 09:30:32.070069+00'),
	('curriculum', 'book', 'migration', '2026-09-24 09:30:32.070069+00'),
	('report', 'file', 'migration', '2026-09-24 09:30:32.070069+00'),
	('docs', 'file', 'migration', '2026-09-24 09:30:32.070069+00'),
	('documentation', 'file', 'migration', '2026-09-24 09:30:32.070069+00'),
	('support', 'heart-handshake', 'migration', '2026-09-24 09:30:32.070069+00'),
	('product', 'boxes', 'migration', '2026-09-24 09:30:32.070069+00'),
	('launch', 'target', 'migration', '2026-09-24 09:30:32.070069+00'),
	('legal', 'gavel', 'migration', '2026-09-24 09:30:32.070069+00'),
	('compliance', 'shield', 'migration', '2026-09-24 09:30:32.070069+00'),
	('risk', 'shield', 'migration', '2026-09-24 09:30:32.070069+00'),
	('app', 'phone', 'migration', '2026-09-24 09:30:32.070069+00'),
	('revenue', 'chart-line', 'migration', '2026-09-24 09:30:32.070069+00'),
	('growth', 'chart-line', 'migration', '2026-09-24 09:30:32.070069+00'),
	('automation', 'settings', 'migration', '2026-09-24 09:30:32.070069+00'),
	('process', 'settings', 'migration', '2026-09-24 09:30:32.070069+00');


ALTER TABLE public.icon_defaults ENABLE TRIGGER ALL;

--
-- Data for Name: job_kind_needs; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.job_kind_needs DISABLE TRIGGER ALL;

INSERT INTO public.job_kind_needs VALUES
	('office.sync', false, 'Reads only, and reads now go over HTTPS to api/notebook.py (0138). Kept in this table rather than deleted, so the next person can see that the question was asked and answered.', '2026-09-24 09:30:25.6248+00'),
	('notebook.generate', false, 'Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.', '2026-09-24 09:30:25.6248+00'),
	('notebook.add_source', false, 'Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.', '2026-09-24 09:30:25.6248+00'),
	('notebook.push_document', false, 'Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.', '2026-09-24 09:30:25.6248+00'),
	('notebook.collect', false, 'Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.', '2026-09-24 09:30:25.6248+00'),
	('notebook.ask', false, 'Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.', '2026-09-24 09:30:25.6248+00'),
	('office.notion_adopt', false, 'Attaches a project to the Notion data sources shared with the integration. Plain HTTPS, so any worker can run it.', '2026-09-24 09:30:26.237454+00'),
	('office.notion_import', false, 'Writes a project''s source material into its attached Notion data sources as Projects, Docs and Tasks. Idempotent on page title, so a rerun adds what is missing and leaves the rest alone. Plain HTTPS.', '2026-09-24 09:30:26.296121+00');


ALTER TABLE public.job_kind_needs ENABLE TRIGGER ALL;

--
-- Data for Name: model_prices; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.model_prices DISABLE TRIGGER ALL;

INSERT INTO public.model_prices VALUES
	('', '1970-01-01 00:00:00+00', 0.1500, 0.6000, 'https://openrouter.ai/models', 'Fallback for any model with no published price. Deliberately not zero: an unknown model priced at zero would make the modelled total FALL as price coverage got worse.'),
	('cohere/north-mini-code:free', '1970-01-01 00:00:00+00', 0.0000, 0.0000, 'https://openrouter.ai/cohere/north-mini-code:free', 'Free tier.'),
	('dots-studio/dots-3-note-preview:free', '1970-01-01 00:00:00+00', 0.0000, 0.0000, 'https://openrouter.ai/dots-studio/dots-3-note-preview:free', 'Free tier.'),
	('inclusionai/ling-3.0-flash-fin:free', '1970-01-01 00:00:00+00', 0.0000, 0.0000, 'https://openrouter.ai/inclusionai/ling-3.0-flash-fin:free', 'Free tier.'),
	('fixture/free-model', '1970-01-01 00:00:00+00', 0.0000, 0.0000, 'https://example.invalid/fixture', 'Test fixture, not a real model.'),
	('gate5-probe', '1970-01-01 00:00:00+00', 0.0000, 0.0000, 'https://example.invalid/fixture', 'Test fixture, not a real model.');


ALTER TABLE public.model_prices ENABLE TRIGGER ALL;

--
-- Data for Name: notebook_operation_cost; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.notebook_operation_cost DISABLE TRIGGER ALL;

INSERT INTO public.notebook_operation_cost VALUES
	('ask', 1, 'a question against the notebook''s sources', '2026-09-24 09:30:24.194534+00'),
	('add_text', 1, 'a source, processed once on the way in', '2026-09-24 09:30:24.194534+00'),
	('add_url', 2, 'Google fetches and processes the page', '2026-09-24 09:30:24.194534+00'),
	('create_note', 1, 'written, not generated', '2026-09-24 09:30:24.194534+00'),
	('mindmap', 3, 'structural, and the cheapest thing Studio makes', '2026-09-24 09:30:24.194534+00'),
	('quiz', 4, '', '2026-09-24 09:30:24.194534+00'),
	('flashcards', 4, '', '2026-09-24 09:30:24.194534+00'),
	('study_guide', 5, '', '2026-09-24 09:30:24.194534+00'),
	('report', 5, '', '2026-09-24 09:30:24.194534+00'),
	('infographic', 6, 'an image, generated', '2026-09-24 09:30:24.194534+00'),
	('slides', 8, 'a deck, generated slide by slide', '2026-09-24 09:30:24.194534+00'),
	('audio', 10, 'minutes of synthesised conversation', '2026-09-24 09:30:24.194534+00'),
	('video', 15, 'the most expensive thing the product makes', '2026-09-24 09:30:24.194534+00');


ALTER TABLE public.notebook_operation_cost ENABLE TRIGGER ALL;

--
-- Data for Name: output_shapes; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.output_shapes DISABLE TRIGGER ALL;

INSERT INTO public.output_shapes VALUES
	('tasks_extracted', 'A list of things to do, found in something the office read. The headline case: each entry can become a real task through hq_task_add, which has been a complete write path since #11 and #106 and had nothing to feed it.', '{"tasks": "array<object>"}', '{"from": "string"}', '2026-09-24 09:30:29.025627+00'),
	('research_summary', 'What was found, and where it came from. #116''s judge can check this without a model: a summary claiming three sources and carrying one is objectively wrong and no LLM is needed to say so.', '{"sources": "array<object>", "findings": "array<string>"}', '{"unanswered": "array<string>"}', '2026-09-24 09:30:29.025627+00'),
	('draft_document', 'A document the office wrote, ready to be imported into a project. The title is separate from the markdown so the import step has something to name the row with rather than taking the first line and hoping.', '{"title": "string", "markdown": "string"}', '{"tags": "array<string>", "suggested_collection": "string"}', '2026-09-24 09:30:29.025627+00'),
	('comparison', 'Several options weighed against each other. Every consumer of one of these today re-reads the prose to find out which option won.', '{"options": "array<object>"}', '{"criteria": "array<string>", "recommended": "string"}', '2026-09-24 09:30:29.025627+00'),
	('recommendation', 'One course of action and the reasons for it. The reasons are a list rather than a paragraph so that a follow-up can check whether any of them has stopped being true.', '{"because": "array<string>", "recommend": "string"}', '{"alternatives": "array<string>", "confidence_note": "string"}', '2026-09-24 09:30:29.025627+00'),
	('nothing_happened', 'A duty that ran and found nothing to do. Structured because "nothing changed" is the answer sixteen times a day and a consumer should not have to read a sentence to establish it.', '{"changed": "boolean"}', '{"looked_at": "number"}', '2026-09-24 09:30:29.025627+00'),
	('plan_carried_out', 'What a constrained plan actually did, as receipts, and where it got to (#283). done and could_not name compiled steps; receipts are canonical ids the run produced; verdict is the deterministic assessment of the GOAL rather than of the steps.', '{"done": "array<string>", "goal": "string", "steps": "array<object>", "verdict": "string", "receipts": "array<string>", "could_not": "array<string>"}', '{"unmet": "array<string>", "rounds": "number", "stopped_at": "string"}', '2026-09-24 09:30:35.666728+00');


ALTER TABLE public.output_shapes ENABLE TRIGGER ALL;

--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.projects DISABLE TRIGGER ALL;

INSERT INTO public.projects VALUES
	('a4330959-1024-4011-bef8-c72cfb976b02', 'unnamed', 'Unnamed', 'active', NULL, '2026-09-24 09:30:30.460224+00', '2026-09-24 09:30:30.460224+00', NULL, NULL, NULL, NULL, DEFAULT, NULL, NULL, NULL, 'Where a message that names no project lands (ADR-0024, #194). Deleting it would orphan every unattributed conversation.');


ALTER TABLE public.projects ENABLE TRIGGER ALL;

--
-- Data for Name: project_aliases; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.project_aliases DISABLE TRIGGER ALL;

INSERT INTO public.project_aliases VALUES
	('d5e5dec3-e06c-438f-af7a-e3d36f58adff', 'a4330959-1024-4011-bef8-c72cfb976b02', 'Unnamed', DEFAULT, 'name', 1.0, '2026-09-24 09:30:30.460224+00');


ALTER TABLE public.project_aliases ENABLE TRIGGER ALL;

--
-- Data for Name: project_attachments; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.project_attachments DISABLE TRIGGER ALL;

INSERT INTO public.project_attachments VALUES
	('5da089b6-c6bf-49ab-9a1b-52c838270ba6', 'a4330959-1024-4011-bef8-c72cfb976b02', 'upload', 'unnamed-project', 'Direct messages and uploads', NULL, 'source', NULL, true, NULL, NULL, '2026-09-24 09:30:30.460224+00', '2026-09-24 09:30:30.460224+00', NULL);


ALTER TABLE public.project_attachments ENABLE TRIGGER ALL;

--
-- Data for Name: providers; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.providers DISABLE TRIGGER ALL;

INSERT INTO public.providers VALUES
	('openai', 'OpenAI', 'official', 50, true, NULL, false, 'https://api.openai.com/v1', NULL, 'Realtime voice only (Gate 1). free_only false because Realtime has no free tier — which is why voice is an explicitly funded decision (D3), not a default.', '2026-09-24 09:30:22.324178+00', '2026-09-24 09:30:22.324178+00', 0, 0, 0),
	('gemini', 'Google Gemini', 'official', 60, true, NULL, true, 'https://generativelanguage.googleapis.com/v1beta', NULL, 'Free-tier rate limits are undocumented — Google removed the published tables, so capacity here is ESTIMATED and never AUTHORITATIVE (§11).', '2026-09-24 09:30:22.324178+00', '2026-09-24 09:30:22.324178+00', 0, 0, 0),
	('openrouter', 'OpenRouter', 'official', 10, true, NULL, false, 'https://openrouter.ai/api/v1', NULL, 'Primary router. Funded 2026-09-15: low-cost paid models within the budget columns. openrouter/auto and auto:free still report -1 and remain denied (section 11).', '2026-09-24 09:30:22.324178+00', '2026-09-24 09:30:39.826684+00', 0.20, 1.00, 0.01);


ALTER TABLE public.providers ENABLE TRIGGER ALL;

--
-- Data for Name: provider_models; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.provider_models DISABLE TRIGGER ALL;

INSERT INTO public.provider_models VALUES
	('openrouter', 'openai/gpt-oss-120b', 'usable', '0.000000037', '0.00000017', NULL, '2026-09-24 09:30:31.240882+00', NULL, 0, '2026-09-24 09:30:31.240882+00', '2026-09-24 09:30:31.240882+00', 10),
	('openrouter', 'qwen/qwen3.7-flash', 'usable', '0.00000003', '0.00000013', NULL, '2026-09-24 09:30:31.263083+00', NULL, 0, '2026-09-24 09:30:31.263083+00', '2026-09-24 09:30:31.263083+00', 20),
	('openrouter', 'mistralai/mistral-small-3.2-24b-instruct', 'usable', '0.000000075', '0.0000002', NULL, '2026-09-24 09:30:31.263083+00', NULL, 0, '2026-09-24 09:30:31.263083+00', '2026-09-24 09:30:31.263083+00', 30);


ALTER TABLE public.provider_models ENABLE TRIGGER ALL;

--
-- Data for Name: staff; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.staff DISABLE TRIGGER ALL;

INSERT INTO public.staff VALUES
	('97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', 'chief-of-staff', 'Claire', 'Chief of Staff', true, 'Routes incoming work, classifies intent, decides who is needed and who is not, and recommends temporary specialists. Owns the decision NOT to convene anyone: §9 is explicit that simple factual retrieval is not a team meeting.', '{routing,delegation,"intent classification",prioritisation}', 'Brief and decisive. States the decision first and the reasoning second, and says plainly when something does not need doing.', 'chief-of-staff.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'she/her', NULL, DEFAULT),
	('bf8dc713-bf4a-48bd-962d-d6e9dfc20bdf', 'finance-director', 'Daniel', 'Finance & Data Director', true, 'Owns numbers, unit economics and measurement. Distinguishes measured figures from modelled ones and refuses to present an estimate as an observation - the same discipline §11 applies to usage provenance.', '{budget,cashflow,charge,cost,costs,"data analysis",finance,forecast,invoice,margin,metrics,price,pricing,profit,revenue,spend,"unit economics"}', 'Numerate and sceptical. Always says whether a figure is measured, calculated or estimated.', 'finance-director.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'he/him', NULL, DEFAULT),
	('1877a624-ce7d-4b72-9e7e-319e3589c0a6', 'growth-director', 'Ruby', 'Growth & Marketing Director', true, 'Owns positioning, messaging, audience and demand. Judges whether a claim is defensible before it is persuasive, and flags anything that would need substantiating externally.', '{audience,brand,campaign,demand,"demand generation",funnel,instagram,launch,leads,linkedin,marketing,messaging,positioning,seo,social}', 'Plain and concrete. Avoids superlatives it cannot substantiate.', 'growth-director.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'she/her', NULL, DEFAULT),
	('7a354db4-eba1-44b2-b17f-f001665543f0', 'operations-director', 'Marcus', 'Operations Director', true, 'Owns how work actually gets done: sequencing, dependencies, capacity and follow-through. Notices when a plan assumes capacity that does not exist.', '{backlog,capacity,deadline,logistics,operations,process,rollout,schedule,sequence,sequencing,staffing,workflow}', 'Practical and specific about who does what by when. Surfaces the constraint rather than the wish.', 'operations-director.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'he/him', NULL, DEFAULT),
	('00f3bdf6-6673-4157-a4f9-a116996da7b9', 'strategy-director', 'Tom', 'Strategy Director', true, 'Turns evidence into options with trade-offs, and states which option is recommended and why. Responsible for making the cost of each path explicit rather than presenting a single course as inevitable.', '{approach,decide,decision,direction,options,"options analysis",plan,planning,priorities,roadmap,strategy,trade,trade-offs}', 'Presents a recommendation, not a menu. Names the strongest argument against its own recommendation.', 'strategy-director.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'he/him', NULL, DEFAULT),
	('8eca3991-3d5d-4afe-b462-d93c07c71063', 'quality-director', 'Grace', 'Quality & Risk Director', true, 'Reviews substantive output before it commits, per §10. Assigns confidence and evidence type, surfaces contradictions rather than averaging them away, and may reject. This role exists to be able to say no.', '{quality,verify,regulation,risk,"contract risk",legal,legally,"evidence grading",contradiction,review,"quality review",liability,audit,regulatory,breach,confidentiality,"data protection","contradiction detection",accuracy,obligation,check,exposure,privacy,compliance}', 'Direct about problems and specific about which part is weak. Reserves approval rather than withholding an opinion.', 'quality-director.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'she/her', NULL, DEFAULT),
	('05e6e556-66d0-4f29-ba37-1e812d7df3e0', 'communications-director', 'Oliver', 'Communications & Creative Director', true, 'Owns how things are said to people outside the team, and how they read. Responsible for clarity over polish and for never letting presentation outrun the confidence of the underlying finding.', '{announcement,blog,copy,draft,editing,email,headline,narrative,newsletter,post,presentation,script,tone,wording,write,writing}', 'Edits for clarity first. Will not dress up a Low-confidence finding in High-confidence prose.', 'communications-director.jpg', 1, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'he/him', NULL, DEFAULT),
	('17629604-d02f-4f41-80ad-3782b79fc59b', 'research-director', 'Emma', 'Research Director', true, 'Gathers and weighs evidence, tracks source provenance, and reports what the sources actually support rather than what would be convenient. Owns the distinction between direct evidence and inference.', '{benchmark,compare,competitor,competitors,evidence,find,landscape,market,provenance,research,source,"source evaluation",sources,study,survey,synthesis}', 'Cites as it goes. Distinguishes what a source says from what it implies, and names the gap when asked something the evidence cannot answer.', 'research-director.jpg', 3, true, '2026-09-24 09:30:22.659938+00', '2026-09-24 09:30:40.247172+00', NULL, NULL, NULL, 'she/her', NULL, DEFAULT);


ALTER TABLE public.staff ENABLE TRIGGER ALL;

--
-- Data for Name: responsibilities; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.responsibilities DISABLE TRIGGER ALL;

INSERT INTO public.responsibilities VALUES
	('f1d89e0a-938e-47d3-8f76-6e6ea8842f98', 'calendar-refresh', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Keep the cached view of Grant''s calendar current, so the team can answer questions about his week without a round trip and can go on answering them when Google is unreachable.', 'google.read_calendar', 60, NULL, true, '2026-09-24 09:30:24.906613+00', '2026-09-24 09:30:24.906613+00', NULL, NULL, '{}', NULL, 'migration'),
	('8c2f102e-54a0-4958-aab1-e1fa49c1c8b9', 'mail-refresh', '97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', NULL, 'Read what has arrived in the inbox, so the team can answer questions about it without waiting on Google.', 'google.read_mail', 60, NULL, false, '2026-09-24 09:30:25.389518+00', '2026-09-24 09:30:25.389518+00', NULL, NULL, '{}', NULL, 'migration'),
	('2dc13421-3d12-4a55-a429-f811f176720d', 'vault-export', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Send Grant an encrypted copy of the vault, so the credentials survive losing this Supabase project (§16).', 'office.vault_export', 10080, NULL, false, '2026-09-24 09:30:25.541409+00', '2026-09-24 09:30:25.541409+00', NULL, NULL, '{}', NULL, 'migration'),
	('af529d30-9a76-465c-83e0-d081414e4f3e', 'discovery-sync', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Look for new sources in every attached project and pull them in, so the team notices a document arriving without being told.', 'office.sync', 60, NULL, true, '2026-09-24 09:30:25.541409+00', '2026-09-24 09:30:25.655442+00', NULL, NULL, '{}', NULL, 'migration'),
	('af785988-b786-46f7-a136-66e88441b09d', 'nightly-backup', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Take a portable copy of the whole database and keep it in a private bucket, so losing this machine or this repository does not lose the work (§16).', 'office.backup', 1440, NULL, true, '2026-09-24 09:30:25.722252+00', '2026-09-24 09:30:25.722252+00', NULL, NULL, '{}', NULL, 'migration'),
	('4d066e0b-a1d9-457e-95bc-07ec508f29f6', 'slack-rotation', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Renew the Slack app configuration tokens before they expire. They last twelve hours and the refresh token is single-use, so missing the window means a human regenerating the pair by hand. Channel archiving is NOT this duty — that is npm run slack:tidy -- --go.', 'office.slack_rotate', 240, NULL, true, '2026-09-24 09:30:25.541409+00', '2026-09-24 09:30:25.767819+00', NULL, NULL, '{}', NULL, 'migration'),
	('76e70043-0fbd-4443-9afb-1535e15fe0c0', 'notion-sync', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Read the Notion databases each project is attached to and file what is there. A project maps to a Notion Teamspace by name and to that teamspace''s databases by id (0161); a project with no Notion attachment is skipped rather than guessed at.', 'office.notion_sync', 120, NULL, true, '2026-09-24 09:30:25.831787+00', '2026-09-24 09:30:26.170304+00', NULL, NULL, '{}', NULL, 'migration'),
	('7cccfaf3-7ca7-40f5-b564-10fac42a2be4', 'daily-capacity-report', 'bf8dc713-bf4a-48bd-962d-d6e9dfc20bdf', NULL, 'Report each day what the team spent: work done, model calls and their cost, the notebook allowance remaining, whether messages arrived, and what is waiting on Grant.', 'office.capacity_report', 1440, NULL, true, '2026-09-24 09:30:24.660218+00', '2026-09-24 09:30:27.049922+00', '18:00:00', NULL, '{}', NULL, 'migration'),
	('6295f652-e2c1-4449-852d-3bc985604b29', 'morning-briefing', '97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', NULL, 'Brief Grant each morning: what needs him, what is on today, what the office did overnight, and what is worth deciding.', 'briefing.morning', 1440, NULL, true, '2026-09-24 09:30:27.089827+00', '2026-09-24 09:30:27.089827+00', '07:00:00', NULL, '{}', NULL, 'migration'),
	('29db345d-c3cf-4731-80f8-a1193b9508e0', 'drive-watch', '97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', NULL, 'Watch each project''s Google Drive folder and ask Grant what to do with anything new that appears in it.', 'drive.watch', 10, NULL, true, '2026-09-24 09:30:27.210836+00', '2026-09-24 09:30:27.210836+00', NULL, NULL, '{}', NULL, 'migration'),
	('e1569d29-032e-48a4-9718-21e1ef9e690b', 'calendar-task-sync', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Keep Google Calendar matching the task list: dated, open tasks appear as all-day events and come away again when they are done. One way only — the diary never changes a task.', 'google.write_calendar_tasks', 60, NULL, true, '2026-09-24 09:30:28.281373+00', '2026-09-24 09:30:28.281373+00', NULL, NULL, '{}', NULL, 'migration'),
	('7e128358-2e35-44b5-aa66-22bed6b0b347', 'job-trace-retention', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Drop job trace steps older than thirty days, keeping the rollup on the job. The trace is the highest-volume table in the office and the free tier is 500 MB, so the window is enforced rather than intended.', 'office.prune_job_traces', 60, NULL, true, '2026-09-24 09:30:28.698256+00', '2026-09-24 09:30:28.698256+00', NULL, NULL, '{}', NULL, 'migration'),
	('aacb3bdf-f6c6-4001-8959-8c1bb361429d', 'build-shot-retention', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Delete build-diary screenshots that no step points at any more. The rows prune at thirty days and the pictures did not, so the bucket only ever grew against a 1 GB allowance.', 'office.prune_build_shots', 1440, NULL, true, '2026-09-24 09:30:32.177878+00', '2026-09-24 09:30:32.177878+00', NULL, NULL, '{}', NULL, 'migration'),
	('43431b60-08b9-42b5-95b0-d17ee6a6ada0', 'proposal-round', '8eca3991-3d5d-4afe-b462-d93c07c71063', NULL, 'Turn what the office could not do into proposals Grant can answer (#49).', 'office.propose', 1440, NULL, true, '2026-09-24 09:30:33.433171+00', '2026-09-24 09:30:33.433171+00', NULL, NULL, '{}', NULL, 'migration'),
	('d0181457-bbe7-4cea-9157-a4ce60817ca5', 'credential-chores', '7a354db4-eba1-44b2-b17f-f001665543f0', NULL, 'Put a credential the office cannot fix on Grant''s own list, and take it off again when it is healthy', 'office.chores', 60, NULL, true, '2026-09-24 09:30:33.738827+00', '2026-09-24 09:30:33.738827+00', NULL, NULL, '{}', NULL, 'grant'),
	('ccbb070b-5c22-4f5e-a15b-3b5a8665d1a7', 'task-reminders', '97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', NULL, 'Say something when a personal task reminder falls due (#259).', 'tasks.remind', 15, NULL, true, '2026-09-24 09:30:34.879563+00', '2026-09-24 09:30:34.879563+00', NULL, NULL, '{}', NULL, 'migration'),
	('3811e29a-f2e3-4998-814a-c8c852a07961', 'vikunja-sync', '97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', NULL, 'Keep Grant''s personal tasks in step with Vikunja, when he has connected one (#259).', 'tasks.sync', 15, NULL, false, '2026-09-24 09:30:35.244741+00', '2026-09-24 09:30:35.290378+00', NULL, NULL, '{}', NULL, 'migration');


ALTER TABLE public.responsibilities ENABLE TRIGGER ALL;

--
-- Data for Name: self_improvement_kinds; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.self_improvement_kinds DISABLE TRIGGER ALL;

INSERT INTO public.self_improvement_kinds VALUES
	('office.notice', 'Looking for what nobody asked about (#52). Useful, and the easiest thing in the office to run too often.', '2026-09-24 09:30:27.724356+00'),
	('office.reflect', 'Reading its own past work to draw a lesson (#49). Costs a model call per pass and produces something advisory rather than something Grant asked for.', '2026-09-24 09:30:27.724356+00'),
	('office.propose', 'Writing up a proposed improvement (#49). The output is a suggestion, so an expensive one that is declined has cost tokens for nothing.', '2026-09-24 09:30:27.724356+00'),
	('office.learn', 'Turning an observation into a stored lesson or skill (#48, #50).', '2026-09-24 09:30:27.724356+00');


ALTER TABLE public.self_improvement_kinds ENABLE TRIGGER ALL;

--
-- Data for Name: staff_prompts; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.staff_prompts DISABLE TRIGGER ALL;

INSERT INTO public.staff_prompts VALUES
	('ad48b43f-0ba5-47b2-b28a-b02e4a84714e', '97aa9359-d8d6-437b-90ad-6fab7ec8f2c3', 1, 'You are Chief of Staff, Chief of Staff.

Responsibilities: Routes incoming work, classifies intent, decides who is needed and who is not, and recommends temporary specialists. Owns the decision NOT to convene anyone: §9 is explicit that simple factual retrieval is not a team meeting.

Expertise: routing, delegation, intent classification, prioritisation.

How you communicate: Brief and decisive. States the decision first and the reasoning second, and says plainly when something does not need doing.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('0e277701-ecaa-45ce-91d1-f903f3ede249', '17629604-d02f-4f41-80ad-3782b79fc59b', 1, 'You are Research Director, Research Director.

Responsibilities: Gathers and weighs evidence, tracks source provenance, and reports what the sources actually support rather than what would be convenient. Owns the distinction between direct evidence and inference.

Expertise: research, source evaluation, synthesis, provenance.

How you communicate: Cites as it goes. Distinguishes what a source says from what it implies, and names the gap when asked something the evidence cannot answer.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('d2d95062-c934-4589-adc2-0c2924dbc2b0', '00f3bdf6-6673-4157-a4f9-a116996da7b9', 1, 'You are Strategy Director, Strategy Director.

Responsibilities: Turns evidence into options with trade-offs, and states which option is recommended and why. Responsible for making the cost of each path explicit rather than presenting a single course as inevitable.

Expertise: strategy, options analysis, trade-offs, planning.

How you communicate: Presents a recommendation, not a menu. Names the strongest argument against its own recommendation.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('4ad64ed9-e791-4ea4-8aa4-1db32314588c', '1877a624-ce7d-4b72-9e7e-319e3589c0a6', 1, 'You are Growth & Marketing Director, Growth & Marketing Director.

Responsibilities: Owns positioning, messaging, audience and demand. Judges whether a claim is defensible before it is persuasive, and flags anything that would need substantiating externally.

Expertise: positioning, messaging, demand generation, audience.

How you communicate: Plain and concrete. Avoids superlatives it cannot substantiate.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('42f43109-d615-408e-b4f2-d7d3fa903b4a', 'bf8dc713-bf4a-48bd-962d-d6e9dfc20bdf', 1, 'You are Finance & Data Director, Finance & Data Director.

Responsibilities: Owns numbers, unit economics and measurement. Distinguishes measured figures from modelled ones and refuses to present an estimate as an observation - the same discipline §11 applies to usage provenance.

Expertise: finance, unit economics, metrics, data analysis.

How you communicate: Numerate and sceptical. Always says whether a figure is measured, calculated or estimated.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('82f89645-677e-499d-8b96-eb3e04e158bc', '7a354db4-eba1-44b2-b17f-f001665543f0', 1, 'You are Operations Director, Operations Director.

Responsibilities: Owns how work actually gets done: sequencing, dependencies, capacity and follow-through. Notices when a plan assumes capacity that does not exist.

Expertise: operations, sequencing, capacity, process.

How you communicate: Practical and specific about who does what by when. Surfaces the constraint rather than the wish.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('02740683-c1c3-4e97-ad6b-a6776ca25f76', '8eca3991-3d5d-4afe-b462-d93c07c71063', 1, 'You are Quality & Risk Director, Quality & Risk Director.

Responsibilities: Reviews substantive output before it commits, per §10. Assigns confidence and evidence type, surfaces contradictions rather than averaging them away, and may reject. This role exists to be able to say no.

Expertise: quality review, risk, contradiction detection, evidence grading.

How you communicate: Direct about problems and specific about which part is weak. Reserves approval rather than withholding an opinion.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('ec2a322b-a8bb-43cb-9153-815b6fdc057b', '05e6e556-66d0-4f29-ba37-1e812d7df3e0', 1, 'You are Communications & Creative Director, Communications & Creative Director.

Responsibilities: Owns how things are said to people outside the team, and how they read. Responsible for clarity over polish and for never letting presentation outrun the confidence of the underlying finding.

Expertise: writing, editing, narrative, presentation.

How you communicate: Edits for clarity first. Will not dress up a Low-confidence finding in High-confidence prose.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.', 'migration:0024', '2026-09-24 09:30:22.778262+00'),
	('463d675c-1d61-4873-89d1-8e5cf3c3cd7f', '17629604-d02f-4f41-80ad-3782b79fc59b', 3, 'You are Research Director, Research Director.

Responsibilities: Gathers and weighs evidence, tracks source provenance, and reports what the sources actually support rather than what would be convenient. Owns the distinction between direct evidence and inference.

Expertise: research, source evaluation, synthesis, provenance.

How you communicate: Cites as it goes. Distinguishes what a source says from what it implies, and names the gap when asked something the evidence cannot answer.

Always state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.', 'Restores the version-1 text after a verification script published a test prompt as version 2 and moved the pointer to it. Version 2 stays in the history because the history is append-only, which is the point of it.', 'migration:0025', '2026-09-24 09:30:22.824234+00');


ALTER TABLE public.staff_prompts ENABLE TRIGGER ALL;

--
-- Data for Name: tool_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.tool_permissions DISABLE TRIGGER ALL;

INSERT INTO public.tool_permissions VALUES
	('notion.write', 2, 'Create and update Notion pages: a page in a database, blocks appended to a page, properties changed. No deletion — src/notion/write.ts contains no delete, so the worst a mistake can be is a page to archive.', true, NULL, '{"create pages in any shared data source","append and update blocks","set properties and relations","upload and attach files including audio and video","archive a page (reversibly)","read a database schema before writing to it"}', 'job kinds office.notion_import, office.notion_sync and office.notion_adopt', true),
	('github.read', 0, 'Read a GitHub repository: metadata, branches, README and docs, the source tree, file contents, open issues and releases.', false, 'no route from a user request. src/github/api.ts is real and tested by verify:github, and its only importer is that suite - there is no handler, no job kind and no planner step, so nothing Grant can type reaches it. Wire a job kind and re-enable; until then saying otherwise is #64.', '{"read repositories, branches, the README, the source tree, issues and releases"}', 'src/github/api.ts', false),
	('gmail.draft', 1, 'Create a Gmail draft', false, 'not implemented. src/google/mail.ts exports parseFrom and refreshMail and nothing else - there is no draft writer, and the description claimed one. gmail.send stays off by policy; this one is off because it does not exist.', '{"write a draft into Gmail for Grant to review and send himself"}', 'src/google/mail.ts — draft only; gmail.send is disabled by policy', false),
	('note.create', 1, 'Write an internal note', false, 'no route from a user request. The notebook.push_document handler is registered and correct, and nothing enqueues it: the nine artefacts a planner can request are all NotebookLM generations. Closest of the three to being real - it needs a way to ask, not an implementation.', '{"write an internal note nobody is paged about"}', 'job kind notebook.push_document', false),
	('task.create', 1, 'Create a task on the dashboard. It needs a TITLE and nothing else - the project comes from the conversation, a due date and an owner are optional, and there is no such thing as a parent task. Never ask for more than a title, and never say you have created one unless the office tells you it did.', true, NULL, '{"create a task on a dashboard project, with a date, an owner and a parent"}', 'app.hq_task_add', true),
	('slack.post', 2, 'Post into Slack. This happens AFTER your answer, through the channel adapter, and never while you are writing - so never say you have posted, messaged or notified anybody. Say what you will do, or hand the work over.', true, NULL, '{"post a message to a project channel or the office floor","messages carry the sender''s own face and name"}', 'src/slack/api.ts, through the channel adapter', true),
	('notebook.write', 2, 'Add an approved note or source to Notebook', true, NULL, '{"add a link or a note as a source","push a document the office holds into a notebook","ask for a generated artifact and collect it when it is ready"}', 'job kinds notebook.add_source and notebook.generate', true),
	('gmail.read', 0, 'Read a Gmail message', true, NULL, '{"read a message, its thread and its attachments"}', 'job kind google.read_mail', true),
	('gmail.send', 3, 'Send email', false, '§11: Gmail is draft-only by policy. The OAuth scope permitting it is not a reason to expose it; sending stays disabled until Grant explicitly enables it. Re-disabled by 0022 after a defective verification check enabled it - see that migration''s header.', '{"send an email as Grant"}', '', false),
	('github.write', 3, 'Create or change anything in a GitHub repository.', false, '§13 puts destructive GitHub operations in the highest tier. There is no automated path to this in V1, and src/github/api.ts contains no method that writes — the absence is structural, not just a flag.', '{"open a pull request, push a commit, change a file"}', '', false),
	('db.delete', 3, 'Delete application data', false, 'Destructive. Nothing in V1 needs it, and a capability that exists is a capability that can be reached.', '{"delete application data"}', '', false),
	('production.write', 3, 'Modify production configuration or security', false, 'Requires explicit approval and has no automated path in V1.', '{"change production configuration or a security boundary"}', '', false),
	('spend.money', 3, 'Any action that incurs cost', false, '§11: paid inference is prevented by four layers; this is the same prohibition at the tool router.', '{"anything that costs money"}', '', false),
	('web.search', 0, 'Search the web', false, 'Nothing implements this. The row claimed reach the office does not have, and every agent''s capability sheet repeated the claim — so an agent asked to research something would say it would search the web and then not. It stays listed, disabled, because the office genuinely wants it: a listed gap can become a proposal (#49), a deleted one cannot. Re-enable it in the same change that implements it.', '{"search the web and read what comes back"}', '', false),
	('gmail.search', 0, 'Search Gmail', true, NULL, '{"search the mailbox by sender, subject, date and text"}', 'job kind google.read_mail', true),
	('db.read', 0, 'Read the application database', true, NULL, '{"read any of the office''s own records — projects, documents, tasks, jobs, outputs"}', 'the office — every handler reads its own database directly', true),
	('preference.update', 1, 'Update a notification preference', true, NULL, '{"change how loudly a kind of thing reaches him"}', 'hq-api, the preference actions', true),
	('draft.create', 1, 'Write a draft. Every answer you give is already a draft until it is reviewed - you do not need to do anything to invoke this.', true, NULL, '{"draft something for Grant to approve before it goes anywhere"}', 'public.outputs — every handler''s result is a draft until reviewed', true),
	('task.extract', 1, 'Find the things that need doing inside a document the office has already read, and create them as tasks. Say which document - "the pricing brief" is enough, it is matched on the title - or say nothing and it reads what the project holds. It only reads material already IN the office: if it is in a notebook or a Drive folder nobody has brought in, say so first. It CREATES the tasks rather than listing them for approval, and offers one undo for the batch, so never promise a list to confirm.', true, NULL, '{"pull the tasks out of a document and create them on the project"}', 'office.extract_tasks', true),
	('drive.ingest', 1, 'Add a file that has appeared in a watched Drive folder to the project as a source document. Takes nothing: the folder is the project''s own attachment and the file is whatever arrived. Internal — the document is a draft until it is approved, and nothing is sent anywhere.', true, NULL, '{"add an arrived Drive file to the project","take a new file in as a source"}', 'job kind drive.watch — src/handlers/drive.ts, when the policy says proceed', false),
	('calendar.write', 2, 'Mirror dated tasks into the diary as all-day events, on the hourly sync', true, NULL, '{"on the hourly sync, put a task that has a DATE into the diary as an all-day event","move that event when the date changes, and remove it when the task is done","only ever touch events the office created, matched on a stored tag","never in a reply, and never a timed event: the way into the diary is to give a task a date"}', 'job kind google.write_calendar_tasks', false),
	('calendar.read', 0, 'Cache the calendar, and read it in the morning briefing', true, NULL, '{"hold a cache of the diary, refreshed by a duty","read it in the morning briefing","not read it while answering: no lookup on that path exists, so a claim about the diary in a reply is invention"}', 'job kind google.read_calendar', false),
	('document.create', 1, 'Produce a finished, typeset PDF document and deliver it on the channel that asked', true, NULL, '{"produce a real PDF -- cover, headings, tables, charts -- and deliver it on this channel","say you have STARTED one: it arrives shortly after your reply, never attached to it"}', 'job kind artifact.report', true),
	('web.read', 1, 'Open a web address Grant has named, read the page, and file what it says on the project', true, NULL, '{"open a web address Grant names and file what the page says on the project","not a search: you can open an address given to you, not go looking for one"}', 'job kind browser.gather', true),
	('notebook.read', 0, 'Read notebooks, sources and cached fulltext', true, NULL, '{"read notebooks, their sources and the cached full text"}', 'job kinds notebook.ask, notebook.collect and notebook.list_artifacts', true);


ALTER TABLE public.tool_permissions ENABLE TRIGGER ALL;

--
-- Data for Name: staff_tools; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.staff_tools DISABLE TRIGGER ALL;

INSERT INTO public.staff_tools VALUES
	('chief-of-staff', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'db.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'notebook.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'web.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'gmail.search', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'gmail.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'calendar.read', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'task.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'note.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'preference.update', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'draft.create', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'gmail.draft', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('research-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'calendar.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'slack.post', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('strategy-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('growth-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('finance-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('operations-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('research-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('quality-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('communications-director', 'notebook.write', '2026-09-24 09:30:25.188078+00', 'migration-0119', 'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'),
	('chief-of-staff', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('strategy-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('growth-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('finance-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('operations-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('research-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('quality-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('communications-director', 'github.read', '2026-09-24 09:30:26.071384+00', 'migration 0157', 'Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant''s choice one repository at a time.'),
	('chief-of-staff', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('strategy-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('growth-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('finance-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('operations-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('research-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('quality-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('communications-director', 'notion.write', '2026-09-24 09:30:26.215165+00', 'migration 0163', 'Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.'),
	('chief-of-staff', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('chief-of-staff', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('strategy-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('growth-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('growth-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('finance-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('finance-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('operations-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('operations-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('research-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('research-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('quality-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('quality-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('communications-director', 'document.create', '2026-09-24 09:30:37.227356+00', 'grant', NULL),
	('communications-director', 'web.read', '2026-09-24 09:30:37.227356+00', 'grant', NULL);


ALTER TABLE public.staff_tools ENABLE TRIGGER ALL;

--
-- Data for Name: system_config; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.system_config DISABLE TRIGGER ALL;

INSERT INTO public.system_config VALUES
	('jobs.capacity', '{"max_concurrent_jobs": 3, "max_consultations_per_job": 3, "max_direct_alerts_per_agent_per_day": 3, "max_investigations_per_project_per_day": 5}', 'V1 autonomy capacity limits (§17). Enforced at dequeue, not at enqueue.', false, '2026-09-24 09:30:22.252686+00', 'fresh_alex_harness'),
	('jobs.lease_seconds', '300', 'How long a dequeued job stays leased before the recovery sweep may reclaim it.', false, '2026-09-24 09:30:22.252686+00', 'fresh_alex_harness'),
	('providers.breaker', '{"cooldown_seconds": 60, "failure_threshold": 5, "max_cooldown_seconds": 3600}', 'Circuit-breaker thresholds. Cooldown backs off exponentially to the maximum.', false, '2026-09-24 09:30:22.252686+00', 'fresh_alex_harness'),
	('jobs.urgent_priority_max', '20', 'A job with priority <= this is urgent: if inference is unavailable it raises a blocker instead of queueing quietly. Lower priority number = more urgent, matching the dequeue order.', false, '2026-09-24 09:30:22.40268+00', 'fresh_alex_harness'),
	('notebook.sync_interval_minutes', '10', 'How often the discovery/sync cycle runs. Self-adjustable so the system may back off when Notebook is degraded.', true, '2026-09-24 09:30:22.543249+00', 'fresh_alex_harness'),
	('notebook.sync_lease_minutes', '15', 'How long a sync run may hold its lease before app.recover_stalled_syncs treats the worker as dead. Longer than the interval on purpose: a slow run must not be declared crashed by the next tick.', false, '2026-09-24 09:30:22.543249+00', 'fresh_alex_harness'),
	('agents.max_specialists_per_job', '3', '§9 V1 default: the smallest justified specialist set. Not self-adjustable - a cost governor that can raise its own ceiling is not a governor.', false, '2026-09-24 09:30:22.611227+00', 'fresh_alex_harness'),
	('agents.max_investigations_per_project_per_day', '5', '§9 V1 default. Not self-adjustable, for the same reason.', false, '2026-09-24 09:30:22.611227+00', 'fresh_alex_harness'),
	('agents.max_simultaneous_jobs', '3', '§9 V1 default.', false, '2026-09-24 09:30:22.611227+00', 'fresh_alex_harness'),
	('agents.max_delegation_depth', '3', '§9: how many levels of delegation are permitted below a top-level job. Not self-adjustable - a delegation cap an agent can raise is not a cap.', false, '2026-09-24 09:30:22.683273+00', 'fresh_alex_harness'),
	('agents.max_live_specialists', '3', '§9: how many temporary specialists may be active at once. Not self-adjustable - a roster cap an agent can raise is not a cap.', false, '2026-09-24 09:30:22.778262+00', 'fresh_alex_harness'),
	('ui.needs_me_cap', '7', '§12: how many items Needs Me may show before it reports suppression instead of growing. Not self-adjustable - raising it is how the list stops being read.', false, '2026-09-24 09:30:22.877822+00', 'fresh_alex_harness'),
	('grant.timezone', '"Europe/Athens"', 'IANA timezone for anything that has to decide which DAY something belongs to - briefings above all. An IANA name rather than an offset because Greece observes DST.', false, '2026-09-24 09:30:23.343868+00', 'fresh_alex_harness'),
	('notebook.disabled_reason', '"awaiting_adr_0012_decision"', 'Why the Notebook integration is off. Was google_account_disabled_2026_09_04; the account was reinstated 2026-09-05 and the reason is now the open architectural decision rather than a dead credential.', false, '2026-09-24 09:30:23.488026+00', 'fresh_alex_harness'),
	('notebook.enabled', 'true', 'NotebookLM adapter. Re-enabled 2026-09-06 at Grant''s instruction, with the credential verified the same day (3 notebooks, available_unofficial). ADR-0013 is unchanged: this is a route in, not the store.', false, '2026-09-24 09:30:23.77251+00', 'fresh_alex_harness'),
	('calendar.enabled', 'false', 'Whether Google Calendar is in service. False until a credential exists.', false, '2026-09-24 09:30:24.168805+00', 'fresh_alex_harness'),
	('notebook.window_hours', '5', 'Google refreshes the allowance every five hours. Their number, not ours.', false, '2026-09-24 09:30:24.194534+00', 'fresh_alex_harness'),
	('notebook.window_units', '40', 'How many of our estimated units to spend in one five-hour window. A guess until a refusal measures it, and then it is whatever the refusal proved.', false, '2026-09-24 09:30:24.194534+00', 'fresh_alex_harness'),
	('notebook.week_units', '300', 'The weekly ceiling, same currency, same caveat.', false, '2026-09-24 09:30:24.194534+00', 'fresh_alex_harness'),
	('notebook.ceiling_is_measured', 'false', 'True once a refusal has taught us the real number. False means the ceiling above is still a guess and should be read as one.', false, '2026-09-24 09:30:24.194534+00', 'fresh_alex_harness'),
	('conversation.max_turns', '12', 'How many turns to carry. Enough to hold a real exchange; not so many that a long prompt buries the message actually being answered.', false, '2026-09-24 09:30:24.450155+00', 'fresh_alex_harness'),
	('db.region', '"eu-west-2"', 'Where that project is hosted. Recorded for the page; not enforced.', false, '2026-09-24 09:30:25.137733+00', 'fresh_alex_harness'),
	('calendar.calendar_id', '"primary"', 'Which calendar to read and write. "primary" is the account''s own.', false, '2026-09-24 09:30:25.137733+00', 'fresh_alex_harness'),
	('conversation.window_minutes', '1440', 'How far back a handler looks for the turns before this one. A window, not a session: a chat has no "conversation ended" event, so anything claiming to know where one stopped would be guessing.', false, '2026-09-24 09:30:31.200223+00', 'fresh_alex_harness'),
	('staff.avatar_base_url', '""', 'Public HTTPS base under which staff.avatar_ref paths are served. Slack icon_url needs a reachable image; without this the presentation degrades to a per-role emoji and says so. [blank on a fresh install — supply your own]', false, '2026-09-24 09:30:40.244063+00', 'fresh_alex_harness'),
	('slack.subject_user_id', '""', 'Slack user id for Grant. Invited to every channel the app provisions, because a channel the human is not in is a channel that receives results nobody reads. Not a secret: a user id is public within the workspace. [blank on a fresh install — supply your own]', false, '2026-09-24 09:30:40.244063+00', 'fresh_alex_harness'),
	('google.client_id', '""', 'The OAuth client id from Google Cloud. Public by design — it appears in every authorization URL — so it lives here rather than in the vault.', false, '2026-09-24 09:30:24.567058+00', 'fresh_alex_harness'),
	('google.scopes', '"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly"', 'What to ask for. Calendar only: §17 keeps each integration separately disableable, and a token that can also read Gmail is a token whose blast radius is not what the page says it is.', false, '2026-09-24 09:30:24.567058+00', 'fresh_alex_harness'),
	('knowledge.read_new_sources', 'true', 'Whether a source arriving in an established project starts a research job. Off makes the corpus passive again: documents are stored and nothing acts on them.', false, '2026-09-24 09:30:24.861073+00', 'fresh_alex_harness'),
	('knowledge.new_source_jobs_per_hour', '6', 'Ceiling on research jobs started by arriving sources, across all projects. A bulk paste into an established project looks exactly like news, and this is what makes that survivable.', false, '2026-09-24 09:30:24.861073+00', 'fresh_alex_harness'),
	('knowledge.new_source_min_chars', '600', 'Below this a document is not worth convening anyone over.', false, '2026-09-24 09:30:24.861073+00', 'fresh_alex_harness'),
	('telegram.bot_limit', '20', 'Bots one Telegram account may own: 20 normally, 40 with Premium. Telegram''s figure, not ours — bots_create_limit_default. Recorded so the system refuses a creation it cannot make, rather than discovering the ceiling as a confusing error on the twenty-first.', false, '2026-09-24 09:30:25.320749+00', 'fresh_alex_harness'),
	('github.repository', '"granterogers/agentic.team.grant"', 'owner/repo that repository_dispatch wakes when a voice note needs a worker that can run faster-whisper.', false, '2026-09-24 09:30:25.368001+00', 'fresh_alex_harness'),
	('gmail.enabled', 'false', 'Whether the team reads mail at all. Off until Grant connects Gmail and turns it on — a connected account is permission, not instruction.', false, '2026-09-24 09:30:25.389518+00', 'fresh_alex_harness'),
	('worker.paused_until', '""', 'RFC3339 time until which no pass may run, or empty. Set by verification suites so they can measure the queue without the heartbeat moving it, and readable on the front end so a pause is never invisible. Lapses on its own: a suite that dies must not stop the office permanently.', false, '2026-09-24 09:30:25.446869+00', 'fresh_alex_harness'),
	('voice.transcription', '"none"', 'How a voice note becomes words. "none" = we cannot, and the bot says so on arrival rather than queueing a job nothing can do. "runner" = a GitHub Actions run per note, which is what Grant asked to stop. "api" = a third-party speech service, which would send his voice off our own compute and is his decision to make, not mine (ADR-0009).', false, '2026-09-24 09:30:25.541409+00', 'fresh_alex_harness'),
	('voice.api_base_url', '"https://api.groq.com/openai/v1"', 'OpenAI-shaped speech endpoint. Groq by default: fastest of the compatible ones and free at this volume. Any provider speaking the same shape works.', false, '2026-09-24 09:30:25.581545+00', 'fresh_alex_harness'),
	('voice.api_model', '"whisper-large-v3-turbo"', 'The transcription model. Considerably better than the base.en that ran locally, which is what turned "NotebookLM" into "Not-to-But".', false, '2026-09-24 09:30:25.581545+00', 'fresh_alex_harness'),
	('telegram.direct_to_grant', '"chief-of-staff"', 'The one staff slug whose bot may write to Grant''s private chat. Everyone else goes to the office group when one exists. The pager bot (staff_slug null) is always direct — it is the Chief of Staff''s own bot and the interrupting voice §12 gives Telegram. Set to an empty string to let everybody message him directly again.', false, '2026-09-24 09:30:25.602359+00', 'fresh_alex_harness'),
	('notebook.reader_url', '"https://ai-team-hq.vercel.app/api/notebook"', 'The HTTPS endpoint that reads Gemini Notebook without a subprocess. Deployed by `npm run deploy:hq` alongside the page, because a Vercel deployment is an atomic file list and deploying one without the other would delete the other.', false, '2026-09-24 09:30:25.655442+00', 'fresh_alex_harness'),
	('notebook.writer_url', '"https://ai-team-hq.vercel.app/api/notebook-act"', 'The HTTPS endpoint that performs notebook write actions without a local subprocess. When this and notebook.reader_secret are both set, every runtime uses it — including the ones that COULD spawn Python. One transport everywhere is one transport that gets exercised; a fallback that only runs on a developer machine is a fallback nobody finds out is broken.', false, '2026-09-24 09:30:25.700431+00', 'fresh_alex_harness'),
	('backup.bucket', '"backups"', 'The private Storage bucket the nightly copy goes into. Asserted private before every upload: the avatars bucket beside it is public, and one wrong flag would put every row in the database at a guessable URL.', false, '2026-09-24 09:30:25.722252+00', 'fresh_alex_harness'),
	('telegram.pager_floor', '"important"', 'How loud something must be before it reaches Telegram rather than just Slack. One of trivial, routine, important, urgent, blocker. §12 gives Telegram one interrupting voice; this is where the bar is set.', false, '2026-09-24 09:30:25.938923+00', 'fresh_alex_harness'),
	('voice.writing_model', '""', 'The model that writes what Grant reads — the morning note, and anything a staff member says to him. Empty means the ordinary free failover order, which varies a sentence adequately and writes a good one about half the time. Naming a paid model here changes only the writing path.', false, '2026-09-24 09:30:25.963643+00', 'fresh_alex_harness'),
	('github.owner', '"granterogers"', 'The GitHub account whose repositories the team can be asked about, so "my Rest Timer repo" resolves without a URL. Distinct from `github.repository`, which is where this system''s own code lives.', false, '2026-09-24 09:30:26.071384+00', 'fresh_alex_harness'),
	('vault.naming', '"<service>.<purpose>_token — and a credential is never assumed absent"', 'Every vault secret is named <service>.<purpose>, so `app.vault_inventory()` can group them. The rule that matters: before saying a credential does not exist, ENUMERATE — do not test one guessed name. github.dispatch_token sat in the vault while the GitHub client asked for github.token and reported nothing there (0159).', false, '2026-09-24 09:30:26.122458+00', 'fresh_alex_harness'),
	('notion.hierarchy', '"Agentic project = Notion Teamspace; Notion Project = an initiative inside it"', 'Agentic Team → top-level project → Notion Teamspace → Notion Projects → tasks, pages, research, docs. A Notion "Project" is an initiative or workstream WITHIN a teamspace (Money Mastery → Plugin Architecture, Mobile UX Redesign), not a peer of an Agentic project. Supabase stays the canonical registry; Notion is mapped onto it, never the other way round.', false, '2026-09-24 09:30:26.170304+00', 'fresh_alex_harness'),
	('google.redirect_uri', '""', 'Where Google sends him back. Must be listed verbatim in the Cloud console''s Authorised redirect URIs, or the consent screen refuses before he sees it. [blank on a fresh install — supply your own]', false, '2026-09-24 09:30:40.244063+00', 'fresh_alex_harness'),
	('notion.agents_are_not_scoped_to_a_teamspace', 'true', 'Agents work across teamspaces. The teamspace an agent is currently operating in does not define its identity, role or permanent scope — a developer contributes to Money Mastery, Wellness and AI Team HQ as required. Recorded as a setting so a future staff.teamspace column meets an argument rather than an empty field (0161).', false, '2026-09-24 09:30:26.170304+00', 'fresh_alex_harness'),
	('telegram.only_chief_speaks', 'true', 'When true, only the Chief of Staff sends Telegram messages. Everyone else still does the work and still writes their output — the dashboard shows it all — they just do not send. Distinct from telegram.direct_to_grant, which decides WHICH CHAT someone lands in: that one routes the rest into the office group, and Grant is in the office group, so it never made them quiet (0165).', false, '2026-09-24 09:30:26.267863+00', 'fresh_alex_harness'),
	('jobs.self_improvement_tokens_per_day', '200000', 'Tokens the office may spend in 24 hours on working on ITSELF — noticing, reflecting, proposing. Enforced at dequeue: the kinds in self_improvement_kinds wait until the rolling window moves. Work for Grant is never counted or blocked (#53).', false, '2026-09-24 09:30:27.724356+00', 'fresh_alex_harness'),
	('calendar.sync_tasks', 'false', 'Whether dated, open tasks are written into Google Calendar as all-day events (ADR-0020). Off by default. One way only: the diary never changes a task.', false, '2026-09-24 09:30:28.257919+00', 'fresh_alex_harness'),
	('routing.unnamed_when_unresolved', 'true', 'When nothing names a project — a general Telegram chat, a voice call — file the message under the reserved Unnamed project (true, ADR-0024) rather than guessing at the most recently updated one (false).', false, '2026-09-24 09:30:30.61857+00', 'fresh_alex_harness'),
	('delivery.max_attempts', '5', 'Issue #202. How many times a failing send is retried before it is marked undelivered and shown to Grant. Five attempts with the backoff below is about half an hour of trying.', false, '2026-09-24 09:30:30.704914+00', 'fresh_alex_harness'),
	('delivery.backoff_seconds', '30', 'Issue #202. The first retry delay. It doubles each attempt up to the ceiling below, so 30 gives 30s, 1m, 2m, 4m.', false, '2026-09-24 09:30:30.704914+00', 'fresh_alex_harness'),
	('delivery.backoff_ceiling_seconds', '900', 'Issue #202. The longest a retry ever waits. Fifteen minutes: long enough that a provider outage is not hammered, short enough that recovery is noticed within one cycle.', false, '2026-09-24 09:30:30.704914+00', 'fresh_alex_harness'),
	('budget.pence_per_agent_per_day', '60', 'How many pence one agent may spend in a day before its queued work waits for tomorrow. Free-model work costs nothing and never counts.', false, '2026-09-24 09:30:31.514016+00', 'fresh_alex_harness'),
	('budget.pence_for_the_office_per_day', '200', 'How many pence the whole office may spend in a day. Binds above the per-agent limit, because eight agents at their own limit is eight times the ceiling anybody intended.', false, '2026-09-24 09:30:31.514016+00', 'fresh_alex_harness'),
	('ci.monthly_minutes', '1500', 'The office refuses to dispatch a workflow past this many GitHub Actions minutes in a calendar month. GitHub gives 2,000 free on a private repository; the margin is deliberate, because the 2026-09 incident was nobody counting rather than a small overshoot.', false, '2026-09-24 09:30:32.960361+00', 'fresh_alex_harness'),
	('web.base_url', '"https://ai-team-hq.vercel.app"', 'Where Team HQ is served. Used by google-oauth to send a person back into the app after consent, because Supabase will not serve HTML from the shared functions domain (0486).', false, '2026-09-24 09:30:34.2174+00', 'fresh_alex_harness'),
	('jobs.max_dequeues', '60', 'Absolute ceiling on how many times one job may be dequeued, however much progress it makes. The third bound on a resumable job: the other two are that progress is monotonic and that an attempt finishing no step still spends against max_attempts. Generous on purpose — the nightly backup legitimately needs a handful of slices and a pathological job dies here.', false, '2026-09-24 09:30:35.953518+00', 'fresh_alex_harness'),
	('backup.max_age_hours', '36', 'How old the newest FINISHED backup may be before the office raises a chore. The duty is daily, so 36 hours tolerates one missed night without crying wolf and notices two.', false, '2026-09-24 09:30:35.993519+00', 'fresh_alex_harness'),
	('backup.rehearsal_max_age_hours', '192', 'How long a proven restore stays proof. Eight days, so a weekly rehearsal has a day of slack. A backup nobody has restored from is a hope, not a backup (invariant 13).', false, '2026-09-24 09:30:35.993519+00', 'fresh_alex_harness'),
	('delivery.production_ingress', '["PostgREST%"]', 'LIKE patterns for the application_name of a connection permitted to create real inbound work. Every real message arrives through an edge function over PostgREST; a script reaches this database only through the Management API, which announces itself as mgmt-api. Data rather than code so that a rename at the vendor is one statement rather than a migration and a deploy (0541).', false, '2026-09-24 09:30:36.25498+00', 'fresh_alex_harness'),
	('db.project_ref', '""', 'The Supabase project the tooling connects to. Declared, not live: changing it tells the next run where to look and moves nothing. [blank on a fresh install — supply your own]', false, '2026-09-24 09:30:40.244063+00', 'fresh_alex_harness');


ALTER TABLE public.system_config ENABLE TRIGGER ALL;

--
-- PostgreSQL database dump complete
--


