import { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ApiRequestError } from "./lib/api.ts";
import {
  attemptsQuery,
  documentQuery,
  noteQuery,
  notesQuery,
  recordingsQuery,
  sessionNotesQuery,
  sessionQuery,
  subjectsQuery,
  trashQuery,
  treeQuery,
} from "./lib/queries.ts";
import { meQuery } from "./lib/session.ts";
import { AppLayout } from "./routes/app/AppLayout.tsx";
import { NotePage } from "./routes/app/NotePage.tsx";
import { Notes } from "./routes/app/Notes.tsx";
import { Overview } from "./routes/app/Overview.tsx";
import { Recordings } from "./routes/app/Recordings.tsx";
import { SessionPage } from "./routes/app/SessionPage.tsx";
import { Settings } from "./routes/app/Settings.tsx";
import { SubjectPage } from "./routes/app/SubjectPage.tsx";
import { Subjects } from "./routes/app/Subjects.tsx";
import { Trash } from "./routes/app/Trash.tsx";
import { Upcoming } from "./routes/app/Upcoming.tsx";
import { ForgotPassword } from "./routes/auth/ForgotPassword.tsx";
import { ResetPassword } from "./routes/auth/ResetPassword.tsx";
import { SignIn } from "./routes/auth/SignIn.tsx";
import { SignUp } from "./routes/auth/SignUp.tsx";
import { NotFound, RouteError } from "./routes/RouteError.tsx";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

// --- Public (signed-out) screens: a signed-in user is sent to the app.
const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(meQuery);
    if (me) throw redirect({ to: "/" });
  },
  component: Outlet,
});

const signInRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in",
  validateSearch: (s: Record<string, unknown>): { redirect?: string; reset?: string } => ({
    ...(typeof s.redirect === "string" ? { redirect: s.redirect } : {}),
    ...(typeof s.reset === "string" ? { reset: s.reset } : {}),
  }),
  component: SignIn,
});
const signUpRoute = createRoute({ getParentRoute: () => publicRoute, path: "/sign-up", component: SignUp });
const forgotRoute = createRoute({ getParentRoute: () => publicRoute, path: "/forgot-password", component: ForgotPassword });

// Reset works signed in or out (the link comes from an e-mail).
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (s: Record<string, unknown>): { token?: string } =>
    typeof s.token === "string" ? { token: s.token } : {},
  component: ResetPassword,
});

// --- The app: requires a session.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery(meQuery);
    if (!me) {
      throw redirect({
        to: "/sign-in",
        search: location.href === "/" ? {} : { redirect: location.href },
      });
    }
  },
  component: AppLayout,
});

/** A 404 from the API (missing, deleted or someone else's) shows the not-found page. */
async function load<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) throw notFound();
    throw err;
  }
}

const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  loader: ({ context }) => context.queryClient.ensureQueryData(subjectsQuery),
  component: Overview,
});
const subjectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subjects",
  loader: ({ context }) => context.queryClient.ensureQueryData(subjectsQuery),
  component: Subjects,
});
const subjectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subjects/$subjectId",
  loader: ({ context, params }) => load(() => context.queryClient.ensureQueryData(treeQuery(params.subjectId))),
  component: SubjectPage,
});
const sessionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sessions/$sessionId",
  validateSearch: (s: Record<string, unknown>): { attempt?: string } =>
    typeof s.attempt === "string" ? { attempt: s.attempt } : {},
  loader: ({ context, params }) =>
    load(async () => {
      const session = await context.queryClient.ensureQueryData(sessionQuery(params.sessionId));
      await Promise.all([
        context.queryClient.ensureQueryData(treeQuery(session.subjectId)),
        context.queryClient.ensureQueryData(sessionNotesQuery(session.id)),
        context.queryClient.ensureQueryData(attemptsQuery(session.id)),
      ]);
    }),
  component: SessionPage,
});
const documentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/documents/$documentId",
  validateSearch: (s: Record<string, unknown>): { page?: number } =>
    Number(s.page) >= 1 ? { page: Math.floor(Number(s.page)) } : {},
  loader: ({ context, params }) => load(() => context.queryClient.ensureQueryData(documentQuery(params.documentId))),
  // The PDF viewer (pdf.js) loads only when a document is opened.
  component: lazyRouteComponent(() => import("./routes/app/DocumentPage.tsx"), "DocumentPage"),
});
const noteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notes/$noteId",
  loader: ({ context, params }) =>
    load(async () => {
      const note = await context.queryClient.ensureQueryData(noteQuery(params.noteId));
      await context.queryClient.ensureQueryData(sessionQuery(note.sessionId));
    }),
  component: NotePage,
});
const notesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notes",
  loader: ({ context }) => context.queryClient.ensureQueryData(notesQuery),
  component: Notes,
});
const recordingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/recordings",
  loader: ({ context }) => context.queryClient.ensureQueryData(recordingsQuery),
  component: Recordings,
});
const trashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/trash",
  loader: ({ context }) => context.queryClient.ensureQueryData(trashQuery),
  component: Trash,
});
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings", component: Settings });

const upcoming = (path: string, title: string, text: string) =>
  createRoute({ getParentRoute: () => appRoute, path, component: () => <Upcoming title={title} text={text} /> });

const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([signInRoute, signUpRoute, forgotRoute]),
  resetRoute,
  appRoute.addChildren([
    overviewRoute,
    settingsRoute,
    subjectsRoute,
    subjectRoute,
    sessionRoute,
    documentRoute,
    noteRoute,
    notesRoute,
    recordingsRoute,
    trashRoute,
    upcoming("/calendar", "Calendar", "Your study calendar comes in a later phase."),
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultNotFoundComponent: NotFound,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
