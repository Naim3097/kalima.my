/*
  Recognising "stop messaging me" in an inbound WhatsApp message.

  WHY THIS IS ITS OWN MODULE. It is the highest-consequence pure function in the
  messaging code, in both directions: miss a real opt-out and Kalima keeps
  marketing to someone who asked it to stop, which is a PDPA problem and a Meta
  policy problem; match an innocent message and a customer is silently removed
  from every list with no way to notice. Neither failure announces itself.

  So it lives here — dependency-free, no `server-only`, no database client, like
  ./reply-window and ./template-render — where it can be exercised directly
  rather than only through a webhook.
*/

/*
  WHOLE-MESSAGE MATCH, NEVER A SUBSTRING. This is the entire design.

  "Stop" alone is an instruction. "don't stop making these in navy" is a
  compliment, "stop it, I love this colour" is enthusiasm, and
  "berhenti sekejap, nak tanya" is someone asking us to wait. A substring match
  unsubscribes all three, and the customer finds out months later by not hearing
  from us.

  Malay is included because that is what a large share of Kalima's customers
  write in, and BERHENTI is the word Malaysian telcos have trained everyone to
  use for exactly this.
*/
const STOP_KEYWORDS: ReadonlySet<string> = new Set([
  "stop",
  "unsubscribe",
  "berhenti",
  "henti",
  "stop promo",
  "no promo",
  "unsub",
]);

/*
  True when the message is an opt-out and nothing else.

  Trailing punctuation is stripped because "STOP." and "Stop!" are the same
  instruction typed by people with different keyboards. Nothing else is
  normalised: the moment this starts stripping words to find a keyword inside a
  sentence, it is a substring match wearing a different hat.
*/
export function isOptOutMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  const normalised = body.trim().toLowerCase().replace(/[.!]+$/, "").trim();
  return STOP_KEYWORDS.has(normalised);
}
