import { SpecialtyBadges } from "./SpecialtyBadges";
import { RatingSummary } from "./RatingSummary";
import type { PublicUser } from "@/shared/api/generated/api";
import { roleNames } from "@/shared/model/session";

export function UserCard({ user }: { user: PublicUser }) {
  return (
    <div className="user-card">
      <strong>{user.name}</strong>
      <p className="small muted">
        {roleNames[user.role]} · Завершено заданий: {user.completedGigsCount}
      </p>
      <p className="small muted">
        <RatingSummary user={user} />
      </p>
      {user.role === "worker" && (
        <SpecialtyBadges codes={user.specialties ?? []} />
      )}
      <p className="user-bio small">
        {user.bio || "Описание пока не добавлено"}
      </p>
    </div>
  );
}
