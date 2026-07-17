import { Link, useParams } from "react-router-dom";

const PAGES: Record<string, { title: string; body: string[] }> = {
  "about-kalima": {
    title: "About Kalima",
    body: [
      "Kalima is a Malaysian modest fashion house built on a simple belief: elegance and modesty belong together, without compromise.",
      "Every piece is designed in-house in Malaysia, cut from premium fabrics we source and test ourselves, and made to travel with you through every beautiful journey — from everyday moments to the celebrations that matter.",
    ],
  },
  fabrics: {
    title: "Our Fabrics",
    body: [
      "We build each collection around fabric first — luxury chiffon with true drape, breathable cotton-linen, heavyweight crepe that holds its line, and 4-way stretch rayon for all-day ease.",
      "Full fabric stories and care guides are being prepared for this page.",
    ],
  },
  stores: {
    title: "Stores",
    body: [
      "Our store locator is coming soon. Meanwhile, shop online with free shipping for orders above RM300 nationwide.",
    ],
  },
  shipping: {
    title: "Shipping",
    body: [
      "We ship nationwide (Semenanjung, Sabah & Sarawak) via trusted courier partners. Free shipping for orders above RM300.",
      "Live courier rates and tracking arrive with our EasyParcel integration.",
    ],
  },
  returns: {
    title: "Returns & Exchanges",
    body: [
      "We offer a 14-day easy return policy from the day your order arrives. Items must be unworn with tags intact.",
      "The full self-service returns portal is on its way.",
    ],
  },
  "size-guide": {
    title: "Size Guide",
    body: ["Detailed measurement charts for every silhouette are being prepared. For now, our team is happy to help you size correctly — contact us."],
  },
  contact: {
    title: "Contact Us",
    body: ["Customer support channels (WhatsApp, email, social) will be listed here. We're here to help."],
  },
  "kalima-club": {
    title: "Kalima Club",
    body: [
      "Kalima Club is our loyalty membership — earn points on every purchase, unlock tiers, and enjoy exclusive offers and private sales.",
      "Launching soon. Join the newsletter to be first in line.",
    ],
  },
};

export default function ContentPage() {
  const { slug } = useParams();
  const page = slug ? PAGES[slug] : undefined;

  if (!page) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl text-navy">Page not found</h1>
        <Link to="/" className="link-editorial mt-6">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <nav className="label-caps mb-8 text-navy-300">
        <Link to="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        / <span className="text-navy-400">{page.title}</span>
      </nav>
      <h1 className="font-display text-4xl text-navy">{page.title}</h1>
      <div className="mt-8 space-y-5">
        {page.body.map((para, i) => (
          <p key={i} className="text-[15px] leading-relaxed tracking-wide text-navy-400">
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}
