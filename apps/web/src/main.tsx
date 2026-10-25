import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "./components/overlay.tsx";
import { ApiRequestError } from "./lib/api.ts";
import { makeRouter } from "./router.tsx";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors (404, 401...) won't change on retry; network and 5xx get one more try.
      retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});
const router = makeRouter(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
