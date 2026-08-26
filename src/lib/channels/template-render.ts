/*
  Reading a WhatsApp template's {{n}} slots, and filling them in.

  SPLIT OUT OF ./whatsapp-templates BECAUSE BOTH SIDES NEED IT. The server needs
  it to store what the customer was sent; the composer needs it to show staff
  what they are about to send, on every keystroke, before anything is submitted.
  A round trip per character is not a preview.

  Deliberately dependency-free — no `server-only`, no database client, no fetch
  — for the same reason ./reply-window is: it is pure, it is directly testable,
  and it can be imported from a client component without dragging a Supabase
  client into the browser bundle.

  The rule these two functions share, and the reason they belong together: a
  parameter list is POSITIONAL and its length is the HIGHEST index used, not the
  number of placeholders present. Split them apart and one of them will
  eventually count matches instead.
*/

/*
  How many parameters a template string takes.

  The highest {{n}}, not the match count. Meta matches parameters by position
  and a body may reuse one — "Hi {{1}}, your order {{2}} is on its way, {{1}}"
  takes two, and sending three is rejected with an error about parameter counts
  that reads as though the template is wrong.
*/
export function variableCount(text: string | null | undefined): number {
  if (!text) return 0;
  let max = 0;
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/*
  Substitutes {{n}} with the supplied values.

  This is a PREVIEW, never the payload. Meta renders the real message from the
  template it holds plus the parameter array; this exists so the inbox shows
  what the customer received instead of a bare template name, and so the
  broadcast composer can show what is about to go out.

  An index with no value is LEFT AS {{n}} rather than blanked — the same choice
  lib/messaging/send.ts makes for {{name}}. A visible gap in a preview is a
  caught mistake; an invisible one is a message that reads "Your order  is
  ready" to a real customer.
*/
export function renderTemplateBody(
  bodyText: string | null,
  values: readonly string[],
): string {
  if (!bodyText) return "";
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, digits: string) => {
    const value = values[Number.parseInt(digits, 10) - 1];
    return value === undefined || value === "" ? whole : value;
  });
}
