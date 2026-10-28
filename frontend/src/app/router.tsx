import { createBrowserRouter } from "react-router";
import { HomePage } from "@/pages/home/HomePage";
import { AppLayout } from "@/widgets/layout/AppLayout";
import { AccountPage } from "@/pages/account/AccountPage";
import { RequireUser } from "@/shared/ui/RequireUser";
import { StatusPanel } from "@/shared/ui/StatusPanel";

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    children: [
      { index: true, Component: HomePage },
      {
        path: "catalog",
        element: (
          <StatusPanel
            title="Подработки"
            description="Каталог предложений скоро появится здесь."
          />
        ),
      },
      {
        path: "login",
        element: (
          <StatusPanel
            title="Вход в аккаунт"
            description="Форма входа появится на следующем шаге."
          />
        ),
      },
      {
        path: "register",
        element: (
          <StatusPanel
            title="Создать аккаунт"
            description="Регистрация скоро станет доступна."
          />
        ),
      },
      {
        element: <RequireUser />,
        children: [
          { path: "profile", Component: AccountPage },
          {
            path: "my-gigs",
            element: (
              <StatusPanel
                title="Мои задания"
                description="Ваши публикации, отклики и история работ появятся здесь."
              />
            ),
          },
        ],
      },
      {
        element: <RequireUser role="customer" />,
        children: [
          {
            path: "gigs/new",
            element: (
              <StatusPanel
                title="Новое задание"
                description="Публикация заданий скоро станет доступна."
              />
            ),
          },
        ],
      },
      {
        path: "*",
        element: (
          <StatusPanel
            title="Страница не найдена"
            description="Возможно, адрес изменился или в нём опечатка."
          />
        ),
      },
    ],
  },
]);
