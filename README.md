# Aristopharma MSFA — Mobile Lab

Test and debug harness for the **mobile APIs** (`api/v1/app/*`). Drives the real dev / UAT /
prod backend; it does not mock anything.

## Why it exists

Testing every mobile endpoint by hand in Postman is slow, and the cases that matter most —
the worst paths — are the hardest to set up because they need real preconditions: an
*approved* plan to edit, a *pending* one to decline, someone else's record to be refused
from. Mobile Lab makes a full end-to-end run repeatable in minutes, shows every payload, and
**derives** bad requests from good ones instead of making you hand-craft each.

## Setup

```bash
cd src/Aristopharma.MSFA.MobileLab
cp src/environments.sample.json src/environments.json   # then fill in the real base URLs
npm install
npm start
```

`src/environments.json` is gitignored — only the sample is committed.

Serves on **http://localhost:4300** (pinned in `angular.json`). The product SPA uses 44451,
so both can run at once.

## Independent of the Web project — by construction

Running `Aristopharma.MSFA.Web` in Rider or Visual Studio does **not** build or start Mobile
Lab. Three separate reasons, any one of which would be enough:

1. Mobile Lab has **no `.csproj`** and is **not in `Aristopharma.MSFA.sln`**, so it is not in
   the .NET project graph the run button builds.
2. The Web project's SPA targets (`DebugEnsureNodeEnv`, `PublishRunWebpack`) all run with
   `WorkingDirectory=$(SpaRoot)`, and `SpaRoot` is `ClientApp\`. Mobile Lab sits outside that
   folder entirely.
3. `SpaProxy` launches `npm start` in ClientApp only.

It also has its own `node_modules`, so its dependencies never interact with the product SPA's.
Run it when you want it, ignore it the rest of the time.

## The two things to understand

**1. `Platform: Mobile` changes everything.** With that header the transport status is **200
even on errors**, and the real code lives in the response envelope (`status`,
`statusCode`). Every step shows both, and the header is a visible per-step toggle.

**2. Scenarios are data, not code.** `src/scenarios/*.json` is the single source of truth. A
scenario is an ordered list of steps: a request template, what to `capture` into variables,
and what to `expect`. The engine (`src/app/core/engine.ts`) is framework-free on purpose, so
a Node CLI can run the same files in CI later without a rewrite.

## Safety

- Prod is **read-only by default**. Any non-GET is refused until you type the environment name
  to unlock; the unlock covers one run and then re-arms.
- Tokens live in memory and `sessionStorage` only — never `localStorage` — so they die with the
  tab.
- On dev and UAT the tool writes **real data**. That is the point. Scenarios prefer creating
  their own records over mutating pre-existing ones.

## Adding a module

Drop a new file in `src/scenarios/`, add it to `src/scenarios/index.json`. No TypeScript
changes needed unless the module needs a new payload builder.

## Promotional product and DCR (task 33)

The app has one promo endpoint, `GET /api/v1/app/dcr/promo-products`. Promo is issued inside DCR create, update and delete. `promo-product.json` covers the list; `dcr.json` covers issuing.

| Scenario | Proves |
| --- | --- |
| `promo.happy.disbursed-month` | a disbursed month returns items; every item has issued <= disbursed <= allocated; `isDisbursed` true |
| `promo.average.not-disbursed-empty` | a month the depot has not disbursed returns `[]`, even with HQ allocation |
| `promo.average.no-allocation-empty` | Jan 2099 and month 13 return 200 `[]`, not an error |
| `promo.average.manager-sees-area` | AM and RSM read the list for a territory they cover |
| `promo.worst.access-matrix` | 401 no/bad token; 403 admin, foreign or empty territory, another officer's call; 404 unknown call |
| `promo.worst.depot-admin-no-app` | a `DEPOT…` user is refused at app login (401), before any OTP is sent |
| `dcr.average.issue-capped-by-disbursed` | issue the whole remaining quantity; details show the month totals with remaining 0; one more unit is refused (400) |
| `dcr.worst.promo-not-disbursed` | promo on a call in an undisbursed month is refused (400); the same call without promo is saved |

Two assertion types were added for these: `expect.empty` (a list must be `[]`) and `expect.lte` (`[left, right]` pairs; `[*]` on both sides checks every item).

**Data needed:**
- one month the MIO's depot **has** disbursed;
- one month with allocation it **has not**;
- a depot admin user name, e.g. `DEPOT001`;
- for the manager scenario, a territory under the AM/RSM.

`dcr.average.issue-capped-by-disbursed` uses up one item's whole remaining stock, so run it on dev/UAT only.
