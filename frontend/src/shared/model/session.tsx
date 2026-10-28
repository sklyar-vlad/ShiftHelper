import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCurrentUser,
  getGetCurrentUserQueryKey,
  logout,
  type CurrentUser,
  type Role,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";

export const roleNames: Record<Role, string> = {
  customer: "Заказчик",
  worker: "Исполнитель",
};
const sessionKey = getGetCurrentUserQueryKey();
type Session = {
  user: CurrentUser | null;
  isPending: boolean;
  isError: boolean;
  expired: boolean;
  refresh: () => Promise<unknown>;
  signIn: (user: CurrentUser) => Promise<void>;
  signOut: () => Promise<void>;
};
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const client = useQueryClient();
  const [expired, setExpired] = useState(false);
  const hadUser = useRef(false);
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }) => {
      try {
        return await getCurrentUser({ signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: 1,
    refetchOnWindowFocus: "always",
  });
  const reset = useCallback(
    async (user: CurrentUser | null) => {
      await client.cancelQueries();
      client.removeQueries({
        predicate: (item) => item.queryKey[0] !== sessionKey[0],
      });
      client.getMutationCache().clear();
      hadUser.current = !!user;
      client.setQueryData(sessionKey, user);
    },
    [client],
  );
  useEffect(() => {
    if (query.data) hadUser.current = true;
    if (query.data === null) {
      if (hadUser.current) setExpired(true);
      hadUser.current = false;
      client.removeQueries({
        predicate: (item) => item.queryKey[0] !== sessionKey[0],
      });
      client.getMutationCache().clear();
    }
  }, [query.data, client]);
  useEffect(() => {
    const onExpired = () => {
      setExpired(true);
      void reset(null);
    };
    window.addEventListener("shifthelper:session-expired", onExpired);
    return () =>
      window.removeEventListener("shifthelper:session-expired", onExpired);
  }, [reset]);
  return (
    <SessionContext.Provider
      value={{
        user: query.data ?? null,
        isPending: query.isPending,
        isError: query.isError,
        expired,
        refresh: () => query.refetch(),
        signIn: async (user) => {
          setExpired(false);
          await reset(user);
        },
        signOut: async () => {
          await logout();
          setExpired(false);
          await reset(null);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is required");
  return session;
}
