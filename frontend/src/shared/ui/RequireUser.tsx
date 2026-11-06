import { Navigate, Outlet, useLocation } from "react-router";
import type { Role } from "@/shared/api/generated/api";
import { useSession } from "@/shared/model/session";
import { StatusPanel } from "./StatusPanel";

export function RequireUser({ role }: { role?: Role }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending)
    return <StatusPanel title="Проверяем аккаунт" pending />;
  if (session.isError)
    return (
      <StatusPanel
        title="Не удалось проверить аккаунт"
        description="Проверьте соединение и попробуйте ещё раз."
        retry={() => void session.refresh()}
      />
    );
  if (!session.user)
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search,
          expired: session.expired,
        }}
      />
    );
  if (role && session.user.role !== role)
    return (
      <StatusPanel
        title="Этот раздел для заказчиков"
        description="Вы вошли как исполнитель. Подходящую работу можно искать в каталоге."
      />
    );
  return <Outlet />;
}
