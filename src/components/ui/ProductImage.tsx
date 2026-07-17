import PlaceholderImage from "./PlaceholderImage";

/*
  Renders photoshoot imagery when available, otherwise the branded
  placeholder gradient. All product imagery flows through here so real
  photography drops in via the catalog's `image` field alone.
*/
type Props = {
  image?: string;
  tone: string;
  alt: string;
  className?: string;
  position?: string;
};

export default function ProductImage({ image, tone, alt, className = "", position = "center top" }: Props) {
  if (image) {
    return (
      <img
        src={image}
        alt={alt}
        loading="lazy"
        draggable={false}
        className={`object-cover select-none ${className}`}
        style={{ objectPosition: position }}
      />
    );
  }
  return <PlaceholderImage tone={tone} className={className} label={alt} />;
}
