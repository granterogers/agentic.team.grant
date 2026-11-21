# Cowork stress test: brief (21 November 2026)

Live office, version 0.81.0. Start at **https://ai-team-hq.vercel.app/** and sign in as the owner.

## Ground rules

- This is your **live office**. Do not delete anything that is not in this brief.
- Anything labelled "check", "probe", "acceptance" or "reload check" is test traffic. Ignore it when judging answers.
- Send **only the messages this brief names**. Each one starts work that costs model calls.
- Do not press "Connect Slack". Do not change Settings beyond what a step names.
- Report with red, orange or green, the screen, the address (URL), and what you pressed.

## How to get anywhere

- The address bar cannot open Settings. Start at https://ai-team-hq.vercel.app/, press **Open the project menu** in the top bar, then **Global Settings**.
- In Settings: **Services** lists Google and the tools. **Messaging** lists Slack and Telegram.

## Steps

1. **Google.** Settings › Services. The Google row should say **Reconnect Google** until the owner has done it. Record exactly what the row says. Do not press Reconnect; the owner does that step.
2. **Slack.** Settings › Messaging. Record whether Slack says *Connected*. Then post one message in **#qa_test_project**: "Slack check, [time]". Record whether the team replies in Team HQ within two minutes.
3. **Acknowledgement after a reload.** Open **Legacy Coaching Course** (https://ai-team-hq.vercel.app/p/legacy-coaching-course/chat). Send: "Acknowledgement check, [time]: please write a long answer, about five paragraphs, on how a team handles a Monday backlog." Within one second, reload the page. Record whether the note "I have put that to the team. Nobody has picked it up yet…" shows before the reload, and whether it shows after. Wait for the answer; record how long it took.
4. **Sticky note.** Open any canvas (for example the Legacy Coaching Course project page). Add a sticky note from the plus menu. Record whether its "Note" label is readable at the top edge, on a desktop and on a phone-width window.
5. **Configure.** Find the Configure button. Record which screen it is on, and whether pressing it sends you to the home address (`/`) instead of staying on the project.
6. **Stale heading.** While you work, note any heading that looks out of date. Record the screen, the heading, and what you pressed just before you saw it.
7. **Delete for good, on throwaway projects only.** Create a new empty project. Open its settings, then **Name, export and archive**, then **Delete for good**. Record that only one confirmation appears. Create a second project, add a to-do, then try the same. Record that it asks you to type the project's exact name, and that the button stays off until the name matches. Delete both. Do not delete any project you did not create in this session.
8. **Edge freeze.** In Microsoft Edge, open https://ai-team-hq.vercel.app/ and drag three modules around on a canvas, then refresh. Record whether the layout comes back, whether anything freezes, and the Edge version (Settings › About).
9. **Speed.** Note how long the first module takes to show on the Legacy Coaching Course page, and on the home page. Record the seconds. Do not optimise anything.
10. **Overall.** Give a single verdict for each area above, and list anything you could not finish.

## Known, and not to be reported as new

- Activity feed takes about 3 seconds.
- The project page takes 2 to 3 seconds to show its first module.
- Fit shrinks whole boards on phones, so text is small there.
- Messages labelled as checks sit in the Legacy and Conversations threads.
- Google needs the owner's reconnect before the test starts.
