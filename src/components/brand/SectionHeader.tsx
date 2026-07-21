import Link from "next/link";
import { ArrowRightIcon } from "./Icons";

type Props = {
  title: string;
  cta?: { label: string; href: string };
};

export default function SectionHeader({ title, cta }: Props) {
  return (
    <div className="mb-8 flex items-end justify-between">
      <h2 className="label-caps !text-[13px]">{title}</h2>
      {cta && (
        <Link
          href={cta.href}
          className="label-caps inline-flex items-center gap-2 text-navy-400 hover:text-navy transition-colors"
        >
          {cta.label} <ArrowRightIcon size={14} />
        </Link>
      )}
    </div>
  );
}
