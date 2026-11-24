import type { GigPoint } from "@/shared/api/generated/api";

export function GigPointAttribution({
  point,
}: {
  point: NonNullable<GigPoint>;
}) {
  return (
    <small className="muted">
      {point.attribution}
      {" · "}
      <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
        Geoapify
      </a>
    </small>
  );
}
