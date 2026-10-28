import { Link, Outlet } from "react-router";

export function AppLayout() {
  return (
    <>
      <header>
        <Link className="brand" to="/">
          ShiftHelper
        </Link>
        <a href="/docs/swagger.html">API</a>
      </header>
      <Outlet />
      <footer>ShiftHelper · Платформа краткосрочных подработок</footer>
    </>
  );
}
