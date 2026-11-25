import type { GigPoint } from "@/shared/api/generated/api";

const warningThresholdMeters = 300;
const kilometers = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
});

function distanceMeters({
  latitude,
  longitude,
  addressReference,
}: NonNullable<GigPoint>) {
  if (!addressReference) return 0;

  const radians = Math.PI / 180;
  const latitudeDelta = (latitude - addressReference.latitude) * radians;
  const longitudeDelta = (longitude - addressReference.longitude) * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude * radians) *
      Math.cos(addressReference.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function GigPlaceWarning({ point }: { point: NonNullable<GigPoint> }) {
  const distance = distanceMeters(point);
  if (distance <= warningThresholdMeters) return null;

  const label =
    distance < 1000
      ? `${Math.round(distance)} м`
      : `${kilometers.format(distance / 1000)} км`;
  return (
    <p className="place-map-warning" role="status">
      Метка находится в {label} от указанного адреса.
    </p>
  );
}
