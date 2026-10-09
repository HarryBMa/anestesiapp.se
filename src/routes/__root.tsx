import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  // The homepage and the full-screen relaxation player have no site chrome.
  const path = useRouterState({ select: s => s.location.pathname });
  const bare = path === '/' || path.startsWith('/lugn');

  return (
    <>
      {!bare && (
        <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-5 sm:px-8">
          <Link
            to="/"
            className="font-wide text-sm font-bold tracking-tight lowercase"
          >
            anestesiapp
          </Link>
          <nav className="flex gap-1 text-sm">
            <NavLink to="/blodgas">Blodgas</NavLink>
            <NavLink to="/lugn">Lugn</NavLink>
          </nav>
        </header>
      )}
      <Outlet />
    </>
  );
}

function NavLink({ to, children }: { to: '/blodgas' | '/lugn'; children: string }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
      activeProps={{ className: 'text-foreground font-semibold' }}
    >
      {children}
    </Link>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-24 sm:px-8">
      <p className="font-wide text-3xl font-bold">Sidan finns inte.</p>
      <Link to="/" className="mt-4 inline-block underline underline-offset-4">
        Till startsidan
      </Link>
    </main>
  );
}
