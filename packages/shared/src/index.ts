export * from "./auth.ts";
export * from "./limits.ts";

/** Error body every API route returns on failure. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
