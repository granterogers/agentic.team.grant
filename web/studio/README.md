# Team HQ: the web app

The browser app. It is plain HTML, CSS and JavaScript with **no build step**: the files here are served as they are, which makes every change visible on reload.

## Where things are

| Path | What it is |
|---|---|
| `index.html` | The one page. It loads the stylesheets and modules in order |
| `bc/` | Team HQ itself: the project page, the board, the chat panel, My Tasks, Activity and search |
| `bc/shell.js` | The page frame: which view is showing and the navigation around it |
| `bc/stage.js` | The arrangement board: modules, Tidy, Layouts, Fit and the Card Table |
| `bc/layout.js` | The layout model: where each module sits, and how presets and saved layouts are stored |
| `chat.js` | The chat thread store: keeps each conversation and follows a job until its answer arrives |
| `prose.js` | Turns the team's replies into readable text: lists, emphasis and line breaks |
| `settings.js` | The Settings pages, their groups and their addresses (for example `/settings/google`) |
| `settings-ui.js` | Drawing for Settings: cards, rows, buttons and status chips |
| `app.js` | The earlier studio, still carrying the Settings and Services screens |
| `sw.js` | The service worker that keeps the app working when the connection drops |
| `tokens.css`, `studio.css`, `bc/*.css` | Colour, type and layout. Colours are tokens, not hard-coded values |

## Rules this folder follows

- **Everything is visible in a real browser.** A change is not done because it compiles. It is done when it has been rendered at desktop and phone widths and looked at.
- **Every control has a name and a handler.** `npm run verify:wired` fails if a button is bare or points nowhere.
- **Text is at least 12 px, and touch targets are at least 44 px.** `npm run verify:ui` enforces both at three device sizes.
- **Light and dark themes are both designed.** A colour that only works in one is a defect.
- **Words are plain.** Internal names (the old product name among them) never reach a person; `npm run check:branding` checks it.

## Try it

Serve this folder with any static server, for example:

```bash
python3 -m http.server --directory web/studio 8080
```

Signing in and the data need a Supabase project; see [`../../docs/new-environment.md`](../../docs/new-environment.md).

## Screens checked by the test suite

- Project page, desktop and phone: `npm run verify:ui`
- Controls and their handlers: `npm run verify:wired`
- Arrangement and layouts: `npm run verify:layouts` and `npm run verify:arrangement`
- Screenshots for the README: `scripts/sample/readme-shots.ts`
