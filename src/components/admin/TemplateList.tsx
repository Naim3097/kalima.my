/*
  Every synced template and what Meta currently makes of it.

  WHY THE UNAPPROVED ONES ARE THE POINT. The composer only ever offers APPROVED
  templates, which means without this panel the entire feedback loop is a
  template that silently never appears. "Did Meta approve it yet?" and "why did
  they refuse it?" are the only two questions anyone has between submitting a
  template and using it, and `rejected_reason` — which Meta does give us — would
  otherwise sit in a column nobody can read.

  A server component: it renders data the page already loaded and has no
  interaction of its own. The Sync button beside it is the client half.
*/

/* Meta's vocabulary, not ours — see the note on `status` in the migration.
   An unfamiliar status falls through to neutral styling and its own raw text,
   which is more useful than mapping it to a colour that asserts something. */
const TONE: Record<string, string> = {
  APPROVED: "text-emerald-700",
  PENDING: "text-amber-700",
  IN_APPEAL: "text-amber-700",
  REJECTED: "text-red-700",
  PAUSED: "text-red-700",
  DISABLED: "text-red-700",
};

export type TemplateListItem = {
  name: string;
  language: string;
  category: string | null;
  status: string;
  bodyText: string | null;
  bodyVariables: number;
  headerFormat: string | null;
  rejectedReason: string | null;
  qualityScore: string | null;
};

export default function TemplateList({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) return null;

  return (
    <ul className="divide-y divide-navy/5">
      {templates.map((t) => (
        <li key={`${t.name}|${t.language}`} className="py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-[13px] text-navy">
              {t.name}
              <span className="ml-2 text-[11px] text-navy-300">
                {t.language}
                {t.category ? ` · ${t.category.toLowerCase()}` : ""}
                {t.bodyVariables > 0
                  ? ` · ${t.bodyVariables} value${t.bodyVariables === 1 ? "" : "s"}`
                  : ""}
              </span>
            </p>
            <p className={`label-caps text-[10px] ${TONE[t.status] ?? "text-navy-400"}`}>
              {t.status.replace(/_/g, " ").toLowerCase()}
              {t.qualityScore ? ` · ${t.qualityScore.toLowerCase()}` : ""}
            </p>
          </div>

          {t.bodyText && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-navy-300">
              {t.bodyText}
            </p>
          )}

          {/* Meta's own words. The reason is almost always specific and
              actionable, and paraphrasing it would cost the one thing that
              makes it useful. */}
          {t.rejectedReason && (
            <p className="mt-1 text-[11px] leading-relaxed text-red-700">
              Meta&apos;s reason: {t.rejectedReason}
            </p>
          )}

          {/*
            Stated here rather than left as a mystery. These templates are
            filtered out of both composers, so without this line a staff member
            sees an APPROVED template that never appears in the picker and has
            no way to learn why.
          */}
          {t.status === "APPROVED" && t.headerFormat && t.headerFormat !== "TEXT" && (
            <p className="mt-1 text-[11px] leading-relaxed text-navy-400">
              Not offered in the composer — its {t.headerFormat.toLowerCase()} header needs a media
              attachment, which is not built yet.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
