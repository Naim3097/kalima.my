import { Link } from "react-router-dom";
import SectionHeader from "../ui/SectionHeader";

const SHOTS = [
  { image: "/products/maya-chiffon.jpg", to: "/products/maya-chiffon" },
  { image: "/products/bella-dress.jpg", to: "/products/bella-dress" },
  { image: "/products/amanda-sparkle.jpg", to: "/products/amanda-sparkle" },
  { image: "/products/ruwa-kaftan-blue.jpg", to: "/products/ruwa-kaftan" },
  { image: "/products/sofea-dress.jpg", to: "/products/sofea-dress" },
];

export default function Lookbook() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="Lookbook" cta={{ label: "View Instagram", to: "/pages/contact" }} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {SHOTS.map((shot) => (
          <Link key={shot.image} to={shot.to} className="group block overflow-hidden">
            <img
              src={shot.image}
              alt="Kalima lookbook"
              loading="lazy"
              draggable={false}
              className="aspect-[4/5] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03] select-none"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
