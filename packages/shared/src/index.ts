export * from "./auth.ts";
export * from "./limits.ts";
export * from "./tree.ts";
export * from "./uploads.ts";

/** Error body every API route returns on failure. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
