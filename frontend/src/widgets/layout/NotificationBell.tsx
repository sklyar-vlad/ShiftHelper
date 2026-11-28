import { useEffect, useId, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useLocation, useNavigationType } from "react-router";
import { Button } from "react-aria-components/Button";
import { Dialog, DialogTrigger } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { Popover } from "react-aria-components/Popover";
import {
  getGetCurrentUserQueryKey,
  getListMyNotificationsQueryKey,
  listMyNotifications,
  readAllMyNotifications,
  readMyNotification,
  type CurrentUser,
  type Notification,
} from "@/shared/api/generated/api";
import { cancellationReasonNames } from "@/entities/gig/GigFacts";
import { formatDateTime } from "@/shared/lib/format";
import "./notifications.css";

const messages: Record<string, string> = {
  application_created: "Новый отклик на задание",
  application_selected: "Вас выбрали исполнителем",
  application_rejected: "Выбран другой исполнитель",
  gig_cancelled: "Заказчик отменил задание",
  gig_terms_changed: "Условия изменились. Подтвердите новую редакцию",
  gig_change_proposed: "Заказчик предложил новые условия",
  gig_change_accepted: "Исполнитель принял новые условия",
  gig_change_rejected: "Исполнитель отклонил новые условия",
  gig_change_withdrawn: "Заказчик отозвал предложение условий",
  gig_submitted: "Исполнитель сдал работу",
  gig_completed: "Заказчик подтвердил выполнение",
};

const sessionKey = getGetCurrentUserQueryKey();
const feedKey = (userId: string) => [
  ...getListMyNotificationsQueryKey(),
  userId,
];

function target(item: Notification) {
  if (item.type === "application_rejected" || item.type === "gig_cancelled") {
    return "/my-gigs?view=applications&scope=history";
  }
  return item.gigId ? `/gigs/${item.gigId}` : "/my-gigs";
}

export function NotificationBell({ userId }: { userId: string }) {
  const client = useQueryClient();
  const location = useLocation();
  const navigationType = useNavigationType();
  const countLabel = useId();
  const handledNavigation = useRef<string>(null);
  const query = useInfiniteQuery({
    queryKey: feedKey(userId),
    queryFn: ({ pageParam, signal }) =>
      listMyNotifications(
        { pageSize: 20, cursor: pageParam ?? undefined },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    refetchOnWindowFocus: "always",
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(
    () => () => {
      if (client.getQueryData<CurrentUser>(sessionKey)?.id !== userId) {
        client.removeQueries({ queryKey: feedKey(userId), exact: true });
      }
    },
    [client, userId],
  );

  const read = useMutation({
    mutationFn: (id: string | null) =>
      id ? readMyNotification(id) : readAllMyNotifications(),
    onSuccess: () => {
      if (client.getQueryData<CurrentUser>(sessionKey)?.id === userId) {
        return client.invalidateQueries({
          queryKey: feedKey(userId),
          exact: true,
        });
      }
    },
  });
  const { mutate } = read;
  useEffect(() => {
    const request = location.state?.notificationRead;
    if (
      navigationType === "POP" ||
      request?.userId !== userId ||
      typeof request.id !== "string" ||
      handledNavigation.current === location.key
    )
      return;
    handledNavigation.current = location.key;
    mutate(request.id);
  }, [location.key, location.state, mutate, navigationType, userId]);

  const count = query.data?.pages[0]?.unreadCount;
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <DialogTrigger
      onOpenChange={(open) => {
        if (open) void query.refetch({ cancelRefetch: false });
      }}
    >
      <Button
        className="notification-trigger"
        aria-label="Уведомления"
        aria-describedby={count === undefined ? undefined : countLabel}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" />
        </svg>
        {!!count && (
          <span className="notification-badge" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        )}
        {count !== undefined && (
          <span className="notification-count-label" id={countLabel}>
            Непрочитанных: {count}
          </span>
        )}
      </Button>
      <Popover
        className="notification-popover"
        placement="bottom end"
        offset={8}
        containerPadding={12}
      >
        <Dialog className="notification-dialog">
          {({ close }) => (
            <>
              <Heading slot="title" level={2}>
                Уведомления
              </Heading>
              {!!count && (
                <Button
                  className="text-button"
                  isDisabled={read.isPending}
                  onPress={() => mutate(null)}
                >
                  Отметить всё прочитанным
                </Button>
              )}
              {query.isPending && (
                <p className="muted small" role="status">
                  Загружаем уведомления…
                </p>
              )}
              {query.isError && (
                <p className="notice notice-error" role="alert">
                  Не удалось загрузить уведомления.{" "}
                  <Button
                    className="text-button"
                    onPress={() =>
                      void (query.isFetchNextPageError
                        ? query.fetchNextPage()
                        : query.refetch())
                    }
                  >
                    Повторить
                  </Button>
                </p>
              )}
              {read.isError && (
                <p className="notice notice-error" role="alert">
                  Не удалось отметить уведомления.{" "}
                  <Button
                    className="text-button"
                    onPress={() => mutate(read.variables ?? null)}
                  >
                    Повторить отметку
                  </Button>
                </p>
              )}
              {query.isSuccess && !items.length && (
                <p className="muted small">Уведомлений пока нет.</p>
              )}
              {!!items.length && (
                <ul className="notification-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        className="notification-item"
                        data-unread={!item.readAt}
                        to={target(item)}
                        state={
                          item.readAt
                            ? undefined
                            : { notificationRead: { userId, id: item.id } }
                        }
                        onClick={close}
                      >
                        <strong>
                          {Object.hasOwn(messages, item.type)
                            ? messages[item.type]
                            : "Обновление задания"}
                        </strong>
                        <span>{item.gigTitle}</span>
                        {item.type === "gig_cancelled" && (
                          <span className="small">
                            {item.cancellationReason
                              ? cancellationReasonNames[item.cancellationReason]
                              : "Причина не указана"}
                          </span>
                        )}
                        <time className="small muted" dateTime={item.createdAt}>
                          {formatDateTime(item.createdAt)}
                        </time>
                        {!item.readAt && (
                          <span className="small notification-unread">
                            Не прочитано
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {query.hasNextPage && !query.isFetchNextPageError && (
                <Button
                  className="button button-secondary button-small"
                  isDisabled={query.isFetching}
                  onPress={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё"}
                </Button>
              )}
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
