/*
  Service marks.

  Grant: *"I want to see it, you know, like the proper logos of the companies.
  So like I don't want to see some crappy, you know, AI slop website."*

  Most of these are the companies' own marks, taken from Simple Icons (version
  16.35.0, CC0 for the artwork; each trademark still belongs to its company and
  is used only to identify that service). Each one is a single filled path on
  the same 24×24 grid, drawn in `currentColor`, so a row of them reads as one
  list and a disconnected service can go grey without repainting the mark.

  Simple Icons has no Slack mark any more, so Slack keeps the drawn mark below
  until its official artwork is taken from Slack's brand page. The three
  capabilities at the bottom are not companies and keep their generic glyphs.
  See LICENCE.txt.

  `tint` is the brand's own hue, used for the connected state's halo only. A
  mark whose brand colour is black gets a neutral tint instead.
*/

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
        fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

// An official mark: one filled path, as Simple Icons publishes it.
const brand = (d) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="${d}"/></svg>`

export const MARKS = {
  notion: {
    name: 'Notion',
    tint: '#8b8b88',
    svg: brand('M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z'),
  },
  drive: {
    name: 'Google Drive',
    tint: '#1a9b5c',
    svg: brand('M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z'),
  },
  calendar: {
    name: 'Google Calendar',
    tint: '#4a7fd4',
    svg: brand('M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z'),
  },
  gmail: {
    name: 'Gmail',
    tint: '#d9594c',
    svg: brand('M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z'),
  },
  notebooklm: {
    name: 'NotebookLM',
    tint: '#4a7fd4',
    svg: brand('M11.999 3.201C5.372 3.201 0 8.528 0 15.101V20.8h2.212v-.568c0-2.666 2.178-4.827 4.866-4.827 2.688 0 4.866 2.16 4.866 4.827v.568h2.212v-.568c0-3.877-3.17-7.019-7.078-7.019A7.075 7.075 0 0 0 2.992 14.5a7.355 7.355 0 0 1 6.568-4.016c4.057 0 7.347 3.264 7.347 7.287V20.8h2.212V17.77c0-5.235-4.28-9.481-9.56-9.481a9.563 9.563 0 0 0-6.217 2.28A9.795 9.795 0 0 1 12 5.393c5.406 0 9.788 4.346 9.788 9.707V20.8H24V15.1c-.001-6.573-5.373-11.9-12.001-11.9Z'),
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
    svg: brand('M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'),
  },
  github: {
    name: 'GitHub',
    tint: '#6e6e73',
    svg: brand('M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'),
  },
  openrouter: {
    name: 'OpenRouter',
    tint: '#7d6ad0',
    svg: brand('M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z'),
  },
  supabase: {
    name: 'Supabase',
    tint: '#2fa06a',
    svg: brand('M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z'),
  },
  zoom: {
    name: 'Zoom',
    tint: '#3a7fd4',
    svg: brand('M5.033 14.649H.743a.74.74 0 0 1-.686-.458.74.74 0 0 1 .16-.808L3.19 10.41H1.06A1.06 1.06 0 0 1 0 9.35h3.957c.301 0 .57.18.686.458a.74.74 0 0 1-.161.808L1.51 13.59h2.464c.585 0 1.06.475 1.06 1.06zM24 11.338c0-1.14-.927-2.066-2.066-2.066-.61 0-1.158.265-1.537.686a2.061 2.061 0 0 0-1.536-.686c-1.14 0-2.066.926-2.066 2.066v3.311a1.06 1.06 0 0 0 1.06-1.06v-2.251a1.004 1.004 0 0 1 2.013 0v2.251c0 .586.474 1.06 1.06 1.06v-3.311a1.004 1.004 0 0 1 2.012 0v2.251c0 .586.475 1.06 1.06 1.06zM16.265 12a2.728 2.728 0 1 1-5.457 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0zm-4.82 0a2.728 2.728 0 1 1-5.458 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0z'),
  },

  /*
    ------------------------------------------- capabilities, not companies --

    The three below are not services and must never look like one. A signed-in
    browser, an MCP client and a direct upload are things this office DOES;
    there is no vendor, no trademark and nothing to identify nominatively.

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
