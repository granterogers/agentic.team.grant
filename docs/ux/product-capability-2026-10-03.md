# Product capability and deep UX, 3 October 2026 (#408, #409, #411)

Everything here was driven as the Sample Person through the real page, gateway, worker and model. Commands: `npm run sample:intelligence`,
`sample:product`, `sample:activity`, `sample:chat-status`, `sample:chat`, `sample:tour`.

## #408: why the team could not see a project's tasks or documents
1. **Uploaded files were never read.** `document_upload` stored bytes and left `documents.content` null; all 22 Sample documents had no
   searchable text. Fixed at the gateway (`app.index_file_text`, 0868/0870): text types are indexed at upload.
2. **A project's tasks were read by nothing.** Only the personal list was. `app.project_work_brief` (0869) + `src/agents/project-work.ts`: the
   turn's own project and any the question names, never the rest, office-checked, with counts. Declared complete when every task is listed
   so "the only overdue task" is not refused.
3. **The coverage note denied the documents it sat beside** (upload has no connector). 0873.
4. **A file you drop in was a hidden draft.** 0872: yours = approved.
5. **A request addressed to the answering specialist reached her as an introduction** ("which finance specialist?"). `src/agents/own-task.ts`.
6. **Team Chat never showed the answer.** The dock never read the office record and nothing followed the job. `turn_status` (0874) +
   `chat.follow`: states from real jobs (waiting its turn / who is working / waiting on / needs you / failed), answer lands in the thread.
7. **The dock files under the project it was opened on**, so "this project" meant another. A one-press "Ask about X instead" (the pin stays).

## Benchmark (`sample:intelligence`, 14 cases, three projects)
RETRIEVAL (what the model was shown, deterministic, the gate): every case passes on the final code, including negatives: other offices'
titles harvested as canaries appear in no prompt or answer; a foreign project/job/document id answers exactly as a missing one;
a Wellness question carries no Finance or Japan material. ANSWER (free model, stochastic, not gated): about 11 of 13 per run; misses seen were
the model ignoring a block it was given, and once leaked reasoning text as the answer. Real-worker, real-page proof: overdue travel task
answered; an uploaded note's unique word found and answered; answer delivered into the chat with no reload.

## #409 Recent activity
Derived in `app.studio_activity` (0871) from tasks, documents, contacts and specialists' outputs; bursts fold into one line with a count; the
person is "You"; plumbing excluded. Global Activity page now newest-first across projects. `sample:activity` (14 checks).

## Ordinary CRUD
Contacts add/edit/save/search/remove (put away, reversible), project rename (new Name block in Project settings), lessons are written by
teaching in chat (no add control exists by design; retract exists). `sample:product` (13 steps).

## Not claimed
Voice note and Talk to Team audio, realtime voice, Slack/Telegram (#410), Google. Specialist delegation through the chief of staff
("ask the finance director...") did not convene anyone in-process and is only partly proven: a specialist addressed directly is proven.
Studio read from the sandbox takes 1.8 to 3.5 s.
