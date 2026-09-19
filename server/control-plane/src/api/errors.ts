export class SessionExpiredError extends Error {}

// Any non-2xx answer from D2L that isn't a dead session. Carries the HTTP status and D2L's own
// problem detail so callers can explain *what* went wrong instead of guessing from the class
// alone — a bare 404 and a 400 need very different advice.
export class D2lHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // Route without host or query string, e.g. "le/1.97/524042/grades/final/values/".
    readonly route: string,
    // D2L's problem-details "detail"/"title", when it sent one.
    readonly detail?: string
  ) {
    super(message);
  }
}
// The cookie is valid, but the account lacks the D2L role/permission the endpoint requires
// (e.g. a student calling an instructor-only grading route). Telling the caller to reconnect
// would be wrong — they need a different role, not a fresh session.
export class PermissionDeniedError extends D2lHttpError {}
// The cookie is valid, but D2L has nothing at this route: the course/item id doesn't exist, the
// caller can't see it, or the underlying tool (Quizzes, Surveys, ...) isn't enabled for the
// course. D2L uses a bare 404 for all of these, so callers must not claim just one of them.
export class NotFoundError extends D2lHttpError {}
// D2L rejected the request itself (missing/invalid parameters, unsupported for this object).
export class BadRequestError extends D2lHttpError {}

export class UnknownOperationError extends Error {}
export class InvalidRouteParamsError extends Error {}
export class UnsupportedOperationError extends Error {}
