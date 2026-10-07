export type Status =
  | "ok"
  | "preview"
  | "invalid"
  | "invalid_arguments"
  | "conflict"
  | "unavailable";

import { utf8Compare } from "./canonical.ts";
export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  file: string | null;
  details?: Record<string, unknown>;
}
export interface Result<T = Record<string, unknown>> {
  schemaVersion: 1;
  status: Status;
  data: T | null;
  diagnostics: Diagnostic[];
}
export const exits: Record<Status, number> = {
  ok: 0,
  preview: 0,
  invalid: 1,
  invalid_arguments: 2,
  conflict: 3,
  unavailable: 4,
};
export class ProjectError extends Error {
  readonly status: Status;
  readonly diagnostic: Diagnostic;
  readonly diagnostics: Diagnostic[];
  constructor(
    status: Status,
    code: string,
    message: string,
    file: string | null = null,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.diagnostic = { code, severity: "error", message, file, ...(details ? { details } : {}) };
    this.diagnostics = [this.diagnostic];
  }
}
export function failure(error: unknown): Result {
  const problem =
    error instanceof ProjectError
      ? error
      : new ProjectError(
          "unavailable",
          "IO_FAILURE",
          error instanceof Error ? error.message : "Filesystem operation failed.",
        );
  return {
    schemaVersion: 1,
    status: problem.status,
    data: null,
    diagnostics: sortedDiagnostics(problem.diagnostics),
  };
}
export function ok<T>(data: T, diagnostics: Diagnostic[] = []): Result<T> {
  return { schemaVersion: 1, status: "ok", data, diagnostics: sortedDiagnostics(diagnostics) };
}
function sortedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      utf8Compare(left.file ?? "", right.file ?? "") ||
      utf8Compare(left.code, right.code) ||
      utf8Compare(left.message, right.message),
  );
}
export function combineErrors(first: unknown, secondary: unknown): ProjectError {
  const primary =
    first instanceof ProjectError
      ? first
      : new ProjectError(
          "unavailable",
          "IO_FAILURE",
          first instanceof Error ? first.message : "Operation failed.",
        );
  const related = failure(secondary);
  const status = exits[primary.status] >= exits[related.status] ? primary.status : related.status;
  const result = new ProjectError(
    status,
    primary.diagnostic.code,
    primary.message,
    primary.diagnostic.file,
    primary.diagnostic.details,
  );
  result.diagnostics.splice(
    0,
    result.diagnostics.length,
    ...primary.diagnostics,
    ...related.diagnostics,
  );
  return result;
}
export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
