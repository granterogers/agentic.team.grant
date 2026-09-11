# Instructing the office directly — Grant, 11 September 2026

**Verbatim.** Captured before any work was done with it. Not condensed.

---

> That being said, this is the kind of thing that I would want to be able to just
> send a voice note to the chief of staff on Telegram, and they would follow
> these instructions. I don't wanna have to do this via Claude. You know? The
> whole idea is that eventually move away from Claude such that all behaviors,
> skills, you know, what I want them to do, it can all just be told to them
> directly via Telegram or Slack.
>
> Another thing we'd like, for example, I said to them, okay. Create a new Google
> notebook. Call it learning my AI team. Upload to that notebook the complete
> documentation associated with my agentic team GitHub. So you can include, you
> know, relevant source code, documentation, original prompts, everything. And
> then I want you to instruct notebook to create an audio overview long one on
> the theme of setting this up, what to do, and how to make the best use out of
> it.
>
> And as always, every time you feel like I'm requesting a new feature, then that
> should be added to the list of GitHub issues for this repo, so nothing is lost
> over time.

---

## The two things in this

They are different sizes and must not be conflated.

**1. The standing requirement.** The office should be instructable by voice note
on Telegram — not only tasks, but *behaviours, skills, what I want them to do*.
This is the same goal already recorded in `CLAUDE.md`, stated more concretely:

> *"I want to reduce my dependence on Claude or another coding interface for
> maintaining and extending the system."*

The new part is the **channel and the modality**: a voice note, to the chief of
staff, on Telegram or Slack. And the new part of the *scope* is that it covers
configuration and capability, not just work — "all behaviors, skills".

**2. The worked example**, which is also a real job he wants done:

- create a Google notebook called *learning my AI team*
- upload the complete documentation of the agentic-team GitHub to it —
  *"relevant source code, documentation, original prompts, everything"*
- instruct the notebook to produce a **long audio overview** on the theme of
  setting this up, what to do, and how to make the best use of it

He gave it as an illustration of the kind of instruction he wants to be able to
speak. It is worth treating as both: build it, and note what about it could not
have been reached from a voice note.

## The standing rule, restated by him again

> *"every time you feel like I'm requesting a new feature, then that should be
> added to the list of GitHub issues for this repo, so nothing is lost over
> time."*

Third time. Already in `CLAUDE.md`; it stays there.

## What is actually in the way — checked, not assumed

I first wrote here that voice notes cannot be transcribed, citing ADR-0009 and
migration 0133. **That was out of date and I checked before acting on it.**

`system_config` today:

    voice.transcription   "api"
    voice.api_base_url    "https://api.groq.com/openai/v1"
    voice.api_model       "whisper-large-v3-turbo"

So a voice note CAN become text. The decision 0133 left open has since been
made. Whether it works end to end is a separate question from whether it is
configured, and is checked rather than assumed.

The real obstacle is the other half. `notebook_capability` reports:

    state         available_unofficial
    adapter       notebooklm-py
    capabilities  list_notebooks, account_limits, list_sources

**Read-only.** There is no `create_notebook`, no source upload, and no audio
overview in that list. So of his worked example —

1. create a notebook called *learning my AI team*
2. upload the repository's documentation to it
3. tell the notebook to make a long audio overview

— the office can currently do **none** of the three, and can only see what
already exists. That is the finding, and it is more useful than a partial
attempt: the gap is capability, not instruction-following.

Which is exactly the shape of #46's argument. The office can be told the thing;
it cannot yet do the thing; and the route from one to the other is #50.
