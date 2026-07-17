/*
  Stand-in for product/campaign photography (client action item — PROJECT_PLAN.md §8).
  Renders a soft fabric-toned gradient with a faint Kalima monogram so the
  layout reads correctly before real images are supplied.
*/
type Props = {
  tone: string;
  className?: string;
  label?: string;
  mark?: boolean;
};

export default function PlaceholderImage({ tone, className = "", label, mark = true }: Props) {
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `
          radial-gradient(120% 90% at 20% 10%, rgba(255,255,255,0.35), transparent 55%),
          radial-gradient(100% 80% at 85% 90%, rgba(32,35,58,0.28), transparent 60%),
          linear-gradient(160deg, ${tone} 0%, ${tone} 55%, rgba(32,35,58,0.35) 130%)
        `,
      }}
      aria-label={label}
      role="img"
    >
      {mark && (
        <img
          src="/brand/kalima-mark-white.png"
          alt=""
          className="absolute inset-0 m-auto w-1/3 opacity-15 select-none pointer-events-none"
          draggable={false}
        />
      )}
    </div>
  );
}
