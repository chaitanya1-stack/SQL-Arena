# API overview

The browser uses same-origin `/api` requests. JSON is required for request bodies. Mutations require the exact configured `Origin`; authorization uses the HttpOnly `arena_session` cookie. OpenAPI route discovery is available to administrators at `/api/docs`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | Current user and configured authentication options |
| POST | `/api/auth/register` | `{email,password,name}`; password at least 10 characters |
| POST | `/api/auth/login` | `{email,password}` |
| POST | `/api/auth/guest` | Create a temporary guest identity |
| POST | `/api/auth/logout` | Revoke current session |
| POST | `/api/auth/forgot` | `{email}`; generic response, SMTP required |
| POST | `/api/auth/request-verification` | Email verification link for current user |
| POST | `/api/auth/token` | `{token,password?}`; use reset or verification token |
| GET | `/api/auth/google` | Start configured OAuth flow |
| PATCH | `/api/profile` | `{name}` |
| DELETE | `/api/account` | `{confirmation:"DELETE",password?}` |
| GET | `/api/tags` | Published topic and company-style filters |
| GET | `/api/questions` | `search,difficulty,topic,company,status,sort,page,limit` |
| GET | `/api/questions/:id` | Public content and pinned published version ID |
| GET | `/api/questions/:id/solution` | Reference solution unless active timed mock locks it |
| POST | `/api/questions/:id/bookmark` | `{bookmarked:boolean}` |
| POST | `/api/submissions` | `{versionId,query,dialect,mode,mockId?,position?}` |
| GET | `/api/submissions/:id` | Owner-only queue state, verdict and visible sample result |
| POST | `/api/mocks` | `{count,minutes,difficulty,topic?,company?,excludeSolved?,excludeRecent?,seed?,mode,dialect}` |
| GET | `/api/mocks` | Current user’s recent mocks |
| GET | `/api/mocks/:id` | Pinned questions, drafts, deadline and server time; completed reports |
| PUT | `/api/mocks/:id/draft` | `{position,query}`; rejected after deadline |
| POST | `/api/mocks/:id/finish` | Freeze saved answers and queue final grading |
| GET | `/api/dashboard` | Current user’s derived progress |
| GET | `/api/admin/questions` | All latest question versions |
| GET | `/api/admin/questions/:id` | Latest full content and version history |
| POST | `/api/admin/questions` | Save a full validated-structure question as a new draft version |
| POST | `/api/admin/import` | `{questions:[...]}`; 1–25 per request |
| GET | `/api/admin/export` | Latest full question bank, including private datasets |
| POST | `/api/admin/versions/:id/validate` | Queue both-engine reference validation |
| POST | `/api/admin/versions/:id/publish` | Publish a passed exact content version |
| POST | `/api/admin/questions/:id/unpublish` | Hide from new practice and mocks |
| DELETE | `/api/admin/questions/:id` | Archive, preserving history |
| GET | `/api/admin/status` | Worker, queue, infrastructure error and audit data |
| GET | `/api/health` | Database/Redis readiness |

`dialect` is `postgres` or `mysql`. Submission `mode` is `run` or `submit`; `final` is created only by assessment finalization. Assessment `mode` is `practice` or `timed`. Difficulty is `Easy`, `Medium`, `Hard`, or `Mixed` for mock creation. There are no fake-success responses if a database engine is unavailable.

Question JSON follows `packages/core/question.ts`. Expected outputs have positional `columns` with `text`, `number`, `boolean` or `date` comparison types and a `rows` matrix. `null` is represented as JSON null. `ordered=false` performs multiset comparison. Numeric tolerance is absolute, explicit per question and never automatically inferred from the learner’s output.
