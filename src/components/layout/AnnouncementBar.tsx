"use client";

import { useEffect, useState } from "react";
import { ANNOUNCEMENTS } from "@/data/catalog";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/brand/Icons";

export default function AnnouncementBar() {
  const [index, setIndex] = useState(0);
  const count = ANNOUNCEMENTS.length;

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [count]);

  return (
    <div className="bg-cream-50 border-b border-navy/10">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-6 px-4 py-2.5">
        <button
          aria-label="Previous announcement"
          onClick={() => setIndex((i) => (i - 1 + count) % count)}
          className="text-navy-300 hover:text-navy transition-colors cursor-pointer"
        >
          <ChevronLeftIcon size={14} />
        </button>
        <p className="label-caps !tracking-wide2 text-center text-navy" aria-live="polite">
          {ANNOUNCEMENTS[index]}
        </p>
        <button
          aria-label="Next announcement"
          onClick={() => setIndex((i) => (i + 1) % count)}
          className="text-navy-300 hover:text-navy transition-colors cursor-pointer"
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </div>
  );
}
