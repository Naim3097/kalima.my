import { Card, CardHeader } from "@/components/admin/ui";
import { SALES_14D } from "@/data/demo";
import { formatRM } from "@/lib/format";

/*
  14-day sales bars. Deliberately hand-rolled — flat divs sized by percentage
  of the period max, no charting library. Lives in its own module so the
  dashboard can lazy-load it: it sits below the fold.
*/
export default function SalesChart() {
  const max = Math.max(...SALES_14D.map((d) => d.total));

  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Sales — last 14 days"
        action={
          <span className="text-[12px] text-navy-400">
            {formatRM(SALES_14D.reduce((n, d) => n + d.total, 0))} total
          </span>
        }
      />
      <div className="flex items-end gap-2 px-5 pb-5 pt-6">
        {SALES_14D.map((d) => (
          <div key={d.day} className="group flex flex-1 flex-col items-center gap-2" title={`${d.day}: ${formatRM(d.total)}`}>
            <div
              className="w-full bg-navy/80 transition-colors group-hover:bg-navy"
              style={{ height: `${Math.max(6, (d.total / max) * 170)}px` }}
            />
            <span className="hidden text-[9px] tracking-wide text-navy-300 md:block">{d.day.split(" ")[0]}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
