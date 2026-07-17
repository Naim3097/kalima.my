import Button from "../components/ui/Button";

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-28 text-center">
      <p className="label-caps text-navy-300">404</p>
      <h1 className="mt-4 font-display text-4xl text-navy">This page has wandered off</h1>
      <p className="mt-3 text-[14px] tracking-wide text-navy-400">
        Let's take you somewhere beautiful instead.
      </p>
      <div className="mt-9">
        <Button to="/">Back to Home</Button>
      </div>
    </div>
  );
}
