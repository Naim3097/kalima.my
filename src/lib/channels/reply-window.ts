/*
  Whether a free-text reply is still allowed on a conversation.

  Every messaging platform closes free-text replies some hours after the
  customer's LAST INBOUND message: 24h on WhatsApp, Instagram and Facebook, 48h
  on TikTok Business. Outside it, a send is rejected upstream — so if the
  composer lets staff type and press send, the message appears in our thread and
  never reaches the customer. That is the worst possible failure here: it looks
  answered and is not.

  So this is computed SERVER-SIDE and the composer is disabled from its answer.
  A browser-side timer would drift, would be wrong across a tab left open
  overnight, and could be edited by anyone with dev tools.

  Deliberately dependency-free — no `server-only`, no database client — so it is
  directly testable, like ./quantity. The window hours live in ./types alongside
  the channel definitions, and are passed in rather than imported, to keep this
  module free of everything.
*/

export type ReplyWindow = {
  /** True when a free-text reply will be accepted by the platform. */
  open: boolean;
  /** When it closes (or closed). Null when the channel imposes no window. */
  closesAt: string | null;
  /** Whole hours left, floored. Null when there is no window. */
  hoursLeft: number | null;
  /** Shown to staff when the composer is disabled. */
  reason: string | null;
};

export function replyWindow(
  windowHours: number | null,
  lastInboundAt: string | null,
  now: number = Date.now(),
): ReplyWindow {
  // Channels with no window (Shopee) are always repliable.
  if (windowHours === null) {
    return { open: true, closesAt: null, hoursLeft: null, reason: null };
  }

  /*
    No inbound message means the customer has never written. Every windowed
    platform measures from a customer message, so there is nothing to measure
    from and no window is open — replying first is what message TEMPLATES are
    for, which is a separate, approval-gated path.
  */
  if (!lastInboundAt) {
    return {
      open: false,
      closesAt: null,
      hoursLeft: null,
      reason: "This customer has not messaged yet, so a free-text reply cannot be sent.",
    };
  }

  const last = new Date(lastInboundAt).getTime();
  if (Number.isNaN(last)) {
    // An unparseable timestamp must fail CLOSED. Treating it as open would let
    // staff send into a window we cannot actually verify.
    return {
      open: false,
      closesAt: null,
      hoursLeft: null,
      reason: "The last message time could not be read, so replying is blocked.",
    };
  }

  const closes = last + windowHours * 3600_000;
  const msLeft = closes - now;
  const open = msLeft > 0;

  return {
    open,
    closesAt: new Date(closes).toISOString(),
    hoursLeft: open ? Math.floor(msLeft / 3600_000) : 0,
    reason: open
      ? null
      : `The ${windowHours}-hour reply window closed. Only an approved template can be sent now.`,
  };
}
