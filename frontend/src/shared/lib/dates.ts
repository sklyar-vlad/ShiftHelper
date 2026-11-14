export function localDate(value: string) {
  const d = new Date(value);
  const pad = (n: number, length = 2) => String(n).padStart(length, "0");
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function parseLocalDateTime(value: string) {
  const parts =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!parts) return null;
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    return null;
  const canonical = `${parts[1]}T${parts[2]}:${parts[3] ?? "00"}.${(parts[4] ?? "").padEnd(3, "0")}`;
  return localDate(date.toISOString()) === canonical ? date : null;
}

export function apiDate(value: string, original?: string) {
  if (original && value === localDate(original)) return original;
  return parseLocalDateTime(value)?.toISOString() ?? null;
}

export function formatDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "меньше минуты";
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60;
  return [
    days ? `${days} д` : "",
    hours ? `${hours} ч` : "",
    rest ? `${rest} мин` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
