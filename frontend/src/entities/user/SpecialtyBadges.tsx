import { CategoryName } from "@/entities/gig/GigCategory";
import type { CategoryCode } from "@/shared/api/generated/api";
import "./specialties.css";

export function SpecialtyBadges({ codes }: { codes: CategoryCode[] }) {
  if (!codes.length) return null;
  return (
    <ul className="specialty-badges" aria-label="Специализации">
      {codes.map((code) => (
        <li key={code} className="badge">
          <CategoryName code={code} />
        </li>
      ))}
    </ul>
  );
}
