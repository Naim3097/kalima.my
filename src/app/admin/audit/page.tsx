import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, Chip, Table, Td, Tr } from "@/components/admin/ui";
import { getAuditFacets, listAuditLog } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Audit Log · Admin",
  description: "Who changed what in the Kalima back office.",
};

type Search = { searchParams: Promise<{ type?: string; actor?: string }> };

// Relative time, since "who did this and when" is nearly always a recent question.
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/*
  Append-only trail of back-office actions. Server Component: reads are staff-
  gated by the /admin guard and the admin client. Filters are plain links so
  the page stays fully static-renderable with no client JS.
*/
export default async function AuditLogPage({ searchParams }: Search) {
  const { type, actor } = await searchParams;
  const [entries, facets] = await Promise.all([
    listAuditLog({ entityType: type, actorEmail: actor }),
    getAuditFacets(),
  ]);

  const href = (next: { type?: string; actor?: string }) => {
    const p = new URLSearchParams();
    const t = next.type ?? type;
    const a = next.actor ?? actor;
    if (t) p.set("type", t);
    if (a) p.set("actor", a);
    const qs = p.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  const filtering = Boolean(type || actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Audit Log</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Every back-office change, newest first — who did it and when. Append-only:
          entries can be read but never edited or removed.
        </p>
      </div>

      <Card>
        <CardHeader
          title={`${entries.length} ${entries.length === 200 ? "most recent entries" : "entries"}`}
          action={
            filtering ? (
              <Link href="/admin/audit" className="label-caps text-[11px] text-navy-400 hover:text-navy">
                Clear filters
              </Link>
            ) : undefined
          }
        />

        {(facets.entityTypes.length > 0 || facets.actors.length > 0) && (
          <div className="mb-5 space-y-2">
            {facets.entityTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="label-caps mr-1 text-[10px] text-navy-300">Area</span>
                {facets.entityTypes.map((t) => (
                  <Link
                    key={t}
                    href={href({ type: t === type ? undefined : t })}
                    className={`rounded-full px-3 py-1 text-[11px] tracking-wide transition-colors ${
                      t === type ? "bg-navy text-white" : "bg-navy-50 text-navy-400 hover:text-navy"
                    }`}
                  >
                    {t}
                  </Link>
                ))}
              </div>
            )}
            {facets.actors.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="label-caps mr-1 text-[10px] text-navy-300">Who</span>
                {facets.actors.map((a) => (
                  <Link
                    key={a}
                    href={href({ actor: a === actor ? undefined : a })}
                    className={`rounded-full px-3 py-1 text-[11px] tracking-wide transition-colors ${
                      a === actor ? "bg-navy text-white" : "bg-navy-50 text-navy-400 hover:text-navy"
                    }`}
                  >
                    {a}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {entries.length === 0 ? (
          <p className="text-[13px] tracking-wide text-navy-400">
            {filtering
              ? "No entries match those filters."
              : "No activity recorded yet. Back-office changes will appear here."}
          </p>
        ) : (
          <Table head={["When", "Who", "Area", "What happened"]}>
            {entries.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap text-navy-400">
                  <span title={new Date(e.createdAt).toLocaleString("en-MY")}>{ago(e.createdAt)}</span>
                </Td>
                <Td className="whitespace-nowrap">{e.actorEmail ?? "—"}</Td>
                <Td>
                  <Chip>{e.entityType}</Chip>
                </Td>
                <Td>
                  <span>{e.summary}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-navy-300">{e.action}</span>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
