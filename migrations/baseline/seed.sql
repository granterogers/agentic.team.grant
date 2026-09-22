--
-- PostgreSQL database dump
--

\restrict ss7DuerlsW2gjKfQsHUCJX1gTQC44ULlrXEEnK9wSMESxMqB7UKIEg60CPbkmpe

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
-- Data for Name: asset_actions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_actions (action, label, says, needs_two, "position") FROM stdin;
review	Review	Review %s and tell me what you think.	f	0
summarise	Summarise	Summarise %s.	f	1
research	Research	Research the questions %s raises, and come back with what you find.	f	2
critique	Critique	Critique %s — what is weak, what is missing, what would not survive scrutiny.	f	3
extract_tasks	Extract tasks	Read %s and pull out the things that need doing, as tasks on this project.	f	4
compare	Compare	Compare %s with the other one I have attached, and tell me how they differ.	t	5
\.


--
-- Data for Name: autonomy_policy; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.autonomy_policy (autonomy, action_level, verdict, note, set_by, set_at) FROM stdin;
observe	0	proceed	Reading is what observing is.	the default matrix	2026-09-22 14:26:56.10103+00
observe	1	refuse	Observing means it does not write, even internally.	the default matrix	2026-09-22 14:26:56.10103+00
observe	2	refuse	Nothing leaves the building.	the default matrix	2026-09-22 14:26:56.10103+00
observe	3	refuse	Nothing leaves the building.	the default matrix	2026-09-22 14:26:56.10103+00
suggest	0	proceed	Reading is never the thing worth asking about.	the default matrix	2026-09-22 14:26:56.10103+00
suggest	1	ask	It proposes; you decide, even for a draft.	the default matrix	2026-09-22 14:26:56.10103+00
suggest	2	ask	It proposes; you decide.	the default matrix	2026-09-22 14:26:56.10103+00
suggest	3	ask	It proposes; you decide.	the default matrix	2026-09-22 14:26:56.10103+00
act_with_review	0	proceed	Reading is never the thing worth asking about.	the default matrix	2026-09-22 14:26:56.10103+00
act_with_review	1	proceed	Internal work happens and you see it afterwards.	the default matrix	2026-09-22 14:26:56.10103+00
act_with_review	2	ask	Anything that leaves the building still waits.	the default matrix	2026-09-22 14:26:56.10103+00
act_with_review	3	ask	Consequential work always waits.	the default matrix	2026-09-22 14:26:56.10103+00
act	0	proceed	Reading is never the thing worth asking about.	the default matrix	2026-09-22 14:26:56.10103+00
act	1	proceed	It acts.	the default matrix	2026-09-22 14:26:56.10103+00
act	2	proceed	It acts, including outward.	the default matrix	2026-09-22 14:26:56.10103+00
act	3	ask	Consequential work always waits, at every level.	the default matrix	2026-09-22 14:26:56.10103+00
\.


--
-- Data for Name: breadth_dimensions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.breadth_dimensions (dimension, family, note, added_at) FROM stdin;
agents	who	every member of the roster is reachable	2026-09-22 14:26:54.80951+00
declared-capabilities	who	what an agent says it can do	2026-09-22 14:26:54.80951+00
tools-and-integrations	who	the meaningful ones, not every registry row	2026-09-22 14:26:54.80951+00
research	work		2026-09-22 14:26:54.80951+00
analysis	work		2026-09-22 14:26:54.80951+00
planning	work		2026-09-22 14:26:54.80951+00
recommendations	work		2026-09-22 14:26:54.80951+00
creation	work	writing and making, as opposed to answering	2026-09-22 14:26:54.80951+00
actions	work	the office changes something outside itself	2026-09-22 14:26:54.80951+00
project-management	work		2026-09-22 14:26:54.80951+00
software-and-project-reasoning	work		2026-09-22 14:26:54.80951+00
business-strategy	domain		2026-09-22 14:26:54.80951+00
monetisation	domain		2026-09-22 14:26:54.80951+00
finance	domain		2026-09-22 14:26:54.80951+00
marketing-and-growth	domain		2026-09-22 14:26:54.80951+00
communications	domain		2026-09-22 14:26:54.80951+00
operations	domain		2026-09-22 14:26:54.80951+00
quality-and-risk	domain		2026-09-22 14:26:54.80951+00
connected-knowledge	context	work that depends on an attached source	2026-09-22 14:26:54.80951+00
project-scoped-work	context		2026-09-22 14:26:54.80951+00
cross-project-work	context		2026-09-22 14:26:54.80951+00
memory-dependent-work	context	needs what was said earlier	2026-09-22 14:26:54.80951+00
single-agent-work	shape		2026-09-22 14:26:54.80951+00
multi-agent-work	shape		2026-09-22 14:26:54.80951+00
tool-heavy-work	shape		2026-09-22 14:26:54.80951+00
no-tool-reasoning	shape		2026-09-22 14:26:54.80951+00
permission-gated-actions	shape	the office is allowed to refuse	2026-09-22 14:26:54.80951+00
unavailable-capabilities	failure	asked for something it genuinely cannot do	2026-09-22 14:26:54.80951+00
provider-failures	failure		2026-09-22 14:26:54.80951+00
malformed-inputs	failure		2026-09-22 14:26:54.80951+00
contradictory-instructions	failure		2026-09-22 14:26:54.80951+00
corrections	failure	Grant says the previous answer was wrong	2026-09-22 14:26:54.80951+00
changed-intent	failure	he wants something else now	2026-09-22 14:26:54.80951+00
ambiguous-requests	language		2026-09-22 14:26:54.80951+00
long-multi-clause	language		2026-09-22 14:26:54.80951+00
voice-and-speech-style	language	how he actually talks into a phone	2026-09-22 14:26:54.80951+00
hallucination-traps	failure	the answer is only available by making it up	2026-09-22 14:26:54.80951+00
\.


--
-- Data for Name: ci_workflows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_workflows (workflow, purpose, expected_minutes, cap_minutes, enabled, disabled_reason, created_at, updated_at) FROM stdin;
ci	Lint, typecheck, tests, the migration check and the secret scan, on a machine that is not the authoring session — the independent second opinion the local pre-push gate cannot give.	6	15	t		2026-09-22 14:26:56.807834+00	2026-09-22 14:26:56.807834+00
\.


--
-- Data for Name: knowledge_connectors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.knowledge_connectors (connector, name, automated, enabled, disabled_reason, notes, created_at, updated_at, health_service) FROM stdin;
upload	Direct upload	t	t	\N	A document handed to the system with no external system behind it. external_ref is null, which is why the uniqueness index is partial.	2026-09-22 14:26:47.025229+00	2026-09-22 14:26:47.025229+00	\N
mcp	MCP client	t	t	\N	Added by an MCP client (Claude, ChatGPT). A distinct connector from 'upload' because "a model pasted this in" and "Grant uploaded this" are different provenances, and §10 is built on citations meaning something.	2026-09-22 14:26:47.467659+00	2026-09-22 14:26:47.467659+00	\N
notebooklm	Google NotebookLM	f	t	\N	Re-enabled 2026-09-06 at Grant's instruction. No public API, so the client impersonates a browser session - the behaviour the 2026-09-04 ban named. Everything it feeds is cached in public.documents, so if the account goes again the corpus stays (ADR-0013).	2026-09-22 14:26:47.025229+00	2026-09-22 14:26:49.675038+00	Google
notion	Notion	t	t	\N	Official API, OAuth, documented rate limits, no policy exposure. The first-class connector under ADR-0013. Not yet implemented — a token from Grant is all it waits on.	2026-09-22 14:26:47.025229+00	2026-09-22 14:26:49.675038+00	Notion
github	GitHub	t	t	\N	Official REST API, documented rate limits, no policy exposure — a first-class connector under ADR-0013, in the same tier as Notion. Public repositories need no credential at 60 requests an hour per address; private ones need a fine-grained token in the vault as `github.token`, which also raises the limit to 5,000. Read-only: `github.write` is registered at risk 3 and disabled (§13).	2026-09-22 14:26:49.649641+00	2026-09-22 14:26:49.675038+00	GitHub
drive	Google Drive	t	t	\N	A folder per project, watched through the changes feed. Read-only: the scope is drive.readonly and nothing here writes to Grant's Drive.	2026-09-22 14:26:50.807594+00	2026-09-22 14:26:50.807594+00	\N
browser	Signed-in browser	t	t	\N	A real Chromium, opened somewhere ephemeral for one page at a time and then destroyed. The SESSION persists in the Vault; the browser does not, because a process held open between jobs is the one thing in this architecture that costs money. Reads and photographs. Does not press anything.	2026-09-22 14:26:56.69923+00	2026-09-22 14:26:56.69923+00	\N
\.


--
-- Data for Name: connector_capabilities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.connector_capabilities (connector, verb, returns, reach, cost_note, used_by, verified_by, last_verified) FROM stdin;
notebooklm	list the notebooks	every notebook on the account	unofficial	no quota cost	job kind notebook.collect	probe	2026-09-22 14:26:53.380011+00
notebooklm	read the account limits	tier, notebook and source ceilings	unofficial	no quota cost	app.notebook_allowance	probe	2026-09-22 14:26:53.380011+00
notebooklm	list a notebook's sources	each source and its text	unofficial	no quota cost	job kind notebook.collect	probe	2026-09-22 14:26:53.380011+00
notebooklm	create a notebook	a new notebook	unofficial	counts against the notebook ceiling	job kind office.notion_import and the plan step create_project	probe	2026-09-22 14:26:53.380011+00
notebooklm	add a source by URL or text	the source, indexed	unofficial	counts against the source ceiling	job kind notebook.add_source	probe	2026-09-22 14:26:53.380011+00
notebooklm	ask the notebook a question	an answer grounded in the sources	unofficial	counts against the five-hour allowance	job kind notebook.ask	probe	2026-09-22 14:26:53.380011+00
notebooklm	generate an artifact	audio overview, mind map, slide deck, report	unofficial	counts against the five-hour allowance; needs Grant's approval first	job kind notebook.generate	probe	2026-09-22 14:26:53.380011+00
notebooklm	download a generated artifact	the file itself	unofficial	no quota cost	job kind notebook.collect_artifact	probe	2026-09-22 14:26:53.380011+00
notebooklm	create a note in a notebook	a note	unofficial	no quota cost		probe	2026-09-22 14:26:53.380011+00
notebooklm	share a notebook with someone	nothing — a person must do this	browser_only			declared	\N
notebooklm	read another account's notebook	nothing	none			declared	\N
notion	read the pages and databases shared with the integration	each page's blocks as text	api	free tier	duty:notion-sync	suite	2026-09-22 14:26:53.380011+00
notion	create a page in a data source	the page	api	free tier	job kind office.notion_import	suite	2026-09-22 14:26:53.380011+00
notion	append blocks to a page	the updated page	api	free tier	job kind office.notion_import	suite	2026-09-22 14:26:53.380011+00
notion	relate one page to another	the relation	api	free tier	job kind office.notion_import	suite	2026-09-22 14:26:53.380011+00
notion	query a data source	matching rows	api	free tier	duty:notion-sync	suite	2026-09-22 14:26:53.380011+00
notion	read or create a teamspace	nothing — Notion exposes none on any version	none			suite	2026-09-22 14:26:53.380011+00
drive	watch a folder for changes	the changed files	api	free tier	job kind drive.watch	suite	2026-09-22 14:26:53.380011+00
drive	write a file into Grant's Drive	nothing — the scope is drive.readonly	none			declared	\N
github	read a repository's tree, files, issues and releases	the content	api	free; 60 requests an hour unauthenticated, 5,000 with a token	src/github/api.ts	suite	2026-09-22 14:26:53.380011+00
github	write to a repository	nothing — github.write is disabled at risk 3 (§13)	none			declared	\N
upload	accept a file handed to the office	a document row	api	free	hq-api, the studio upload	suite	2026-09-22 14:26:53.380011+00
mcp	accept a document from an MCP client	a document row	api	free	the MCP server	suite	2026-09-22 14:26:53.380011+00
drive	read a file — its text where Drive can export text, the file itself where it cannot	the text, or the bytes in the office's own storage	api	free tier	job kind drive.read_file	suite	2026-09-22 14:26:54.089622+00
browser	read a page the office is signed in to	the page's words, kept as a source document	browser_only	ten browser-minutes a day free on Cloudflare's Workers plan; metered by app.browser_budget	browser.gather	declared	\N
browser	photograph a page	a PNG in the private files bucket	browser_only	counts against the same ten minutes	browser.gather	declared	\N
browser	sign in on Grant's behalf	nothing — the session is established by a person and stored in the Vault	none	a password typed by an agent is a password an agent can be talked into typing		declared	\N
browser	press a button, submit a form, or buy anything	nothing — the gather tier is read-only by design	none	acting needs its own approval path (#15), its own verbs and its own migration		declared	\N
\.


--
-- Data for Name: contact_labels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contact_labels (label_id, owner, name, hue, sort, created_at) FROM stdin;
61483d4a-913f-4278-ac21-19994b2b20d1	grant	Client	p-moss	0	2026-09-22 14:26:53.034614+00
7ddb40ca-e058-4d48-b47a-3620ca265dcd	grant	Lead	p-amber	1	2026-09-22 14:26:53.034614+00
76e46ce1-2cdd-4cf8-8072-5fb52220fee7	grant	Coach	p-iris	2	2026-09-22 14:26:53.034614+00
3f8be96b-6866-42ee-a7de-876c43fe1a84	grant	Colleague	p-slate	3	2026-09-22 14:26:53.034614+00
1aba27c6-9a6e-456d-841a-d4c5168e0eeb	grant	Referrer	p-rust	4	2026-09-22 14:26:53.034614+00
\.


--
-- Data for Name: google_services; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.google_services (slug, name, does, scopes, offered, sort) FROM stdin;
calendar	Google Calendar	Lets the team see what is on your diary, so they can answer questions about your week and avoid booking over it.	https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly	t	10
gmail	Gmail	Lets the team search and read your mail, and draft replies for you. It can never send: §11 keeps sending off by policy, whatever the permission allows.	https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose	t	20
drive	Google Drive	Lets the team read documents you point them at, so a brief can cite your own files instead of guessing.	https://www.googleapis.com/auth/drive.readonly	t	30
youtube	YouTube	Lets the team read your playlists and saved videos, so a video you saved can become a source like any other.	https://www.googleapis.com/auth/youtube.readonly	t	40
\.


--
-- Data for Name: icon_defaults; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.icon_defaults (term, icon, added_by, created_at) FROM stdin;
course	graduation-cap	migration	2026-09-22 14:26:55.799924+00
coaching	graduation-cap	migration	2026-09-22 14:26:55.799924+00
training	graduation-cap	migration	2026-09-22 14:26:55.799924+00
school	school	migration	2026-09-22 14:26:55.799924+00
research	microscope	migration	2026-09-22 14:26:55.799924+00
study	microscope	migration	2026-09-22 14:26:55.799924+00
analysis	chart-line	migration	2026-09-22 14:26:55.799924+00
finance	coins	migration	2026-09-22 14:26:55.799924+00
budget	calculator	migration	2026-09-22 14:26:55.799924+00
pricing	banknote	migration	2026-09-22 14:26:55.799924+00
invoice	receipt	migration	2026-09-22 14:26:55.799924+00
accounts	landmark	migration	2026-09-22 14:26:55.799924+00
marketing	megaphone	migration	2026-09-22 14:26:55.799924+00
campaign	megaphone	migration	2026-09-22 14:26:55.799924+00
brand	palette	migration	2026-09-22 14:26:55.799924+00
design	palette	migration	2026-09-22 14:26:55.799924+00
content	pen-tool	migration	2026-09-22 14:26:55.799924+00
website	globe	migration	2026-09-22 14:26:55.799924+00
web	globe	migration	2026-09-22 14:26:55.799924+00
api	server	migration	2026-09-22 14:26:55.799924+00
data	database	migration	2026-09-22 14:26:55.799924+00
platform	server	migration	2026-09-22 14:26:55.799924+00
ai	bot	migration	2026-09-22 14:26:55.799924+00
agent	bot	migration	2026-09-22 14:26:55.799924+00
roadmap	map	migration	2026-09-22 14:26:55.799924+00
hiring	users	migration	2026-09-22 14:26:55.799924+00
team	users	migration	2026-09-22 14:26:55.799924+00
people	users	migration	2026-09-22 14:26:55.799924+00
health	heart-pulse	migration	2026-09-22 14:26:55.799924+00
wellness	heart-pulse	migration	2026-09-22 14:26:55.799924+00
fitness	dumbbell	migration	2026-09-22 14:26:55.799924+00
property	home	migration	2026-09-22 14:26:55.799924+00
house	home	migration	2026-09-22 14:26:55.799924+00
build	hammer	migration	2026-09-22 14:26:55.799924+00
travel	plane	migration	2026-09-22 14:26:55.799924+00
trip	plane	migration	2026-09-22 14:26:55.799924+00
event	calendar	migration	2026-09-22 14:26:55.799924+00
sales	handshake	migration	2026-09-22 14:26:55.799924+00
client	handshake	migration	2026-09-22 14:26:55.799924+00
operations	settings	migration	2026-09-22 14:26:55.799924+00
archive	archive	migration	2026-09-22 14:26:55.799924+00
podcast	mic	migration	2026-09-22 14:26:55.799924+00
video	film	migration	2026-09-22 14:26:55.799924+00
photo	camera	migration	2026-09-22 14:26:55.799924+00
music	music	migration	2026-09-22 14:26:55.799924+00
learning	book	migration	2026-09-22 14:26:55.799924+00
curriculum	book	migration	2026-09-22 14:26:55.799924+00
report	file	migration	2026-09-22 14:26:55.799924+00
docs	file	migration	2026-09-22 14:26:55.799924+00
documentation	file	migration	2026-09-22 14:26:55.799924+00
support	heart-handshake	migration	2026-09-22 14:26:55.799924+00
product	boxes	migration	2026-09-22 14:26:55.799924+00
launch	target	migration	2026-09-22 14:26:55.799924+00
legal	gavel	migration	2026-09-22 14:26:55.799924+00
compliance	shield	migration	2026-09-22 14:26:55.799924+00
risk	shield	migration	2026-09-22 14:26:55.799924+00
app	phone	migration	2026-09-22 14:26:55.799924+00
revenue	chart-line	migration	2026-09-22 14:26:55.799924+00
growth	chart-line	migration	2026-09-22 14:26:55.799924+00
automation	settings	migration	2026-09-22 14:26:55.799924+00
process	settings	migration	2026-09-22 14:26:55.799924+00
\.


--
-- Data for Name: job_kind_needs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.job_kind_needs (kind, needs_subprocess, why, created_at) FROM stdin;
office.sync	f	Reads only, and reads now go over HTTPS to api/notebook.py (0138). Kept in this table rather than deleted, so the next person can see that the question was asked and answered.	2026-09-22 14:26:49.157098+00
notebook.generate	f	Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.	2026-09-22 14:26:49.157098+00
notebook.add_source	f	Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.	2026-09-22 14:26:49.157098+00
notebook.push_document	f	Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.	2026-09-22 14:26:49.157098+00
notebook.collect	f	Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.	2026-09-22 14:26:49.157098+00
notebook.ask	f	Writes go over HTTPS to api/notebook-act.py, which spawns act.py on a runtime that has Python (0140). A timeout there is reported as an ambiguous write, never as a retryable failure.	2026-09-22 14:26:49.157098+00
office.notion_adopt	f	Attaches a project to the Notion data sources shared with the integration. Plain HTTPS, so any worker can run it.	2026-09-22 14:26:49.831469+00
office.notion_import	f	Writes a project's source material into its attached Notion data sources as Projects, Docs and Tasks. Idempotent on page title, so a rerun adds what is missing and leaves the rest alone. Plain HTTPS.	2026-09-22 14:26:49.889599+00
\.


--
-- Data for Name: model_prices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.model_prices (model_id, effective_from, input_usd_per_mtok, output_usd_per_mtok, source_url, note) FROM stdin;
	1970-01-01 00:00:00+00	0.1500	0.6000	https://openrouter.ai/models	Fallback for any model with no published price. Deliberately not zero: an unknown model priced at zero would make the modelled total FALL as price coverage got worse.
cohere/north-mini-code:free	1970-01-01 00:00:00+00	0.0000	0.0000	https://openrouter.ai/cohere/north-mini-code:free	Free tier.
dots-studio/dots-3-note-preview:free	1970-01-01 00:00:00+00	0.0000	0.0000	https://openrouter.ai/dots-studio/dots-3-note-preview:free	Free tier.
inclusionai/ling-3.0-flash-fin:free	1970-01-01 00:00:00+00	0.0000	0.0000	https://openrouter.ai/inclusionai/ling-3.0-flash-fin:free	Free tier.
fixture/free-model	1970-01-01 00:00:00+00	0.0000	0.0000	https://example.invalid/fixture	Test fixture, not a real model.
gate5-probe	1970-01-01 00:00:00+00	0.0000	0.0000	https://example.invalid/fixture	Test fixture, not a real model.
\.


--
-- Data for Name: notebook_operation_cost; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notebook_operation_cost (operation, units, note, updated_at) FROM stdin;
ask	1	a question against the notebook's sources	2026-09-22 14:26:47.714791+00
add_text	1	a source, processed once on the way in	2026-09-22 14:26:47.714791+00
add_url	2	Google fetches and processes the page	2026-09-22 14:26:47.714791+00
create_note	1	written, not generated	2026-09-22 14:26:47.714791+00
mindmap	3	structural, and the cheapest thing Studio makes	2026-09-22 14:26:47.714791+00
quiz	4		2026-09-22 14:26:47.714791+00
flashcards	4		2026-09-22 14:26:47.714791+00
study_guide	5		2026-09-22 14:26:47.714791+00
report	5		2026-09-22 14:26:47.714791+00
infographic	6	an image, generated	2026-09-22 14:26:47.714791+00
slides	8	a deck, generated slide by slide	2026-09-22 14:26:47.714791+00
audio	10	minutes of synthesised conversation	2026-09-22 14:26:47.714791+00
video	15	the most expensive thing the product makes	2026-09-22 14:26:47.714791+00
\.


--
-- Data for Name: output_shapes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.output_shapes (shape, description, required, optional, created_at) FROM stdin;
tasks_extracted	A list of things to do, found in something the office read. The headline case: each entry can become a real task through hq_task_add, which has been a complete write path since #11 and #106 and had nothing to feed it.	{"tasks": "array<object>"}	{"from": "string"}	2026-09-22 14:26:52.718411+00
research_summary	What was found, and where it came from. #116's judge can check this without a model: a summary claiming three sources and carrying one is objectively wrong and no LLM is needed to say so.	{"sources": "array<object>", "findings": "array<string>"}	{"unanswered": "array<string>"}	2026-09-22 14:26:52.718411+00
draft_document	A document the office wrote, ready to be imported into a project. The title is separate from the markdown so the import step has something to name the row with rather than taking the first line and hoping.	{"title": "string", "markdown": "string"}	{"tags": "array<string>", "suggested_collection": "string"}	2026-09-22 14:26:52.718411+00
comparison	Several options weighed against each other. Every consumer of one of these today re-reads the prose to find out which option won.	{"options": "array<object>"}	{"criteria": "array<string>", "recommended": "string"}	2026-09-22 14:26:52.718411+00
recommendation	One course of action and the reasons for it. The reasons are a list rather than a paragraph so that a follow-up can check whether any of them has stopped being true.	{"because": "array<string>", "recommend": "string"}	{"alternatives": "array<string>", "confidence_note": "string"}	2026-09-22 14:26:52.718411+00
nothing_happened	A duty that ran and found nothing to do. Structured because "nothing changed" is the answer sixteen times a day and a consumer should not have to read a sentence to establish it.	{"changed": "boolean"}	{"looked_at": "number"}	2026-09-22 14:26:52.718411+00
plan_carried_out	What a constrained plan actually did, as receipts, and where it got to (#283). done and could_not name compiled steps; receipts are canonical ids the run produced; verdict is the deterministic assessment of the GOAL rather than of the steps.	{"done": "array<string>", "goal": "string", "steps": "array<object>", "verdict": "string", "receipts": "array<string>", "could_not": "array<string>"}	{"unmet": "array<string>", "rounds": "number", "stopped_at": "string"}	2026-09-22 14:26:59.605445+00
\.


--
-- Data for Name: providers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.providers (provider, display_name, api_status, priority, enabled, disabled_reason, free_only, base_url, secret_ref, notes, created_at, updated_at, max_price_prompt, max_price_completion, max_cost_per_call_usd) FROM stdin;
openai	OpenAI	official	50	t	\N	f	https://api.openai.com/v1	\N	Realtime voice only (Gate 1). free_only false because Realtime has no free tier — which is why voice is an explicitly funded decision (D3), not a default.	2026-09-22 14:26:45.864179+00	2026-09-22 14:26:45.864179+00	0	0	0
gemini	Google Gemini	official	60	t	\N	t	https://generativelanguage.googleapis.com/v1beta	\N	Free-tier rate limits are undocumented — Google removed the published tables, so capacity here is ESTIMATED and never AUTHORITATIVE (§11).	2026-09-22 14:26:45.864179+00	2026-09-22 14:26:45.864179+00	0	0	0
openrouter	OpenRouter	official	10	t	\N	f	https://openrouter.ai/api/v1	\N	Primary router. Funded 2026-09-15: low-cost paid models within the budget columns. openrouter/auto and auto:free still report -1 and remain denied (section 11).	2026-09-22 14:26:45.864179+00	2026-09-22 14:26:54.978379+00	0.20	1.00	0.01
\.


--
-- Data for Name: provider_models; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.provider_models (provider, model_id, status, pricing_prompt, pricing_completion, last_probed_at, last_success_at, last_error, consecutive_failures, first_seen_at, updated_at, priority) FROM stdin;
openrouter	openai/gpt-oss-120b	usable	0.000000037	0.00000017	\N	2026-09-22 14:26:54.978379+00	\N	0	2026-09-22 14:26:54.978379+00	2026-09-22 14:26:54.978379+00	10
openrouter	qwen/qwen3.7-flash	usable	0.00000003	0.00000013	\N	2026-09-22 14:26:55.007757+00	\N	0	2026-09-22 14:26:55.007757+00	2026-09-22 14:26:55.007757+00	20
openrouter	mistralai/mistral-small-3.2-24b-instruct	usable	0.000000075	0.0000002	\N	2026-09-22 14:26:55.007757+00	\N	0	2026-09-22 14:26:55.007757+00	2026-09-22 14:26:55.007757+00	30
\.


--
-- Data for Name: staff; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.staff (staff_id, slug, name, title, permanent, responsibilities, expertise, communication_style, avatar_ref, prompt_version, active, created_at, updated_at, expires_at, justification, requested_for_job, pronouns, telegram_username) FROM stdin;
29bb98ef-850d-4f51-aa07-128addeea38e	chief-of-staff	Claire	Chief of Staff	t	Routes incoming work, classifies intent, decides who is needed and who is not, and recommends temporary specialists. Owns the decision NOT to convene anyone: §9 is explicit that simple factual retrieval is not a team meeting.	{routing,delegation,"intent classification",prioritisation}	Brief and decisive. States the decision first and the reasoning second, and says plainly when something does not need doing.	chief-of-staff.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	she/her	\N
86cba079-51ee-4ac3-891d-5952ea6f87fc	finance-director	Daniel	Finance & Data Director	t	Owns numbers, unit economics and measurement. Distinguishes measured figures from modelled ones and refuses to present an estimate as an observation - the same discipline §11 applies to usage provenance.	{budget,cashflow,charge,cost,costs,"data analysis",finance,forecast,invoice,margin,metrics,price,pricing,profit,revenue,spend,"unit economics"}	Numerate and sceptical. Always says whether a figure is measured, calculated or estimated.	finance-director.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	he/him	\N
75d6879e-5fe8-4efe-b936-e625fd101220	growth-director	Ruby	Growth & Marketing Director	t	Owns positioning, messaging, audience and demand. Judges whether a claim is defensible before it is persuasive, and flags anything that would need substantiating externally.	{audience,brand,campaign,demand,"demand generation",funnel,instagram,launch,leads,linkedin,marketing,messaging,positioning,seo,social}	Plain and concrete. Avoids superlatives it cannot substantiate.	growth-director.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	she/her	\N
eaac3cf7-752c-4547-809f-ce6519159a06	operations-director	Marcus	Operations Director	t	Owns how work actually gets done: sequencing, dependencies, capacity and follow-through. Notices when a plan assumes capacity that does not exist.	{backlog,capacity,deadline,logistics,operations,process,rollout,schedule,sequence,sequencing,staffing,workflow}	Practical and specific about who does what by when. Surfaces the constraint rather than the wish.	operations-director.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	he/him	\N
0265bfb7-6278-4b65-8b05-2ed599ec36d2	strategy-director	Tom	Strategy Director	t	Turns evidence into options with trade-offs, and states which option is recommended and why. Responsible for making the cost of each path explicit rather than presenting a single course as inevitable.	{approach,decide,decision,direction,options,"options analysis",plan,planning,priorities,roadmap,strategy,trade,trade-offs}	Presents a recommendation, not a menu. Names the strongest argument against its own recommendation.	strategy-director.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	he/him	\N
f5779a09-79c2-4454-b5d8-1f416c4ba04a	quality-director	Grace	Quality & Risk Director	t	Reviews substantive output before it commits, per §10. Assigns confidence and evidence type, surfaces contradictions rather than averaging them away, and may reject. This role exists to be able to say no.	{quality,verify,regulation,risk,"contract risk",legal,legally,"evidence grading",contradiction,review,"quality review",liability,audit,regulatory,breach,confidentiality,"data protection","contradiction detection",accuracy,obligation,check,exposure,privacy,compliance}	Direct about problems and specific about which part is weak. Reserves approval rather than withholding an opinion.	quality-director.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	she/her	\N
b1286651-1130-4576-b75f-28247b3e7b64	communications-director	Oliver	Communications & Creative Director	t	Owns how things are said to people outside the team, and how they read. Responsible for clarity over polish and for never letting presentation outrun the confidence of the underlying finding.	{announcement,blog,copy,draft,editing,email,headline,narrative,newsletter,post,presentation,script,tone,wording,write,writing}	Edits for clarity first. Will not dress up a Low-confidence finding in High-confidence prose.	communications-director.jpg	1	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	he/him	\N
99e17ee9-1ecb-4194-8fdd-a8e7b9c634a3	research-director	Emma	Research Director	t	Gathers and weighs evidence, tracks source provenance, and reports what the sources actually support rather than what would be convenient. Owns the distinction between direct evidence and inference.	{benchmark,compare,competitor,competitors,evidence,find,landscape,market,provenance,research,source,"source evaluation",sources,study,survey,synthesis}	Cites as it goes. Distinguishes what a source says from what it implies, and names the gap when asked something the evidence cannot answer.	research-director.jpg	3	t	2026-09-22 14:26:46.198351+00	2026-09-22 14:27:00.155959+00	\N	\N	\N	she/her	\N
\.


--
-- Data for Name: responsibilities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.responsibilities (responsibility_id, slug, staff_id, project_id, description, job_kind, period_minutes, last_run_at, enabled, created_at, updated_at, at_time, timezone, pinned_config, recipient_agent, created_by) FROM stdin;
a75b6493-8b77-4e83-9fea-a1330dd60dc5	calendar-refresh	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Keep the cached view of Grant's calendar current, so the team can answer questions about his week without a round trip and can go on answering them when Google is unreachable.	google.read_calendar	60	\N	t	2026-09-22 14:26:48.450474+00	2026-09-22 14:26:48.450474+00	\N	\N	{}	\N	migration
664edb2e-2437-484e-bb49-5bebd0cd5668	mail-refresh	29bb98ef-850d-4f51-aa07-128addeea38e	\N	Read what has arrived in the inbox, so the team can answer questions about it without waiting on Google.	google.read_mail	60	\N	f	2026-09-22 14:26:48.926479+00	2026-09-22 14:26:48.926479+00	\N	\N	{}	\N	migration
c11e67ad-a371-49be-9d8e-7b2c060144c3	vault-export	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Send Grant an encrypted copy of the vault, so the credentials survive losing this Supabase project (§16).	office.vault_export	10080	\N	f	2026-09-22 14:26:49.07281+00	2026-09-22 14:26:49.07281+00	\N	\N	{}	\N	migration
7ca8a521-7489-4a97-8b50-aa9319351e60	discovery-sync	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Look for new sources in every attached project and pull them in, so the team notices a document arriving without being told.	office.sync	60	\N	t	2026-09-22 14:26:49.07281+00	2026-09-22 14:26:49.187962+00	\N	\N	{}	\N	migration
fae52133-b717-4f84-bd74-c90dec0a9ee6	nightly-backup	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Take a portable copy of the whole database and keep it in a private bucket, so losing this machine or this repository does not lose the work (§16).	office.backup	1440	\N	t	2026-09-22 14:26:49.257656+00	2026-09-22 14:26:49.257656+00	\N	\N	{}	\N	migration
707cdd82-0023-4f20-8f66-e2f803c37322	slack-rotation	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Renew the Slack app configuration tokens before they expire. They last twelve hours and the refresh token is single-use, so missing the window means a human regenerating the pair by hand. Channel archiving is NOT this duty — that is npm run slack:tidy -- --go.	office.slack_rotate	240	\N	t	2026-09-22 14:26:49.07281+00	2026-09-22 14:26:49.302961+00	\N	\N	{}	\N	migration
32638808-a8a9-4a99-8033-0dfe215a6db0	notion-sync	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Read the Notion databases each project is attached to and file what is there. A project maps to a Notion Teamspace by name and to that teamspace's databases by id (0161); a project with no Notion attachment is skipped rather than guessed at.	office.notion_sync	120	\N	t	2026-09-22 14:26:49.376039+00	2026-09-22 14:26:49.750995+00	\N	\N	{}	\N	migration
6cf389bc-b3a2-44c0-9db2-620385b2db64	daily-capacity-report	86cba079-51ee-4ac3-891d-5952ea6f87fc	\N	Report each day what the team spent: work done, model calls and their cost, the notebook allowance remaining, whether messages arrived, and what is waiting on Grant.	office.capacity_report	1440	\N	t	2026-09-22 14:26:48.197121+00	2026-09-22 14:26:50.639073+00	18:00:00	\N	{}	\N	migration
9ab78df3-c293-4059-bafb-fd3a36424cdc	morning-briefing	29bb98ef-850d-4f51-aa07-128addeea38e	\N	Brief Grant each morning: what needs him, what is on today, what the office did overnight, and what is worth deciding.	briefing.morning	1440	\N	t	2026-09-22 14:26:50.690555+00	2026-09-22 14:26:50.690555+00	07:00:00	\N	{}	\N	migration
f3b925b2-ba59-40a5-b337-ee195397eee6	drive-watch	29bb98ef-850d-4f51-aa07-128addeea38e	\N	Watch each project's Google Drive folder and ask Grant what to do with anything new that appears in it.	drive.watch	10	\N	t	2026-09-22 14:26:50.838043+00	2026-09-22 14:26:50.838043+00	\N	\N	{}	\N	migration
f1410395-e4dd-4f4a-87dc-5c7246d0d526	calendar-task-sync	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Keep Google Calendar matching the task list: dated, open tasks appear as all-day events and come away again when they are done. One way only — the diary never changes a task.	google.write_calendar_tasks	60	\N	t	2026-09-22 14:26:52.007615+00	2026-09-22 14:26:52.007615+00	\N	\N	{}	\N	migration
5f369369-2764-4465-af9d-3d53608ce2eb	job-trace-retention	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Drop job trace steps older than thirty days, keeping the rollup on the job. The trace is the highest-volume table in the office and the free tier is 500 MB, so the window is enforced rather than intended.	office.prune_job_traces	60	\N	t	2026-09-22 14:26:52.399309+00	2026-09-22 14:26:52.399309+00	\N	\N	{}	\N	migration
0a470bea-4c36-4748-9344-14674d9d552a	build-shot-retention	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Delete build-diary screenshots that no step points at any more. The rows prune at thirty days and the pictures did not, so the bucket only ever grew against a 1 GB allowance.	office.prune_build_shots	1440	\N	t	2026-09-22 14:26:55.911454+00	2026-09-22 14:26:55.911454+00	\N	\N	{}	\N	migration
41f4de12-ee2b-426d-9a92-cb9643f9778f	proposal-round	f5779a09-79c2-4454-b5d8-1f416c4ba04a	\N	Turn what the office could not do into proposals Grant can answer (#49).	office.propose	1440	\N	t	2026-09-22 14:26:57.284615+00	2026-09-22 14:26:57.284615+00	\N	\N	{}	\N	migration
3a553275-47c7-4397-b0ea-fc11d2d75e2d	credential-chores	eaac3cf7-752c-4547-809f-ce6519159a06	\N	Put a credential the office cannot fix on Grant's own list, and take it off again when it is healthy	office.chores	60	\N	t	2026-09-22 14:26:57.600666+00	2026-09-22 14:26:57.600666+00	\N	\N	{}	\N	grant
fa43e242-f0df-441c-8c15-73da01303883	task-reminders	29bb98ef-850d-4f51-aa07-128addeea38e	\N	Say something when a personal task reminder falls due (#259).	tasks.remind	15	\N	t	2026-09-22 14:26:58.799297+00	2026-09-22 14:26:58.799297+00	\N	\N	{}	\N	migration
021b7030-5907-4ddb-aee0-2970f7ef8efb	vikunja-sync	29bb98ef-850d-4f51-aa07-128addeea38e	\N	Keep Grant's personal tasks in step with Vikunja, when he has connected one (#259).	tasks.sync	15	\N	f	2026-09-22 14:26:59.16058+00	2026-09-22 14:26:59.205839+00	\N	\N	{}	\N	migration
\.


--
-- Data for Name: self_improvement_kinds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.self_improvement_kinds (kind, why, created_at) FROM stdin;
office.notice	Looking for what nobody asked about (#52). Useful, and the easiest thing in the office to run too often.	2026-09-22 14:26:51.362172+00
office.reflect	Reading its own past work to draw a lesson (#49). Costs a model call per pass and produces something advisory rather than something Grant asked for.	2026-09-22 14:26:51.362172+00
office.propose	Writing up a proposed improvement (#49). The output is a suggestion, so an expensive one that is declined has cost tokens for nothing.	2026-09-22 14:26:51.362172+00
office.learn	Turning an observation into a stored lesson or skill (#48, #50).	2026-09-22 14:26:51.362172+00
\.


--
-- Data for Name: staff_prompts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.staff_prompts (prompt_id, staff_id, version, body, rationale, authored_by, created_at) FROM stdin;
2777a015-79c9-4080-8ddf-2c56d833c996	29bb98ef-850d-4f51-aa07-128addeea38e	1	You are Chief of Staff, Chief of Staff.\n\nResponsibilities: Routes incoming work, classifies intent, decides who is needed and who is not, and recommends temporary specialists. Owns the decision NOT to convene anyone: §9 is explicit that simple factual retrieval is not a team meeting.\n\nExpertise: routing, delegation, intent classification, prioritisation.\n\nHow you communicate: Brief and decisive. States the decision first and the reasoning second, and says plainly when something does not need doing.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
51edfe1d-c393-48c1-8991-a1f21d352ebd	99e17ee9-1ecb-4194-8fdd-a8e7b9c634a3	1	You are Research Director, Research Director.\n\nResponsibilities: Gathers and weighs evidence, tracks source provenance, and reports what the sources actually support rather than what would be convenient. Owns the distinction between direct evidence and inference.\n\nExpertise: research, source evaluation, synthesis, provenance.\n\nHow you communicate: Cites as it goes. Distinguishes what a source says from what it implies, and names the gap when asked something the evidence cannot answer.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
fbf7f886-3052-4bec-a3b8-bfaa03c47a38	0265bfb7-6278-4b65-8b05-2ed599ec36d2	1	You are Strategy Director, Strategy Director.\n\nResponsibilities: Turns evidence into options with trade-offs, and states which option is recommended and why. Responsible for making the cost of each path explicit rather than presenting a single course as inevitable.\n\nExpertise: strategy, options analysis, trade-offs, planning.\n\nHow you communicate: Presents a recommendation, not a menu. Names the strongest argument against its own recommendation.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
dee8df68-a8b7-48de-8251-95ad1a4b87c8	75d6879e-5fe8-4efe-b936-e625fd101220	1	You are Growth & Marketing Director, Growth & Marketing Director.\n\nResponsibilities: Owns positioning, messaging, audience and demand. Judges whether a claim is defensible before it is persuasive, and flags anything that would need substantiating externally.\n\nExpertise: positioning, messaging, demand generation, audience.\n\nHow you communicate: Plain and concrete. Avoids superlatives it cannot substantiate.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
eec8df1b-d01a-4b1d-a341-0c0666ce2f4b	86cba079-51ee-4ac3-891d-5952ea6f87fc	1	You are Finance & Data Director, Finance & Data Director.\n\nResponsibilities: Owns numbers, unit economics and measurement. Distinguishes measured figures from modelled ones and refuses to present an estimate as an observation - the same discipline §11 applies to usage provenance.\n\nExpertise: finance, unit economics, metrics, data analysis.\n\nHow you communicate: Numerate and sceptical. Always says whether a figure is measured, calculated or estimated.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
8a5e05f3-5429-4bb4-96a2-a79e9621720e	eaac3cf7-752c-4547-809f-ce6519159a06	1	You are Operations Director, Operations Director.\n\nResponsibilities: Owns how work actually gets done: sequencing, dependencies, capacity and follow-through. Notices when a plan assumes capacity that does not exist.\n\nExpertise: operations, sequencing, capacity, process.\n\nHow you communicate: Practical and specific about who does what by when. Surfaces the constraint rather than the wish.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
68fe0094-d858-4edb-86b3-e9b5959ac5f7	f5779a09-79c2-4454-b5d8-1f416c4ba04a	1	You are Quality & Risk Director, Quality & Risk Director.\n\nResponsibilities: Reviews substantive output before it commits, per §10. Assigns confidence and evidence type, surfaces contradictions rather than averaging them away, and may reject. This role exists to be able to say no.\n\nExpertise: quality review, risk, contradiction detection, evidence grading.\n\nHow you communicate: Direct about problems and specific about which part is weak. Reserves approval rather than withholding an opinion.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
a9f5f70b-8b22-4c88-b39d-0d600297da2e	b1286651-1130-4576-b75f-28247b3e7b64	1	You are Communications & Creative Director, Communications & Creative Director.\n\nResponsibilities: Owns how things are said to people outside the team, and how they read. Responsible for clarity over polish and for never letting presentation outrun the confidence of the underlying finding.\n\nExpertise: writing, editing, narrative, presentation.\n\nHow you communicate: Edits for clarity first. Will not dress up a Low-confidence finding in High-confidence prose.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Version 1, assembled by migration 0024 from the identity fields seeded in 0019, so that staff.prompt_version points at real text rather than at nothing.	migration:0024	2026-09-22 14:26:46.309769+00
58247204-7886-4852-a309-028b5d7f3377	99e17ee9-1ecb-4194-8fdd-a8e7b9c634a3	3	You are Research Director, Research Director.\n\nResponsibilities: Gathers and weighs evidence, tracks source provenance, and reports what the sources actually support rather than what would be convenient. Owns the distinction between direct evidence and inference.\n\nExpertise: research, source evaluation, synthesis, provenance.\n\nHow you communicate: Cites as it goes. Distinguishes what a source says from what it implies, and names the gap when asked something the evidence cannot answer.\n\nAlways state whether a claim is verified, inferred or speculative, and say plainly when the evidence does not support an answer. Surface disagreement rather than resolving it quietly.	Restores the version-1 text after a verification script published a test prompt as version 2 and moved the pointer to it. Version 2 stays in the history because the history is append-only, which is the point of it.	migration:0025	2026-09-22 14:26:46.339166+00
\.


--
-- Data for Name: tool_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tool_permissions (tool, level, description, enabled, disabled_reason, verbs, delivered_by, in_reply) FROM stdin;
notion.write	2	Create and update Notion pages: a page in a database, blocks appended to a page, properties changed. No deletion — src/notion/write.ts contains no delete, so the worst a mistake can be is a page to archive.	t	\N	{"create pages in any shared data source","append and update blocks","set properties and relations","upload and attach files including audio and video","archive a page (reversibly)","read a database schema before writing to it"}	job kinds office.notion_import and office.notion_sync	t
github.read	0	Read a GitHub repository: metadata, branches, README and docs, the source tree, file contents, open issues and releases.	f	no route from a user request. src/github/api.ts is real and tested by verify:github, and its only importer is that suite - there is no handler, no job kind and no planner step, so nothing Grant can type reaches it. Wire a job kind and re-enable; until then saying otherwise is #64.	{"read repositories, branches, the README, the source tree, issues and releases"}	src/github/api.ts	f
gmail.draft	1	Create a Gmail draft	f	not implemented. src/google/mail.ts exports parseFrom and refreshMail and nothing else - there is no draft writer, and the description claimed one. gmail.send stays off by policy; this one is off because it does not exist.	{"write a draft into Gmail for Grant to review and send himself"}	src/google/mail.ts — draft only; gmail.send is disabled by policy	f
note.create	1	Write an internal note	f	no route from a user request. The notebook.push_document handler is registered and correct, and nothing enqueues it: the nine artefacts a planner can request are all NotebookLM generations. Closest of the three to being real - it needs a way to ask, not an implementation.	{"write an internal note nobody is paged about"}	job kind notebook.push_document	f
task.create	1	Create a task on the dashboard. It needs a TITLE and nothing else - the project comes from the conversation, a due date and an owner are optional, and there is no such thing as a parent task. Never ask for more than a title, and never say you have created one unless the office tells you it did.	t	\N	{"create a task on a dashboard project, with a date, an owner and a parent"}	app.hq_task_add	t
slack.post	2	Post into Slack. This happens AFTER your answer, through the channel adapter, and never while you are writing - so never say you have posted, messaged or notified anybody. Say what you will do, or hand the work over.	t	\N	{"post a message to a project channel or the office floor","messages carry the sender's own face and name"}	src/slack/api.ts, through the channel adapter	t
notebook.write	2	Add an approved note or source to Notebook	t	\N	{"add a link or a note as a source","push a document the office holds into a notebook","ask for a generated artifact and collect it when it is ready"}	job kinds notebook.add_source and notebook.generate	t
gmail.read	0	Read a Gmail message	t	\N	{"read a message, its thread and its attachments"}	job kind google.read_mail	t
gmail.send	3	Send email	f	§11: Gmail is draft-only by policy. The OAuth scope permitting it is not a reason to expose it; sending stays disabled until Grant explicitly enables it. Re-disabled by 0022 after a defective verification check enabled it - see that migration's header.	{"send an email as Grant"}		f
github.write	3	Create or change anything in a GitHub repository.	f	§13 puts destructive GitHub operations in the highest tier. There is no automated path to this in V1, and src/github/api.ts contains no method that writes — the absence is structural, not just a flag.	{"open a pull request, push a commit, change a file"}		f
db.delete	3	Delete application data	f	Destructive. Nothing in V1 needs it, and a capability that exists is a capability that can be reached.	{"delete application data"}		f
production.write	3	Modify production configuration or security	f	Requires explicit approval and has no automated path in V1.	{"change production configuration or a security boundary"}		f
spend.money	3	Any action that incurs cost	f	§11: paid inference is prevented by four layers; this is the same prohibition at the tool router.	{"anything that costs money"}		f
web.search	0	Search the web	f	Nothing implements this. The row claimed reach the office does not have, and every agent's capability sheet repeated the claim — so an agent asked to research something would say it would search the web and then not. It stays listed, disabled, because the office genuinely wants it: a listed gap can become a proposal (#49), a deleted one cannot. Re-enable it in the same change that implements it.	{"search the web and read what comes back"}		f
gmail.search	0	Search Gmail	t	\N	{"search the mailbox by sender, subject, date and text"}	job kind google.read_mail	t
notebook.read	0	Read notebooks, sources and cached fulltext	t	\N	{"read notebooks, their sources and the cached full text"}	job kinds notebook.ask and notebook.collect	t
db.read	0	Read the application database	t	\N	{"read any of the office's own records — projects, documents, tasks, jobs, outputs"}	the office — every handler reads its own database directly	t
preference.update	1	Update a notification preference	t	\N	{"change how loudly a kind of thing reaches him"}	hq-api, the preference actions	t
draft.create	1	Write a draft. Every answer you give is already a draft until it is reviewed - you do not need to do anything to invoke this.	t	\N	{"draft something for Grant to approve before it goes anywhere"}	public.outputs — every handler's result is a draft until reviewed	t
task.extract	1	Find the things that need doing inside a document the office has already read, and create them as tasks. Say which document - "the pricing brief" is enough, it is matched on the title - or say nothing and it reads what the project holds. It only reads material already IN the office: if it is in a notebook or a Drive folder nobody has brought in, say so first. It CREATES the tasks rather than listing them for approval, and offers one undo for the batch, so never promise a list to confirm.	t	\N	{"pull the tasks out of a document and create them on the project"}	office.extract_tasks	t
drive.ingest	1	Add a file that has appeared in a watched Drive folder to the project as a source document. Takes nothing: the folder is the project's own attachment and the file is whatever arrived. Internal — the document is a draft until it is approved, and nothing is sent anywhere.	t	\N	{"add an arrived Drive file to the project","take a new file in as a source"}	job kind drive.watch — src/handlers/drive.ts, when the policy says proceed	f
calendar.write	2	Mirror dated tasks into the diary as all-day events, on the hourly sync	t	\N	{"on the hourly sync, put a task that has a DATE into the diary as an all-day event","move that event when the date changes, and remove it when the task is done","only ever touch events the office created, matched on a stored tag","never in a reply, and never a timed event: the way into the diary is to give a task a date"}	job kind google.write_calendar_tasks	f
calendar.read	0	Cache the calendar, and read it in the morning briefing	t	\N	{"hold a cache of the diary, refreshed by a duty","read it in the morning briefing","not read it while answering: no lookup on that path exists, so a claim about the diary in a reply is invention"}	job kind google.read_calendar	f
\.


--
-- Data for Name: staff_tools; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.staff_tools (staff_slug, tool, granted_at, granted_by, note) FROM stdin;
chief-of-staff	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	db.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	notebook.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	web.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	gmail.search	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	gmail.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	calendar.read	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	task.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	note.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	preference.update	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	draft.create	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	gmail.draft	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	calendar.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	slack.post	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
strategy-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
growth-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
finance-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
operations-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
research-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
quality-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
communications-director	notebook.write	2026-09-22 14:26:48.717108+00	migration-0119	Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.
chief-of-staff	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
strategy-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
growth-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
finance-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
operations-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
research-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
quality-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
communications-director	github.read	2026-09-22 14:26:49.649641+00	migration 0157	Reading a public repository is the same class of act as reading the web, which everyone already has. Sight of a PRIVATE repository is not granted here — it depends entirely on what the vault token was scoped to, which is Grant's choice one repository at a time.
chief-of-staff	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
strategy-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
growth-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
finance-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
operations-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
research-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
quality-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
communications-director	notion.write	2026-09-22 14:26:49.803493+00	migration 0163	Writing project documentation and tasks into Notion is ordinary work for this team, and the same tier as writing to the notebook.
\.


--
-- Data for Name: system_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_config (key, value, description, self_adjustable, updated_at, updated_by) FROM stdin;
jobs.capacity	{"max_concurrent_jobs": 3, "max_consultations_per_job": 3, "max_direct_alerts_per_agent_per_day": 3, "max_investigations_per_project_per_day": 5}	V1 autonomy capacity limits (§17). Enforced at dequeue, not at enqueue.	f	2026-09-22 14:26:45.792235+00	fresh_alex_harness
jobs.lease_seconds	300	How long a dequeued job stays leased before the recovery sweep may reclaim it.	f	2026-09-22 14:26:45.792235+00	fresh_alex_harness
providers.breaker	{"cooldown_seconds": 60, "failure_threshold": 5, "max_cooldown_seconds": 3600}	Circuit-breaker thresholds. Cooldown backs off exponentially to the maximum.	f	2026-09-22 14:26:45.792235+00	fresh_alex_harness
jobs.urgent_priority_max	20	A job with priority <= this is urgent: if inference is unavailable it raises a blocker instead of queueing quietly. Lower priority number = more urgent, matching the dequeue order.	f	2026-09-22 14:26:45.952425+00	fresh_alex_harness
notebook.sync_interval_minutes	10	How often the discovery/sync cycle runs. Self-adjustable so the system may back off when Notebook is degraded.	t	2026-09-22 14:26:46.091114+00	fresh_alex_harness
notebook.sync_lease_minutes	15	How long a sync run may hold its lease before app.recover_stalled_syncs treats the worker as dead. Longer than the interval on purpose: a slow run must not be declared crashed by the next tick.	f	2026-09-22 14:26:46.091114+00	fresh_alex_harness
agents.max_specialists_per_job	3	§9 V1 default: the smallest justified specialist set. Not self-adjustable - a cost governor that can raise its own ceiling is not a governor.	f	2026-09-22 14:26:46.158556+00	fresh_alex_harness
agents.max_investigations_per_project_per_day	5	§9 V1 default. Not self-adjustable, for the same reason.	f	2026-09-22 14:26:46.158556+00	fresh_alex_harness
agents.max_simultaneous_jobs	3	§9 V1 default.	f	2026-09-22 14:26:46.158556+00	fresh_alex_harness
agents.max_delegation_depth	3	§9: how many levels of delegation are permitted below a top-level job. Not self-adjustable - a delegation cap an agent can raise is not a cap.	f	2026-09-22 14:26:46.219994+00	fresh_alex_harness
agents.max_live_specialists	3	§9: how many temporary specialists may be active at once. Not self-adjustable - a roster cap an agent can raise is not a cap.	f	2026-09-22 14:26:46.309769+00	fresh_alex_harness
ui.needs_me_cap	7	§12: how many items Needs Me may show before it reports suppression instead of growing. Not self-adjustable - raising it is how the list stops being read.	f	2026-09-22 14:26:46.390868+00	fresh_alex_harness
grant.timezone	"Europe/Athens"	IANA timezone for anything that has to decide which DAY something belongs to - briefings above all. An IANA name rather than an offset because Greece observes DST.	f	2026-09-22 14:26:46.841125+00	fresh_alex_harness
notebook.disabled_reason	"awaiting_adr_0012_decision"	Why the Notebook integration is off. Was google_account_disabled_2026_09_04; the account was reinstated 2026-09-05 and the reason is now the open architectural decision rather than a dead credential.	f	2026-09-22 14:26:46.979205+00	fresh_alex_harness
notebook.enabled	true	NotebookLM adapter. Re-enabled 2026-09-06 at Grant's instruction, with the credential verified the same day (3 notebooks, available_unofficial). ADR-0013 is unchanged: this is a route in, not the store.	f	2026-09-22 14:26:47.280081+00	fresh_alex_harness
calendar.enabled	false	Whether Google Calendar is in service. False until a credential exists.	f	2026-09-22 14:26:47.689292+00	fresh_alex_harness
notebook.window_hours	5	Google refreshes the allowance every five hours. Their number, not ours.	f	2026-09-22 14:26:47.714791+00	fresh_alex_harness
notebook.window_units	40	How many of our estimated units to spend in one five-hour window. A guess until a refusal measures it, and then it is whatever the refusal proved.	f	2026-09-22 14:26:47.714791+00	fresh_alex_harness
notebook.week_units	300	The weekly ceiling, same currency, same caveat.	f	2026-09-22 14:26:47.714791+00	fresh_alex_harness
notebook.ceiling_is_measured	false	True once a refusal has taught us the real number. False means the ceiling above is still a guess and should be read as one.	f	2026-09-22 14:26:47.714791+00	fresh_alex_harness
conversation.max_turns	12	How many turns to carry. Enough to hold a real exchange; not so many that a long prompt buries the message actually being answered.	f	2026-09-22 14:26:47.979086+00	fresh_alex_harness
db.region	"eu-west-2"	Where that project is hosted. Recorded for the page; not enforced.	f	2026-09-22 14:26:48.660761+00	fresh_alex_harness
calendar.calendar_id	"primary"	Which calendar to read and write. "primary" is the account's own.	f	2026-09-22 14:26:48.660761+00	fresh_alex_harness
conversation.window_minutes	1440	How far back a handler looks for the turns before this one. A window, not a session: a chat has no "conversation ended" event, so anything claiming to know where one stopped would be guessing.	f	2026-09-22 14:26:54.920952+00	fresh_alex_harness
staff.avatar_base_url	""	Public HTTPS base under which staff.avatar_ref paths are served. Slack icon_url needs a reachable image; without this the presentation degrades to a per-role emoji and says so. [blank on a fresh install — supply your own]	f	2026-09-22 14:27:00.152681+00	fresh_alex_harness
slack.subject_user_id	""	Slack user id for Grant. Invited to every channel the app provisions, because a channel the human is not in is a channel that receives results nobody reads. Not a secret: a user id is public within the workspace. [blank on a fresh install — supply your own]	f	2026-09-22 14:27:00.152681+00	fresh_alex_harness
google.client_id	""	The OAuth client id from Google Cloud. Public by design — it appears in every authorization URL — so it lives here rather than in the vault.	f	2026-09-22 14:26:48.098663+00	fresh_alex_harness
google.scopes	"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly"	What to ask for. Calendar only: §17 keeps each integration separately disableable, and a token that can also read Gmail is a token whose blast radius is not what the page says it is.	f	2026-09-22 14:26:48.098663+00	fresh_alex_harness
knowledge.read_new_sources	true	Whether a source arriving in an established project starts a research job. Off makes the corpus passive again: documents are stored and nothing acts on them.	f	2026-09-22 14:26:48.405365+00	fresh_alex_harness
knowledge.new_source_jobs_per_hour	6	Ceiling on research jobs started by arriving sources, across all projects. A bulk paste into an established project looks exactly like news, and this is what makes that survivable.	f	2026-09-22 14:26:48.405365+00	fresh_alex_harness
knowledge.new_source_min_chars	600	Below this a document is not worth convening anyone over.	f	2026-09-22 14:26:48.405365+00	fresh_alex_harness
telegram.bot_limit	20	Bots one Telegram account may own: 20 normally, 40 with Premium. Telegram's figure, not ours — bots_create_limit_default. Recorded so the system refuses a creation it cannot make, rather than discovering the ceiling as a confusing error on the twenty-first.	f	2026-09-22 14:26:48.855761+00	fresh_alex_harness
github.repository	"granterogers/agentic.team.grant"	owner/repo that repository_dispatch wakes when a voice note needs a worker that can run faster-whisper.	f	2026-09-22 14:26:48.905696+00	fresh_alex_harness
gmail.enabled	false	Whether the team reads mail at all. Off until Grant connects Gmail and turns it on — a connected account is permission, not instruction.	f	2026-09-22 14:26:48.926479+00	fresh_alex_harness
worker.paused_until	""	RFC3339 time until which no pass may run, or empty. Set by verification suites so they can measure the queue without the heartbeat moving it, and readable on the front end so a pause is never invisible. Lapses on its own: a suite that dies must not stop the office permanently.	f	2026-09-22 14:26:48.980796+00	fresh_alex_harness
voice.transcription	"none"	How a voice note becomes words. "none" = we cannot, and the bot says so on arrival rather than queueing a job nothing can do. "runner" = a GitHub Actions run per note, which is what Grant asked to stop. "api" = a third-party speech service, which would send his voice off our own compute and is his decision to make, not mine (ADR-0009).	f	2026-09-22 14:26:49.07281+00	fresh_alex_harness
voice.api_base_url	"https://api.groq.com/openai/v1"	OpenAI-shaped speech endpoint. Groq by default: fastest of the compatible ones and free at this volume. Any provider speaking the same shape works.	f	2026-09-22 14:26:49.11578+00	fresh_alex_harness
voice.api_model	"whisper-large-v3-turbo"	The transcription model. Considerably better than the base.en that ran locally, which is what turned "NotebookLM" into "Not-to-But".	f	2026-09-22 14:26:49.11578+00	fresh_alex_harness
telegram.direct_to_grant	"chief-of-staff"	The one staff slug whose bot may write to Grant's private chat. Everyone else goes to the office group when one exists. The pager bot (staff_slug null) is always direct — it is the Chief of Staff's own bot and the interrupting voice §12 gives Telegram. Set to an empty string to let everybody message him directly again.	f	2026-09-22 14:26:49.136189+00	fresh_alex_harness
notebook.reader_url	"https://ai-team-hq.vercel.app/api/notebook"	The HTTPS endpoint that reads Gemini Notebook without a subprocess. Deployed by `npm run deploy:hq` alongside the page, because a Vercel deployment is an atomic file list and deploying one without the other would delete the other.	f	2026-09-22 14:26:49.187962+00	fresh_alex_harness
notebook.writer_url	"https://ai-team-hq.vercel.app/api/notebook-act"	The HTTPS endpoint that performs notebook write actions without a local subprocess. When this and notebook.reader_secret are both set, every runtime uses it — including the ones that COULD spawn Python. One transport everywhere is one transport that gets exercised; a fallback that only runs on a developer machine is a fallback nobody finds out is broken.	f	2026-09-22 14:26:49.234827+00	fresh_alex_harness
backup.bucket	"backups"	The private Storage bucket the nightly copy goes into. Asserted private before every upload: the avatars bucket beside it is public, and one wrong flag would put every row in the database at a guessable URL.	f	2026-09-22 14:26:49.257656+00	fresh_alex_harness
telegram.pager_floor	"important"	How loud something must be before it reaches Telegram rather than just Slack. One of trivial, routine, important, urgent, blocker. §12 gives Telegram one interrupting voice; this is where the bar is set.	f	2026-09-22 14:26:49.495341+00	fresh_alex_harness
voice.writing_model	""	The model that writes what Grant reads — the morning note, and anything a staff member says to him. Empty means the ordinary free failover order, which varies a sentence adequately and writes a good one about half the time. Naming a paid model here changes only the writing path.	f	2026-09-22 14:26:49.524951+00	fresh_alex_harness
github.owner	"granterogers"	The GitHub account whose repositories the team can be asked about, so "my Rest Timer repo" resolves without a URL. Distinct from `github.repository`, which is where this system's own code lives.	f	2026-09-22 14:26:49.649641+00	fresh_alex_harness
vault.naming	"<service>.<purpose>_token — and a credential is never assumed absent"	Every vault secret is named <service>.<purpose>, so `app.vault_inventory()` can group them. The rule that matters: before saying a credential does not exist, ENUMERATE — do not test one guessed name. github.dispatch_token sat in the vault while the GitHub client asked for github.token and reported nothing there (0159).	f	2026-09-22 14:26:49.70497+00	fresh_alex_harness
notion.hierarchy	"Agentic project = Notion Teamspace; Notion Project = an initiative inside it"	Agentic Team → top-level project → Notion Teamspace → Notion Projects → tasks, pages, research, docs. A Notion "Project" is an initiative or workstream WITHIN a teamspace (Money Mastery → Plugin Architecture, Mobile UX Redesign), not a peer of an Agentic project. Supabase stays the canonical registry; Notion is mapped onto it, never the other way round.	f	2026-09-22 14:26:49.750995+00	fresh_alex_harness
google.redirect_uri	""	Where Google sends him back. Must be listed verbatim in the Cloud console's Authorised redirect URIs, or the consent screen refuses before he sees it. [blank on a fresh install — supply your own]	f	2026-09-22 14:27:00.152681+00	fresh_alex_harness
notion.agents_are_not_scoped_to_a_teamspace	true	Agents work across teamspaces. The teamspace an agent is currently operating in does not define its identity, role or permanent scope — a developer contributes to Money Mastery, Wellness and AI Team HQ as required. Recorded as a setting so a future staff.teamspace column meets an argument rather than an empty field (0161).	f	2026-09-22 14:26:49.750995+00	fresh_alex_harness
telegram.only_chief_speaks	true	When true, only the Chief of Staff sends Telegram messages. Everyone else still does the work and still writes their output — the dashboard shows it all — they just do not send. Distinct from telegram.direct_to_grant, which decides WHICH CHAT someone lands in: that one routes the rest into the office group, and Grant is in the office group, so it never made them quiet (0165).	f	2026-09-22 14:26:49.865013+00	fresh_alex_harness
jobs.self_improvement_tokens_per_day	200000	Tokens the office may spend in 24 hours on working on ITSELF — noticing, reflecting, proposing. Enforced at dequeue: the kinds in self_improvement_kinds wait until the rolling window moves. Work for Grant is never counted or blocked (#53).	f	2026-09-22 14:26:51.362172+00	fresh_alex_harness
calendar.sync_tasks	false	Whether dated, open tasks are written into Google Calendar as all-day events (ADR-0020). Off by default. One way only: the diary never changes a task.	f	2026-09-22 14:26:51.982775+00	fresh_alex_harness
routing.unnamed_when_unresolved	true	When nothing names a project — a general Telegram chat, a voice call — file the message under the reserved Unnamed project (true, ADR-0024) rather than guessing at the most recently updated one (false).	f	2026-09-22 14:26:54.260334+00	fresh_alex_harness
delivery.max_attempts	5	Issue #202. How many times a failing send is retried before it is marked undelivered and shown to Grant. Five attempts with the backoff below is about half an hour of trying.	f	2026-09-22 14:26:54.358765+00	fresh_alex_harness
delivery.backoff_seconds	30	Issue #202. The first retry delay. It doubles each attempt up to the ceiling below, so 30 gives 30s, 1m, 2m, 4m.	f	2026-09-22 14:26:54.358765+00	fresh_alex_harness
delivery.backoff_ceiling_seconds	900	Issue #202. The longest a retry ever waits. Fifteen minutes: long enough that a provider outage is not hammered, short enough that recovery is noticed within one cycle.	f	2026-09-22 14:26:54.358765+00	fresh_alex_harness
budget.pence_per_agent_per_day	60	How many pence one agent may spend in a day before its queued work waits for tomorrow. Free-model work costs nothing and never counts.	f	2026-09-22 14:26:55.28627+00	fresh_alex_harness
budget.pence_for_the_office_per_day	200	How many pence the whole office may spend in a day. Binds above the per-agent limit, because eight agents at their own limit is eight times the ceiling anybody intended.	f	2026-09-22 14:26:55.28627+00	fresh_alex_harness
ci.monthly_minutes	1500	The office refuses to dispatch a workflow past this many GitHub Actions minutes in a calendar month. GitHub gives 2,000 free on a private repository; the margin is deliberate, because the 2026-09 incident was nobody counting rather than a small overshoot.	f	2026-09-22 14:26:56.776872+00	fresh_alex_harness
web.base_url	"https://ai-team-hq.vercel.app"	Where Team HQ is served. Used by google-oauth to send a person back into the app after consent, because Supabase will not serve HTML from the shared functions domain (0486).	f	2026-09-22 14:26:58.075974+00	fresh_alex_harness
db.project_ref	""	The Supabase project the tooling connects to. Declared, not live: changing it tells the next run where to look and moves nothing. [blank on a fresh install — supply your own]	f	2026-09-22 14:27:00.152681+00	fresh_alex_harness
\.


--
-- PostgreSQL database dump complete
--

\unrestrict ss7DuerlsW2gjKfQsHUCJX1gTQC44ULlrXEEnK9wSMESxMqB7UKIEg60CPbkmpe

