import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { useEffect } from "react";
import { Toaster } from "~/components/ui/toast";
import { store } from "./store/store";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  {
    rel: "manifest",
    href: "/manifest.webmanifest",
    type: "application/manifest+json",
  },
];

export function loader({ request }: Route.LoaderArgs) {
  // the only thing left at the root: every route needs it (useCookie reads it
  // via useRouteLoaderData("root")), and it's free to produce. The sidebar's
  // projects/sessions moved to the default layout route.
  return data({ cookie: request.headers.get("cookie") });
}

export function Layout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
    }
  }, []);

  // connected here rather than in DefaultLayout: the whole sidebar is driven by
  // this stream, and a route that renders without that layout would otherwise
  // tear the EventSource down and reconnect it.
  useEffect(() => store.connect(), []);

  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b0b0f" />
        <title>Pi 2</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        {/* mounted at the root so every route can use the shared toast manager */}
        <Toaster />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
