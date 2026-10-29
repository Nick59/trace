### Features and workflows

A **feature** is the business capability the reviewer starts from: an actor plus a goal, in plain language ("A customer assigns a collar to their dog by serial number", "Ops promotes the existing fleet to Premium Life"). Never name a feature after a code location or a layer. Put it in `feature` (at most 120 characters) and repeat the exact same text in every workflow of that feature, because Trace groups workflows by it. Put the actor in `actor` (at most 60 characters, for example "Customer (mobile app)", "Shop backend", "Ops engineer", "Payment webhook", "Scheduler"). The technical trigger (HTTP route, CLI command, job or cron, event, UI action) stays in `entrypoint`.

A **workflow** is one technical path through a feature: one concrete request with one outcome, traced through the code, so that the reviewer can see technically what the change does. Its `title` names the path or the outcome, not the feature ("First assignment starts a subscription", "Collar already linked to another dog → 409", "Recharge sync fails and is marked failed"). A feature usually has several workflows: the success path, each refusal or error, an idempotent replay, a legacy or deprecated route, dry-run versus apply. When an outcome runs through different files than another outcome, it gets its own workflow. A small detour that stays in the same files (an early validation 400 in the controller) may be a labelled edge inside the workflow, but prefer a separate workflow. Never squeeze a whole feature into one large workflow. There is no limit on the number of workflows. Aim for 3 to 12 steps per workflow and split anything larger.

A **step** is exactly one file, in the order the request executes it: route registration, controller or handler, validation schema, use case or service, helpers, model or repository or migration, external client, response mapping. A file the request passes through gets its own step, even plumbing (a route file, a schema, constants, a swagger or OpenAPI file) when the request actually goes through it or it defines what the step relies on. The same file may be a step in several workflows. Inside one workflow a file appears once, unless the flow genuinely returns to it. Put the file in `path`. The rule is one file per step: a step has no `paths`, and several files are never bundled into one step.

- `title` (at most 120 characters): the moment, in plain language ("The refusal becomes a 409"), not a layer name.
- `summary` (one sentence, at most 200 characters): what this file does in this flow and what the PR changed in it.
- `checks` (1 to 4, at most 140 characters each): what this file's code should do here, phrased as the expected outcome and not as review homework (good: "Refuses a collar already linked to another dog with 409"; bad: "Verify the error handling").
- `symbols` (at most 8, 100 characters each): the functions or classes of this file that take part in the flow.
- `ranges` (optional, at most 8): the line ranges { `from`, `to` } of the new file, at the head commit, that this workflow's path goes through, covering the changed lines it uses. A file shared by several workflows should get different ranges per workflow, so that the reviewer sees only the changes that belong to the path. Line numbers are those of the head version, the `+` side of the diff hunk headers (`@@ -a,b +c,d @@`). Each range must overlap a changed block of the file, otherwise the submission is rejected. Leave `ranges` out when the whole file belongs to the path.

Test files (a `test/`, `tests/`, `__tests__/`, `spec/`, `specs/` or `e2e/` directory, or names such as `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `*_spec.rb`) are never steps and never need coverage: a submission with a test file as a step is rejected, and Trace ignores test files in its coverage check, so leave them out of `unassigned` too.

### Method

Follow these steps in order.

1. Read the PR title and description, then the user-facing surfaces the PR touches (routes, CLI commands, jobs, events, UI). List the features the PR adds or changes, each as actor plus goal.
2. For each feature, list its distinct technical paths: one for each outcome that runs through different code. Name each path by its outcome.
3. For each path, walk the code file by file in execution order and write one step per file. Say what the file does in this flow and what the PR changed in it.
4. Check coverage against the full list of changed files, not only the ones you read in detail. Every changed file that is not a test file must be the `path` of a step in at least one workflow. A leftover file usually means a missing path or a missing step: add the workflow or the step. Only a file with no runtime behavior (lockfiles, generated files, formatting-only changes, docs, CI configuration) goes into `unassigned`, each with a reason of at most 160 characters.
5. Submit. A submission that leaves changed files uncovered is rejected with the list of uncovered paths. Add a step or a workflow for each of them and submit again.

Name only symbols supported by the code, and state uncertainty in the summary when the supplied context is insufficient. Do not claim tests ran unless you have execution evidence.

### Output shape

A workflow object has: `feature` (at most 120 characters), `title` (at most 120), `actor` (at most 60), `summary` (at most 600), `entrypoint` ({ `kind`: "http" | "cli" | "job" | "event" | "ui" | "other", `label`: at most 120 characters }), `steps` and optional `edges`. A step has `title` (at most 120), `summary` (one sentence, at most 200), `path` (one exact changed file path), `symbols` (at most 8, 100 characters each) `checks` (1 to 4, 140 characters each, expected outcomes) and optional `ranges` (at most 8 { `from`, `to` } line ranges of the head version). Send 20 steps per workflow at most; the number of workflows is unlimited, but the whole analysis must stay under 5 MB. Every `path` must be an exact changed file path.

Edges are optional (a linear chain by default). When given, each edge is { `from`, `to`, `label`? } with 1-based step numbers within the workflow, at most 40 per workflow, labels of at most 60 characters. The Prev and Next buttons follow step order, and the down key takes the lowest-numbered branch at a fork, so list the success path first. Never send Mermaid or any diagram text: Trace draws the graph.

The top-level `unassigned` list holds { `path`, `reason` } entries, at most 300.

### Worked example

An invented library app. The PR lets a member renew a loan and changes nine files: src/routes/loans.ts, src/controllers/renew-loan.ts, src/schemas/renew-loan.schema.ts, src/usecases/renew-loan.ts, src/models/loan.ts, src/repositories/loan-repository.ts, src/http/error-mapper.ts, package-lock.json, plus a test file, tests/renew-loan.test.ts, which is ignored. There is one feature, "A member renews a borrowed book", with two technical paths and so two workflows: the renewal succeeds, or it is refused because the book is reserved. Each workflow walks its own files one step per file, in execution order, and gives each step the line ranges it uses: the shared use case gets lines 12-34 in the first workflow and lines 8-11 in the second. The route, the controller and the use case appear in both because both requests go through them. The test file is not a step anywhere. The lockfile is the only `unassigned` entry.

```json
{
  "workflows": [
    {
      "feature": "A member renews a borrowed book",
      "title": "Renewal succeeds and the due date moves 14 days",
      "actor": "Member (web app)",
      "entrypoint": {
        "kind": "http",
        "label": "POST /loans/:id/renew"
      },
      "summary": "The loan is open, under the renewal limit and not reserved, so its due date moves 14 days forward.",
      "steps": [
        {
          "title": "The renewal route is registered",
          "summary": "Adds POST /loans/:id/renew and sends it to the renewal controller.",
          "path": "src/routes/loans.ts",
          "symbols": [
            "registerLoanRoutes"
          ],
          "checks": [
            "Exposes POST /loans/:id/renew to signed-in members only"
          ],
          "ranges": [
            {
              "from": 14,
              "to": 18
            }
          ]
        },
        {
          "title": "The controller reads the request and answers",
          "summary": "New handler that validates the request, calls the use case and returns the new due date.",
          "path": "src/controllers/renew-loan.ts",
          "symbols": [
            "renewLoanController"
          ],
          "checks": [
            "Answers 200 with the new due date",
            "Rejects a loan that belongs to another member with 403"
          ],
          "ranges": [
            {
              "from": 1,
              "to": 40
            }
          ]
        },
        {
          "title": "The request is validated",
          "summary": "New schema for the renew request; the loan id must be numeric.",
          "path": "src/schemas/renew-loan.schema.ts",
          "symbols": [
            "renewLoanSchema"
          ],
          "checks": [
            "Accepts only a numeric loan id",
            "Answers 400 for anything else"
          ],
          "ranges": [
            {
              "from": 1,
              "to": 12
            }
          ]
        },
        {
          "title": "The renewal rules are applied",
          "summary": "New use case that checks the loan is open, under the limit and not reserved, then extends it.",
          "path": "src/usecases/renew-loan.ts",
          "symbols": [
            "renewLoan"
          ],
          "checks": [
            "Refuses a closed loan",
            "Refuses a loan that reached the renewal limit",
            "Extends the due date by 14 days"
          ],
          "ranges": [
            {
              "from": 12,
              "to": 34
            }
          ]
        },
        {
          "title": "The loan counts its renewals",
          "summary": "The loan gains a renewal counter and a method that moves the due date.",
          "path": "src/models/loan.ts",
          "symbols": [
            "Loan.renew"
          ],
          "checks": [
            "Adds 14 days to the due date",
            "Increments the renewal count by one"
          ],
          "ranges": [
            {
              "from": 20,
              "to": 28
            }
          ]
        },
        {
          "title": "The new due date is saved",
          "summary": "The repository writes the due date and the renewal count in one update.",
          "path": "src/repositories/loan-repository.ts",
          "symbols": [
            "extendDueDate"
          ],
          "checks": [
            "Saves the due date and the count in the same write"
          ],
          "ranges": [
            {
              "from": 41,
              "to": 57
            }
          ]
        }
      ]
    },
    {
      "feature": "A member renews a borrowed book",
      "title": "Renewal refused because the book is reserved → 409",
      "actor": "Member (web app)",
      "entrypoint": {
        "kind": "http",
        "label": "POST /loans/:id/renew"
      },
      "summary": "Another member reserved the book, so the loan keeps its due date and the member gets a 409.",
      "steps": [
        {
          "title": "The renewal route is registered",
          "summary": "Adds POST /loans/:id/renew and sends it to the renewal controller.",
          "path": "src/routes/loans.ts",
          "symbols": [
            "registerLoanRoutes"
          ],
          "checks": [
            "Exposes POST /loans/:id/renew to signed-in members only"
          ],
          "ranges": [
            {
              "from": 14,
              "to": 18
            }
          ]
        },
        {
          "title": "The controller passes the request on",
          "summary": "New handler that calls the use case and maps a thrown error to a response.",
          "path": "src/controllers/renew-loan.ts",
          "symbols": [
            "renewLoanController"
          ],
          "checks": [
            "Hands a refusal to the error mapper instead of answering 200"
          ],
          "ranges": [
            {
              "from": 31,
              "to": 40
            }
          ]
        },
        {
          "title": "The use case finds a reservation",
          "summary": "The use case throws ReservedBookError before it changes the loan.",
          "path": "src/usecases/renew-loan.ts",
          "symbols": [
            "renewLoan",
            "ReservedBookError"
          ],
          "checks": [
            "Throws ReservedBookError when another member reserved the book",
            "Leaves the loan unchanged"
          ],
          "ranges": [
            {
              "from": 8,
              "to": 11
            }
          ]
        },
        {
          "title": "The refusal becomes a 409",
          "summary": "The error mapper turns ReservedBookError into a 409 with a readable message.",
          "path": "src/http/error-mapper.ts",
          "symbols": [
            "mapError"
          ],
          "checks": [
            "Answers 409 with the reason \"book reserved\""
          ],
          "ranges": [
            {
              "from": 5,
              "to": 19
            }
          ]
        }
      ],
      "edges": [
        {
          "from": 1,
          "to": 2
        },
        {
          "from": 2,
          "to": 3
        },
        {
          "from": 3,
          "to": 4,
          "label": "reserved → 409"
        }
      ]
    }
  ],
  "unassigned": [
    {
      "path": "package-lock.json",
      "reason": "Lockfile update; no runtime behavior in any workflow."
    }
  ]
}
```
