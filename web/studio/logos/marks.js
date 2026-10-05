/*
  Service marks.

  Grant: *"I want to see it, you know, like the proper logos of the companies.
  So like I don't want to see some crappy, you know, AI slop website."*

  He is right that a settings page listing services as coloured initials is the
  single clearest tell of a generated interface. But downloading eight official
  brand kits produces its own version of the problem, for three reasons worth
  writing down:

    1. Each vendor draws on a different grid at a different optical weight. A
       row of eight official SVGs reads as eight logos, not as one list.
    2. Brand guidelines license the mark for identification and then restrict
       colour and modification — which a greyed-out "disconnected" state
       breaks.
    3. Remote assets do not load in the capture sandbox, so every screenshot
       would be judged with them missing. The fonts were self-hosted for
       exactly this reason.

  So these are redrawn on a common 24×24 grid at a common weight, in
  `currentColor`, so a row of them looks like a row and a disabled one can go
  grey without breaching anything. They identify the service nominatively.
  See LICENCE.txt.

  `tint` is the brand's own hue, used for the connected state's halo only —
  enough that Slack's row feels like Slack's, without repainting the mark.
*/

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
        fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const MARKS = {
  notion: {
    name: 'Notion',
    tint: '#8b8b88',
    svg: svg(`<rect x="3.5" y="3.5" width="17" height="17" rx="2.4"/>
              <path d="M8.4 16.2V8.1l7.2 8.1V8.1" stroke-width="1.9"/>`),
  },
  drive: {
    name: 'Google Drive',
    tint: '#1a9b5c',
    svg: svg(`<path d="M9.6 3.4h4.8l6.1 10.6H15.7z"/>
              <path d="M3.5 14 6 9.6l4.8 8.4H5.9z"/>
              <path d="M8.3 18h12.2l-2.4 2.6H6.6z"/>`),
  },
  calendar: {
    name: 'Google Calendar',
    tint: '#4a7fd4',
    svg: svg(`<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/>
              <path d="M3.5 9.6h17M8 3.4v3.2M16 3.4v3.2"/>
              <path d="M9.2 17.2h1.1c1 0 1.7-.5 1.7-1.4 0-.8-.6-1.3-1.5-1.3M14 13.6l1.2-.8v4.4" stroke-width="1.5"/>`),
  },
  gmail: {
    name: 'Gmail',
    tint: '#d9594c',
    svg: svg(`<rect x="3.5" y="5.5" width="17" height="13" rx="2.4"/>
              <path d="M4 7.4l8 6.2 8-6.2"/>`),
  },
  notebooklm: {
    name: 'NotebookLM',
    tint: '#4a7fd4',
    svg: svg(`<path d="M5 4.6h9.6a3 3 0 013 3v12H8a3 3 0 01-3-3z"/>
              <path d="M5 16.6h12.6" /><path d="M9 8.4h5.2M9 11.6h5.2"/>`),
  },
  slack: {
    name: 'Slack',
    tint: '#c0446a',
    svg: svg(`<rect x="9.6" y="2.8" width="4.8" height="10.4" rx="2.4"/>
              <rect x="2.8" y="9.6" width="10.4" height="4.8" rx="2.4"/>
              <rect x="9.6" y="10.8" width="4.8" height="10.4" rx="2.4"/>
              <rect x="10.8" y="9.6" width="10.4" height="4.8" rx="2.4"/>`),
  },
  telegram: {
    name: 'Telegram',
    tint: '#3a8fc7',
    svg: svg(`<path d="M21 4.6 2.9 11.4l4.9 1.6L20 5.6 9.6 14.4l-.3 4.9 3-3.3 4.6 3.4z"/>`),
  },
  github: {
    name: 'GitHub',
    tint: '#6e6e73',
    svg: svg(`<path d="M9.3 20.4v-2.7c-3 .6-3.8-1.3-3.8-1.3-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-5-1.2-5-5.4 0-1.2.4-2.2 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1a10 10 0 015.4 0c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9a4.2 4.2 0 011.1 2.9c0 4.2-2.6 5.1-5 5.4.4.4.8 1.1.8 2.2v3.5"/>`),
  },
  openrouter: {
    name: 'OpenRouter',
    tint: '#7d6ad0',
    svg: svg(`<circle cx="12" cy="12" r="3"/>
              <path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>
              <circle cx="12" cy="3" r="1.4"/><circle cx="12" cy="21" r="1.4"/>
              <circle cx="3" cy="12" r="1.4"/><circle cx="21" cy="12" r="1.4"/>`),
  },
  supabase: {
    name: 'Supabase',
    tint: '#2fa06a',
    svg: svg(`<path d="M13 2.6 4.4 13.1a.8.8 0 00.6 1.3h6.2v7l8.6-10.5a.8.8 0 00-.6-1.3H13z"/>`),
  },
  zoom: {
    name: 'Zoom',
    tint: '#3a7fd4',
    svg: svg(`<rect x="2.8" y="6.6" width="12.4" height="10.8" rx="2.6"/>
              <path d="M15.2 10.6l6-3.2v9.2l-6-3.2z"/>`),
  },

  /*
    ------------------------------------------- capabilities, not companies --

    The three below are not services and must never look like one. A signed-in
    browser, an MCP client and a direct upload are things this office DOES;
    there is no vendor, no trademark and nothing to identify nominatively — and
    the header above is emphatic that inventing a provider logo is the failure
    this file exists to avoid.

    They get a glyph anyway, because the alternative measured worse. The live
    Connections page draws seven cards and four of them are companies with
    marks, so these three rendered as empty space beside a 22px logo: a row
    that alternates mark, mark, nothing, mark, nothing reads as three cards
    that failed to load rather than three of a different kind.

    So: plainly generic shapes — a window, a plug, an arrow into a tray —
    deliberately unlike any mark above, and NO tint. The tint is the brand's
    own hue and is used for the connected halo; giving a capability one would
    be the first step towards it looking like a company.
  */
  browser: {
    name: 'Signed-in browser',
    tint: 'currentColor',
    svg: svg(`<rect x="2.8" y="4.4" width="18.4" height="15.2" rx="2.4"/>
              <path d="M2.8 9.2h18.4"/>
              <circle cx="6.2" cy="6.8" r=".9"/><circle cx="9" cy="6.8" r=".9"/>`),
  },
  mcp: {
    name: 'MCP client',
    tint: 'currentColor',
    svg: svg(`<path d="M9 3.4v5.2M15 3.4v5.2"/>
              <rect x="6.4" y="8.6" width="11.2" height="6.2" rx="2"/>
              <path d="M12 14.8v5.8"/>`),
  },
  upload: {
    name: 'Direct upload',
    tint: 'currentColor',
    svg: svg(`<path d="M12 15.4V4.2"/><path d="M7.8 8.4 12 4.2l4.2 4.2"/>
              <path d="M4.2 15.6v2.6a1.8 1.8 0 001.8 1.8h12a1.8 1.8 0 001.8-1.8v-2.6"/>`),
  },
  /*
    The two ways of reaching the team that are Team HQ's own rather than a company's: talking (a microphone) and mail
    (an envelope). Generic shapes and no tint, for the reason above. Without them the Messaging rows drew an empty box
    where the mark goes whenever the payload named them voice and mail.
  */
  voice: {
    name: 'Voice',
    tint: 'currentColor',
    svg: svg(`<rect x="9" y="3.2" width="6" height="11" rx="3"/>
              <path d="M5.6 11.4a6.4 6.4 0 0012.8 0M12 17.8v3"/>`),
  },
  mail: {
    name: 'Email',
    tint: 'currentColor',
    svg: svg(`<rect x="3" y="5.4" width="18" height="13.2" rx="2.2"/><path d="m3.6 7.4 8.4 6 8.4-6"/>`),
  },
}

export const mark = (key) => MARKS[key] ?? { name: key, tint: 'currentColor', svg: '' }
