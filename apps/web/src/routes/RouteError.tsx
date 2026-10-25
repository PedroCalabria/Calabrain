import { Link } from "@tanstack/react-router";
import { Wordmark } from "../components/ui.tsx";

function Shell({ title, text }: { title: string; text: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Wordmark />
      <h1 className="mt-8 text-2xl leading-8 font-medium">{title}</h1>
      <p className="mt-2 max-w-[44ch] text-ink-muted">{text}</p>
      <Link to="/" className="btn btn-secondary mt-6 no-underline">
        Go to Overview
      </Link>
    </main>
  );
}

export function NotFound() {
  return <Shell title="Page not found" text="This address doesn't lead anywhere. Check the link or start from the Overview." />;
}

export function RouteError() {
  return (
    <Shell
      title="Something went wrong"
      text="We couldn't load this page. Check your connection and reload; if it keeps happening, try again in a few minutes."
    />
  );
}
