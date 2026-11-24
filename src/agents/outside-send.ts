/**
 * What the team says about a message to somebody outside the office (0.113.0, efficacy baseline T8).
 *
 * "Email the client that the launch is delayed by a week" was answered with a finished email, and nothing said that it would
 * wait to be sent. The gate held (no outbound job was started), but the words did not show that. The team writes the draft,
 * says that nothing has been sent, and asks before it sends. The line is added to the reply's instructions only when the
 * request is to send to someone, so an ordinary answer is not asked to ask anything.
 */

const SENDS_TO_SOMEONE =
  /\b(?:send|email|e-?mail|text|message|reply to|write to|tell|notify|forward)\b[\s\S]*\b(?:client|customer|supplier|vendor|caterer|venue|partner|contact|landlord|agent|guest|him|her|them|kevin|[A-Z][a-z]+)\b/i

export const OUTSIDE_SEND_LINE =
  'If the request is to send a message or email to somebody outside the office, write the draft in your reply, say plainly that ' +
  'nothing has been sent, and end by asking whether to send it. Never write that it has been sent.'

const NOT_TO_SEND =
  /\b(?:do not|don'?t|never|not to)\s+(?:send|email|e-?mail|text|message|reply)\b/i

export const asksToSendOutside = (request: string): boolean =>
  !NOT_TO_SEND.test(request) && SENDS_TO_SOMEONE.test(request)
