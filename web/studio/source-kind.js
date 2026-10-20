/*
  WHICH CONNECTOR A PASTED LINK BELONGS TO (20 October 2026).

  Sources sends `attach` with the link. The office's `hq_attach` needs the connector NAMED, and it does not work it out
  from the link, so the page recognises the three kinds it can attach and names one. A link none of them claims returns
  null, and the caller keeps it as a plain reference, which is what the Sources copy promises for a website.

  The names are the `knowledge_connectors` registry's (migration 0209): `drive`, `notion`, `notebooklm`. The office still
  decides whether a connector is enabled, and says so in its own words if it is not.
*/

/** The connector a link belongs to, or null when none of them claims it. */
export function connectorFor(ref) {
  let url
  try {
    url = new URL(String(ref ?? '').trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host === 'drive.google.com' && /\/folders\//.test(url.pathname)) return 'drive'
  if (host === 'notion.so' || host.endsWith('.notion.so') || host === 'notion.site' || host.endsWith('.notion.site')) {
    return 'notion'
  }
  if (host === 'notebooklm.google.com') return 'notebooklm'
  return null
}
