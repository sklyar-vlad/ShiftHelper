import { createBrowserRouter } from "react-router";
import { HomePage } from "@/pages/home/HomePage";
import { AppLayout } from "@/widgets/layout/AppLayout";
import { AccountPage } from "@/pages/account/AccountPage";
import { AuthPage } from "@/pages/auth/AuthPage";
import { RequireUser } from "@/shared/ui/RequireUser";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { CatalogPage } from "@/pages/catalog/CatalogPage";
import { GigPage } from "@/pages/catalog/GigPage";
import { CreateGigPage } from "@/pages/create-gig/CreateGigPage";
import { MyGigsPage } from "@/pages/my-gigs/MyGigsPage";

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    children: [
      { index: true, Component: HomePage },
      {
        path: "catalog",
        Component: CatalogPage,
      },
      { path: "gigs/:gigId", Component: GigPage },
      {
        path: "login",
        element: <AuthPage key="login" mode="login" />,
      },
      {
        path: "register",
        element: <AuthPage key="register" mode="register" />,
      },
      {
        element: <RequireUser />,
        children: [
          { path: "profile", Component: AccountPage },
          {
            path: "my-gigs",
            Component: MyGigsPage,
          },
        ],
      },
      {
        element: <RequireUser role="customer" />,
        children: [
          {
            path: "gigs/new",
            Component: CreateGigPage,
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
