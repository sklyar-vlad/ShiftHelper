import { createBrowserRouter } from "react-router";
import { HomePage } from "@/pages/home/HomePage";
import { AppLayout } from "@/widgets/layout/AppLayout";

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    children: [
      { index: true, Component: HomePage },
      {
        path: "*",
        element: (
          <main>
            <h1>Страница не найдена</h1>
            <a href="/">На главную</a>
          </main>
        ),
      },
    ],
  },
]);
