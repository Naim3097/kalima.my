"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/*
  On-screen controls for the printable pages. Hidden from the printed output
  itself — a "Print" button on a sheet of paper helps nobody.
*/
export function PrintToolbar({ backHref, label }: { backHref: string; label: string }) {
  return (
    <div className="mb-4 flex items-center justify-between print:hidden">
      <Link href={backHref} className="label-caps text-[11px] text-navy-400 hover:text-navy">
        ← {label}
      </Link>
      <Button type="button" variant="kalima" size="editorial" onClick={() => window.print()}>
        Print
      </Button>
    </div>
  );
}
