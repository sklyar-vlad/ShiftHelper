import { Link } from "react-router";

export function BrandLink({ label }: { label: string }) {
  return (
    <Link className="brand" to="/" aria-label={label}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M5 5h22v17H16l-7 5v-5H5V5Z" fill="currentColor" />
          <path
            d="m12 14 3 3 6-7"
            stroke="#000000"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      ShiftHelper
    </Link>
  );
}
