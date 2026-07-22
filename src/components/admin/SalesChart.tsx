import { Card, CardHeader } from "@/components/admin/ui";
import { formatRM } from "@/lib/format";

/*
  14-day sales bars. Deliberately hand-rolled — flat divs sized by percentage
  of the period max, no charting library. Lives in its own module so the
  dashboard can lazy-load it: it sits below the fold. Data is passed in from
  the dashboard's getDashboardStats() call.
*/
export default function SalesChart({ data }: { data: { date: string; sen: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.sen));

  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Sales — last 14 days"
        action={
          <span className="text-[12px] text-navy-400">
            {formatRM(data.reduce((n, d) => n + d.sen, 0) / 100)} total
          </span>
        }
      />
      <div className="flex items-end gap-2 px-5 pb-5 pt-6">
        {data.map((d) => {
          const day = new Date(d.date).getDate();
          return (
            <div key={d.date} className="group flex flex-1 flex-col items-center gap-2" title={`${d.date}: ${formatRM(d.sen / 100)}`}>
              <div
                className="w-full bg-navy/80 transition-colors group-hover:bg-navy"
                style={{ height: `${Math.max(6, (d.sen / max) * 170)}px` }}
              />
              <span className="hidden text-[9px] tracking-wide text-navy-300 md:block">{day}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
