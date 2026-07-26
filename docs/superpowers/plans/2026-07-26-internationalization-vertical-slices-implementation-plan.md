# Money Whisperer Internationalization Vertical Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Money Whisperer to complete `zh-CN` and `en-US` support by implementing language settings first, then finishing one page or business module end to end before committing and pushing that slice.

**Architecture:** Establish one shared `next-intl` locale runtime and persistent user language preference, then migrate vertically by product surface. A slice is complete only when its UI, API errors, service fallbacks, generated content, locale metadata, tests, and hardcoded-text audit all pass together.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, `next-intl` 4.13.4, SQLite, Drizzle, Mastra, Zod, Vitest, Playwright, GitHub Actions, Docker Compose.

---

## Source Specification

The approved design is:

`docs/superpowers/specs/2026-07-26-internationalization-upgrade-design.md`

This document is the only implementation plan for the internationalization initiative.

## Delivery Rules

### One Vertical Slice At A Time

After the language-setting foundation, execute tasks in the order listed below.

Do not begin the next page or module until the current slice has:

```text
[ ] zh-CN messages
[ ] en-US messages
[ ] UI text and accessibility text migrated
[ ] locale-aware date, number, percent, and CNY formatting
[ ] related API errors localized
[ ] related service fallback text localized
[ ] related Agent/report/notification content localized, when applicable
[ ] persisted content locale, when applicable
[ ] focused unit/API tests
[ ] zh-CN and en-US Playwright coverage
[ ] module hardcoded-text audit
[ ] commit
[ ] push
```

### Commit And Push Gate

At the end of every task:

```bash
git status --short
git diff --check
git diff --name-only -- <slice pathspecs>
git add <only the exact changed files owned by this slice>
git diff --cached --name-only
git diff --cached --check
git commit -m "<task commit message>"
git push origin HEAD
```

Rules:

- Never stage unrelated dirty-worktree files.
- Do not use `git add .`.
- Directory pathspecs shown later are ownership scopes, not permission to stage every dirty file below that directory. Expand them with `git diff --name-only -- <pathspec>`, then pass only the reviewed exact file paths to `git add`.
- If a file already contained unrelated changes before the slice, stage only the slice hunks with `git add -p -- <file>` and inspect `git diff --cached -- <file>`.
- Before committing, `git diff --cached --name-only` must match the slice file list and `git diff --cached --check` must exit `0`.
- If the push is rejected because the remote advanced, stop and inspect:

```bash
git fetch origin
git log --oneline --left-right --graph HEAD...@{upstream}
```

- Integrate remote changes without discarding user work, rerun the slice gate, then push.
- A local commit without a successful push does not complete the task.
- If a later repository-wide audit finds a missed file, return to that file's owning slice, complete its focused gate, commit, and push the correction before continuing.

### Shared Locale Contracts

```ts
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type ContentLocale = AppLocale | "und";

export type LocaleContext = {
  locale: AppLocale;
  source: "a2a-parameter" | "account" | "cookie" | "accept-language" | "default";
  acceptLanguage: string | null;
};
```

Web precedence:

```text
users.preferred_locale
  > mw_locale cookie
  > Accept-Language
  > zh-CN
```

A2A precedence:

```text
explicit locale parameter
  > Accept-Language
  > zh-CN
```

Stable machine fields, enums, error codes, IDs, symbols, dates, and numeric facts are never translated.

### Migration Number

Current migrations end at `0015`; the approved watchlist implementation plan reserves `0016_complete_watchlist_observation.sql`, and another pending A2A plan also proposes an `0016` file.

Use:

```text
src/server/db/migrations/0017_add_internationalization.sql
```

Before implementation:

```bash
find src/server/db/migrations -maxdepth 1 -type f -name '*.sql' | sort
```

If `0017` is occupied, use the next unused version and update migration test expectations only.

The migration runner tracks complete migration filenames, so reserving `0017` is intentional even when `0016` has not yet landed. Do not rename or renumber existing migration files.

## Task 1: Implement The Language-Setting Foundation First

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `next.config.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/features/frontend-migration/query-provider.tsx`
- Modify: `src/features/frontend-migration/api.ts`
- Modify: `src/features/workbench/lib/api.ts`
- Modify: `src/features/frontend-migration/auth.tsx`
- Modify: `src/hooks/useAuth.tsx`
- Modify: `src/server/auth/contracts.ts`
- Modify: `src/server/auth/service.ts`
- Modify: `src/server/auth/http.ts`
- Modify: `src/server/http/context.ts`
- Create: `src/server/http/api-response.ts`
- Create: `src/server/http/api-response.test.ts`
- Create: `src/server/http/api-errors.ts`
- Create: `src/server/http/api-errors.test.ts`
- Modify: `src/server/extensions/middleware/idempotency.ts`
- Modify: `src/server/extensions/middleware/idempotency.test.ts`
- Modify: `src/proxy.ts`
- Create: `src/proxy.test.ts`
- Modify: `src/app/api/v1/auth/login/route.ts`
- Modify: `src/app/api/v1/auth/register/route.ts`
- Modify: `src/app/api/v1/auth/me/route.ts`
- Modify: `src/app/api/v1/auth/logout/route.ts`
- Modify: `src/app/api/v1/profile/route.ts`
- Create: `src/app/api/v1/profile/locale/route.ts`
- Create: `src/app/api/v1/profile/locale/route.test.ts`
- Modify: `src/app/api/v1/auth/auth.test.ts`
- Modify: `src/server/db/schema/core.ts`
- Modify: `src/server/db/schema/artifacts.ts`
- Modify: `src/server/db/schema/artifacts.test.ts`
- Modify: `src/server/db/schema/simulation-branches.ts`
- Modify: `src/server/db/schema/simulation-branches.zod.ts`
- Modify: `src/server/db/schema/simulation-branches.test.ts`
- Modify: `src/server/db/schema/watchlists.ts`
- Modify: `src/server/db/schema/watchlists.zod.ts`
- Modify: `src/server/db/schema/watchlists.test.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/migration-runner.test.ts`
- Create: `src/server/db/migrations/0017_add_internationalization.sql`
- Create: `src/server/db/schema/internationalization.ts`
- Create: `src/server/db/schema/internationalization.test.ts`
- Create: `src/i18n/config.ts`
- Create: `src/i18n/config.test.ts`
- Create: `src/i18n/resolve-locale.ts`
- Create: `src/i18n/resolve-locale.test.ts`
- Create: `src/i18n/locale-context.ts`
- Create: `src/i18n/messages.ts`
- Create: `src/i18n/messages.test.ts`
- Create: `src/i18n/request.ts`
- Create: `src/i18n/formatters.ts`
- Create: `src/i18n/formatters.test.ts`
- Create: `src/i18n/errors.ts`
- Create: `src/i18n/errors.test.ts`
- Create: `src/i18n/messages/zh-CN/common.json`
- Create: `src/i18n/messages/zh-CN/auth.json`
- Create: `src/i18n/messages/zh-CN/errors.json`
- Create: `src/i18n/messages/en-US/common.json`
- Create: `src/i18n/messages/en-US/auth.json`
- Create: `src/i18n/messages/en-US/errors.json`
- Create: `src/components/desktop/LanguageSelector.tsx`
- Create: `src/components/desktop/LanguageSelector.test.tsx`
- Modify: `src/features/workbench/pages/LoginPage.tsx`
- Modify: `src/app/(workbench)/settings/page.tsx`
- Modify: `src/components/desktop/TopNavigation.tsx`
- Create: `tests/e2e/language-settings.spec.ts`
- Modify: `tests/helpers/auth.ts`

- [ ] **Step 1: Write failing locale-core tests**

Create tests for:

```ts
expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en-US"]);
expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
expect(normalizeLocale("en-GB")).toBe("en-US");
expect(normalizeLocale("ja-JP")).toBeNull();
```

Test precedence:

```ts
expect(resolveWebLocale({
  accountLocale: "en-US",
  cookieLocale: "zh-CN",
  acceptLanguage: "zh-CN",
})).toMatchObject({ locale: "en-US", source: "account" });
```

Test `Accept-Language` q-values and the default `zh-CN` fallback.

- [ ] **Step 2: Run locale tests and verify RED**

```bash
pnpm vitest run src/i18n/config.test.ts src/i18n/resolve-locale.test.ts
```

Expected: FAIL because the locale modules do not exist.

- [ ] **Step 3: Install and configure `next-intl`**

```bash
pnpm add next-intl@4.13.4
```

Configure `next.config.ts`:

```ts
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
```

Implement `AppLocale`, `ContentLocale`, normalization, Cookie name, and both resolution functions.

- [ ] **Step 4: Write and implement message-catalog tests**

The initial catalogs must include:

```text
common.app
common.metadata
common.language
common.actions
auth.login
auth.register
auth.account
auth.settings
errors.UNAUTHENTICATED
errors.VALIDATION_ERROR
errors.INTERNAL_ERROR
```

Test that `zh-CN` and `en-US` have identical leaf keys and ICU parameters.

Run:

```bash
pnpm vitest run src/i18n/messages.test.ts
```

Expected: PASS after `loadMessages()` is implemented.

- [ ] **Step 5: Write and implement formatter tests**

Create shared:

```ts
formatCny(value, locale, options)
formatNumber(value, locale, options)
formatPercent(value, locale, options)
formatDate(value, locale, options)
formatDateTime(value, locale, options)
```

Assert:

```ts
expect(formatCny(123456, "en-US")).toContain("CN¥");
expect(formatPercent(0.125, "en-US")).toBe("12.5%");
expect(formatDateTime("invalid", "en-US", { fallback: "—" })).toBe("—");
```

- [ ] **Step 6: Write the migration test before the migration**

The migration test must assert these columns:

```text
users.preferred_locale
conversation_sessions.title_locale
messages.content_locale
agent_runs.requested_locale
recommendations.content_locale
notifications.content_locale
generated_artifacts.content_locale
generated_artifact_versions.content_locale
simulation_option_batches.content_locale
information_requests.content_locale
evidence_items.source_locale
evidence_items.summary_locale
evidence_items.translation_metadata_json
rss_items.source_locale
```

It must also assert the `evidence_item_translations` table exists.

Also verify:

```text
schema_migrations contains 0017_add_internationalization.sql
PRAGMA user_version equals the highest migration prefix present at test time
users.preferred_locale remains NULL for legacy users
all historical generated-content locale fields are zh-CN
message/recommendation/artifact/evidence content hashes are unchanged
unsupported locale values are rejected by database constraints
```

Do not hardcode the total migration-file count because `0016` may land before or after this slice.

- [ ] **Step 7: Implement the backward-compatible migration**

Add `preferred_locale` as nullable:

```sql
ALTER TABLE users ADD COLUMN preferred_locale TEXT
  CHECK(preferred_locale IS NULL OR preferred_locale IN ('zh-CN','en-US'));
```

Add content locale columns with default `zh-CN`, so historical rows are backfilled without rewriting their content.

Create:

```sql
CREATE TABLE evidence_item_translations (
  id TEXT PRIMARY KEY,
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  target_locale TEXT NOT NULL CHECK(target_locale IN ('zh-CN','en-US')),
  title_text TEXT,
  summary_text TEXT NOT NULL,
  source_content_sha256 TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  translated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(evidence_item_id, target_locale, source_content_sha256)
);
```

Update the owning Drizzle and Zod contracts in `core.ts`, `artifacts.ts`, `simulation-branches.ts`, and `watchlists.ts`. Add the currently missing `informationRequests` Drizzle table declaration to `core.ts`, including `contentLocale`.

- [ ] **Step 8: Build the shared API locale and response boundary**

Implement:

```ts
apiSuccess(request, data, options)
apiError(request, code, details, options)
apiNoContent(request, options)
```

The helpers must set `Content-Language`, preserve the existing `meta` shape, keep stable error codes/details, and localize only the user-facing `message`.

Tests must cover:

```text
zh-CN and en-US success responses
zh-CN and en-US errors with identical status/code/details
204 responses with Content-Language
Zod issues normalized to stable field details
unknown service exceptions mapped to INTERNAL_ERROR without leaking raw text
```

Update `src/proxy.ts` so Origin and CSRF failures use the same locale resolver and error catalog without weakening the existing security checks.

- [ ] **Step 9: Make idempotency locale-safe**

Include `AppLocale` in the idempotency operation key or request hash. A replay with the same business payload and idempotency key in another locale must not return a response body localized for the old locale.

Add a regression test to `src/server/extensions/middleware/idempotency.test.ts` that saves a Chinese response and verifies an English request does not replay it as English content.

- [ ] **Step 10: Extend authenticated request context**

`AuthUser` adds:

```ts
preferredLocale: AppLocale | null;
```

`getRequestContext(request)` returns:

```ts
{
  userId,
  sessionId,
  user,
  locale: LocaleContext
}
```

Resolve authenticated requests using account > Cookie > header > default.

- [ ] **Step 11: Write locale-preference API tests**

Test:

```text
PATCH /api/v1/profile/locale {"locale":"en-US"}
  -> 200
  -> users.preferred_locale = en-US
  -> Set-Cookie contains mw_locale=en-US
  -> Content-Language: en-US
```

Test unsupported locale:

```text
{"locale":"ja-JP"} -> 422 VALIDATION_ERROR
```

Test login:

- Account preference overrides an existing Cookie.
- Account with `NULL` preference preserves the current valid Cookie.
- `/auth/me` returns `preferredLocale`.

- [ ] **Step 12: Implement the locale endpoint and Cookie helpers**

Create:

```ts
setLocaleCookie(response, locale, request?)
clearSessionCookies(response) // must not delete mw_locale
```

`PATCH /api/v1/profile/locale` must update the user row and Cookie in one successful response.

- [ ] **Step 13: Send the active locale from both API clients**

Update both:

```text
src/features/frontend-migration/api.ts
src/features/workbench/lib/api.ts
```

Every request sends:

```http
Accept-Language: <active AppLocale>
```

Do not derive the header independently in each service. Read the canonical `mw_locale` Cookie through one helper.

- [ ] **Step 14: Make the root layout and provider request-aware**

`src/app/layout.tsx` must:

- Read `getLocale()` and `getMessages()`.
- Set dynamic `<html lang>`.
- Generate localized Metadata.
- Pass messages to `FrontendProviders`.

Wrap the existing provider tree exactly once with `NextIntlClientProvider`.

- [ ] **Step 15: Implement one reusable language selector**

`LanguageSelector` uses a compact dropdown or segmented menu with:

```text
简体中文
English
```

Behavior:

- Logged out: set Cookie and call `router.refresh()`.
- Logged in: call `PATCH /api/v1/profile/locale`, refresh auth state, then `router.refresh()`.
- Preserve current URL, search params, and form state where React permits.
- Show localized loading and failure feedback.

- [ ] **Step 16: Put the selector in all required locations**

Add it to:

- Login page, visible before authentication.
- Top account/navigation area.
- Settings page as an explicit language section.

Migrate the fixed text in those three surfaces now; their deeper module content is handled in later tasks.

- [ ] **Step 17: Add bilingual Playwright coverage**

Create `tests/e2e/language-settings.spec.ts`:

```text
1. Visit /login with Accept-Language en-US and no Cookie -> English login UI.
2. Switch to 简体中文 -> Chinese UI and mw_locale Cookie.
3. Register/login, switch to English in settings.
4. Reload -> English remains.
5. Open a second authenticated browser context -> account preference resolves to English.
6. Switch back from TopNavigation -> Chinese remains after reload.
7. URL path never gains a locale prefix.
```

- [ ] **Step 18: Run the language-setting gate**

```bash
pnpm vitest run src/i18n src/server/http src/server/extensions/middleware/idempotency.test.ts src/proxy.test.ts src/server/db/migration-runner.test.ts src/server/db/schema/internationalization.test.ts src/server/db/schema/artifacts.test.ts src/server/db/schema/simulation-branches.test.ts src/server/db/schema/watchlists.test.ts src/app/api/v1/auth src/app/api/v1/profile/locale
pnpm lint
pnpm typecheck
pnpm build
pnpm playwright test tests/e2e/language-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 19: Commit and push the foundation**

```bash
git add package.json pnpm-lock.yaml next.config.ts \
  src/i18n src/app/layout.tsx \
  src/features/frontend-migration/query-provider.tsx \
  src/features/frontend-migration/api.ts \
  src/features/workbench/lib/api.ts \
  src/features/frontend-migration/auth.tsx src/hooks/useAuth.tsx \
  src/server/auth src/server/http/context.ts \
  src/server/http/api-response.ts src/server/http/api-response.test.ts \
  src/server/http/api-errors.ts src/server/http/api-errors.test.ts \
  src/server/extensions/middleware/idempotency.ts \
  src/server/extensions/middleware/idempotency.test.ts \
  src/proxy.ts src/proxy.test.ts \
  src/app/api/v1/auth src/app/api/v1/profile/locale \
  src/server/db/migrations/0017_add_internationalization.sql \
  src/server/db/schema/core.ts src/server/db/schema/index.ts \
  src/server/db/schema/artifacts.ts src/server/db/schema/artifacts.test.ts \
  src/server/db/schema/simulation-branches.ts \
  src/server/db/schema/simulation-branches.zod.ts \
  src/server/db/schema/simulation-branches.test.ts \
  src/server/db/schema/watchlists.ts src/server/db/schema/watchlists.zod.ts \
  src/server/db/schema/watchlists.test.ts \
  src/server/db/schema/internationalization.ts \
  src/server/db/schema/internationalization.test.ts \
  src/server/db/migration-runner.test.ts \
  src/components/desktop/LanguageSelector.tsx \
  src/components/desktop/LanguageSelector.test.tsx \
  src/features/workbench/pages/LoginPage.tsx \
  'src/app/(workbench)/settings/page.tsx' \
  src/components/desktop/TopNavigation.tsx \
  tests/e2e/language-settings.spec.ts tests/helpers/auth.ts
git commit -m "feat: add persistent language settings"
git push origin HEAD
```

## Task 2: Complete Login, Registration, Password, And Account Internationalization

**Module completion boundary:** Authentication and account pages, their APIs, and auth errors.

**Files:**

- Modify: `src/i18n/messages/zh-CN/auth.json`
- Modify: `src/i18n/messages/en-US/auth.json`
- Modify: `src/i18n/messages/zh-CN/errors.json`
- Modify: `src/i18n/messages/en-US/errors.json`
- Modify: `src/features/workbench/pages/LoginPage.tsx`
- Modify: `src/app/(workbench)/auth/password/page.tsx`
- Modify: `src/app/(workbench)/settings/page.tsx`
- Modify: `src/features/workbench/pages/ProfilePage.tsx` only for account summary strings
- Modify: `src/server/auth/service.ts`
- Modify: `src/server/auth/http.ts`
- Modify: `src/app/api/v1/auth/login/route.ts`
- Modify: `src/app/api/v1/auth/register/route.ts`
- Modify: `src/app/api/v1/auth/password/route.ts`
- Modify: `src/app/api/v1/auth/logout/route.ts`
- Modify: `src/app/api/v1/auth/auth.test.ts`
- Modify: `src/features/frontend-migration/auth.tsx`
- Modify: `src/hooks/useAuth.tsx`
- Create: `tests/e2e/auth-locales.spec.ts`

- [ ] **Step 1: Write bilingual auth API contract tests**

For each relevant error, call the API with both locales and assert:

```text
same HTTP status
same error.code
localized error.message
Content-Language matches request/account preference
```

Cover:

```text
INVALID_CREDENTIALS
USERNAME_EXISTS
REGISTRATION_DISABLED
RATE_LIMITED
ACCOUNT_DISABLED
VALIDATION_ERROR
CURRENT_PASSWORD_INCORRECT
```

- [ ] **Step 2: Centralize auth error codes**

`AuthFailure` keeps stable codes. `authError(request, error)` resolves localized messages from the error catalog instead of exposing the English constructor message.

- [ ] **Step 3: Migrate the full login/register/password/settings/account UI**

Move every heading, label, placeholder, button, Toast, ARIA label, loading state, and disclaimer into `auth.json`.

- [ ] **Step 4: Add bilingual auth E2E**

Test sign-up, duplicate username, wrong password, password change, logout, and relogin in both languages.

- [ ] **Step 5: Run the module gate**

```bash
pnpm vitest run src/app/api/v1/auth src/i18n/errors.test.ts
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/auth-locales.spec.ts tests/e2e/language-settings.spec.ts
rg -n '[\p{Han}]' src/features/workbench/pages/LoginPage.tsx 'src/app/(workbench)/auth/password/page.tsx' 'src/app/(workbench)/settings/page.tsx' src/server/auth --glob '*.{ts,tsx}'
```

Expected: remaining Han text only in message catalogs or explicit test fixtures.

- [ ] **Step 6: Commit and push**

```bash
git add src/i18n/messages src/features/workbench/pages/LoginPage.tsx \
  'src/app/(workbench)/auth/password/page.tsx' \
  'src/app/(workbench)/settings/page.tsx' \
  src/features/workbench/pages/ProfilePage.tsx \
  src/server/auth src/app/api/v1/auth \
  src/features/frontend-migration/auth.tsx src/hooks/useAuth.tsx \
  tests/e2e/auth-locales.spec.ts
git commit -m "feat: internationalize authentication and account"
git push origin HEAD
```

## Task 3: Complete Onboarding, Risk Assessment, Profile, And Goals

**Module completion boundary:** The complete first-use and financial-profile workflow.

**Files:**

- Create: `src/i18n/messages/zh-CN/onboarding.json`
- Create: `src/i18n/messages/en-US/onboarding.json`
- Create: `src/i18n/messages/zh-CN/profile.json`
- Create: `src/i18n/messages/en-US/profile.json`
- Create: `src/i18n/messages/zh-CN/goals.json`
- Create: `src/i18n/messages/en-US/goals.json`
- Modify: `src/lib/risk-assessment.ts`
- Modify: `src/lib/risk-assessment.test.ts`
- Modify: `src/app/api/v1/risk-questionnaire/route.ts`
- Modify: `src/app/api/v1/risk-assessments/route.ts`
- Modify: `src/app/api/v1/onboarding/complete/route.ts`
- Modify: `src/app/api/v1/onboarding/complete/route.test.ts`
- Modify: `src/app/api/v1/profile/route.ts`
- Modify: `src/app/api/v1/profile/complete/route.ts`
- Modify: `src/app/api/v1/profile/route.test.ts`
- Modify: `src/app/api/v1/goals/route.ts`
- Modify: `src/app/api/v1/goals/[id]/route.ts`
- Modify: `src/services/profileService.ts`
- Modify: `src/services/goalService.ts`
- Modify: `src/components/desktop/OnboardingGate.tsx`
- Modify: `src/features/workbench/pages/ProfilePage.tsx`
- Modify: `src/features/workbench/pages/GoalsPage.tsx`
- Modify: `src/app/(workbench)/risk-assessments/page.tsx`
- Create: `tests/e2e/onboarding-locales.spec.ts`

- [ ] **Step 1: Separate scoring data from translated labels**

`RISK_QUESTIONS` becomes stable scoring definitions:

```ts
{
  id: "financial_stability",
  dimension: "CAPACITY",
  options: [
    { value: "surplus", score: 5 },
    ...
  ]
}
```

Prompts, helpers, option labels, risk-level labels, and conflict explanations move to `onboarding.json`.

`evaluateRiskAssessment()` returns stable conflict codes:

```text
WILLINGNESS_EXCEEDS_CAPACITY
CAPACITY_EXCEEDS_WILLINGNESS
```

The API maps them to localized display text.

- [ ] **Step 2: Write failing risk and API tests**

Assert the same answers produce identical:

```text
riskLevel
score
capacityLevel
willingnessLevel
recommendedMaxEquityWeight
```

for both request languages, while labels and conflicts differ by language.

- [ ] **Step 3: Migrate onboarding/profile/goals APIs and services**

Localize validation errors and remove service-thrown Chinese defaults such as `"目标不存在"`.

- [ ] **Step 4: Migrate all workflow UI**

Cover every step title, validation Toast, form label, placeholder, button, risk result, goal status, and date/CNY format.

- [ ] **Step 5: Add bilingual E2E**

Run the complete onboarding flow in `zh-CN` and `en-US`, asserting that saved answer values are identical.

- [ ] **Step 6: Run the module gate**

```bash
pnpm vitest run src/lib/risk-assessment.test.ts src/app/api/v1/risk-assessments src/app/api/v1/risk-questionnaire src/app/api/v1/onboarding src/app/api/v1/profile src/app/api/v1/goals
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/onboarding-locales.spec.ts tests/e2e/onboarding-mobile-layout.spec.ts
```

- [ ] **Step 7: Commit and push**

```bash
git add src/i18n/messages src/lib/risk-assessment.ts src/lib/risk-assessment.test.ts \
  src/app/api/v1/risk-questionnaire src/app/api/v1/risk-assessments \
  src/app/api/v1/onboarding src/app/api/v1/profile src/app/api/v1/goals \
  src/services/profileService.ts src/services/goalService.ts \
  src/components/desktop/OnboardingGate.tsx \
  src/features/workbench/pages/ProfilePage.tsx \
  src/features/workbench/pages/GoalsPage.tsx \
  'src/app/(workbench)/risk-assessments/page.tsx' \
  tests/e2e/onboarding-locales.spec.ts
git commit -m "feat: internationalize onboarding profile and goals"
git push origin HEAD
```

## Task 4: Complete Shared Shell, Navigation, And Home

**Module completion boundary:** Every shared shell plus the investment overview home page.

**Files:**

- Create: `src/i18n/messages/zh-CN/navigation.json`
- Create: `src/i18n/messages/en-US/navigation.json`
- Create: `src/i18n/messages/zh-CN/home.json`
- Create: `src/i18n/messages/en-US/home.json`
- Modify: `src/components/desktop/TopNavigation.tsx`
- Modify: `src/layouts/desktop/MainLayout.tsx`
- Modify: `src/features/workbench/components/app-shell.tsx`
- Modify: `src/app/(workbench)/layout.tsx`
- Modify: `src/features/workbench/components/shared.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/drawer.tsx`
- Modify: `src/components/ui/sheet.tsx`
- Modify: `src/components/ui/carousel.tsx`
- Modify: `src/components/ui/breadcrumb.tsx`
- Modify: `src/components/ui/pagination.tsx`
- Modify: `src/components/ui/loader.tsx`
- Modify: `src/features/workbench/pages/HomePage.tsx`
- Modify: `src/components/desktop/RecommendationCard.tsx`
- Modify: `src/components/desktop/AgentTheater.tsx`
- Modify: `src/components/desktop/GoalProgress.tsx`
- Modify: `src/services/recommendationService.ts` for daily-workflow fixed prompts and UI fallbacks
- Modify: `src/services/recommendationService.test.ts`
- Create: `tests/e2e/home-locales.spec.ts`

- [ ] **Step 1: Migrate the active app shell and resolve the unused shell**

The routed application currently owns shell behavior in `src/layouts/desktop/MainLayout.tsx` and `src/components/desktop/TopNavigation.tsx`. `src/features/workbench/components/app-shell.tsx` currently has no callers.

Localize the active shell. For `app-shell.tsx`, either:

```text
delete it after proving it has no references
or keep it only if a concrete route/import is added in this slice, then localize it with the same keys
```

Do not maintain two unconnected translated navigation implementations.

- [ ] **Step 2: Migrate shared UI primitive accessibility text**

Move built-in `Close`, `Previous`, `Next`, pagination, breadcrumb, loading, and `sr-only` labels in the listed `src/components/ui` files to shared messages. Add focused component tests for both locales.

- [ ] **Step 3: Migrate home cards and daily recommendation entry**

Localize all fixed progress and fallback text. The actual generated recommendation content is completed in the Advisor slice.

- [ ] **Step 4: Replace home formatting**

Remove direct `zh-CN` date and number formatting from home and its components.

- [ ] **Step 5: Add bilingual desktop/mobile tests**

Assert navigation, home headings, recommendation empty/loading states, and no layout overflow.

- [ ] **Step 6: Run, commit, and push**

```bash
pnpm vitest run src/services/recommendationService.test.ts src/i18n src/components/ui
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/home-locales.spec.ts tests/e2e/home-daily-advice.spec.ts
git add src/i18n/messages src/components/desktop/TopNavigation.tsx \
  src/layouts/desktop/MainLayout.tsx src/features/workbench/components/app-shell.tsx \
  'src/app/(workbench)/layout.tsx' src/features/workbench/components/shared.tsx \
  src/components/ui/dialog.tsx src/components/ui/drawer.tsx src/components/ui/sheet.tsx \
  src/components/ui/carousel.tsx src/components/ui/breadcrumb.tsx \
  src/components/ui/pagination.tsx src/components/ui/loader.tsx \
  src/features/workbench/pages/HomePage.tsx src/components/desktop/RecommendationCard.tsx \
  src/components/desktop/AgentTheater.tsx src/components/desktop/GoalProgress.tsx \
  src/services/recommendationService.ts src/services/recommendationService.test.ts \
  tests/e2e/home-locales.spec.ts
git commit -m "feat: internationalize navigation and home"
git push origin HEAD
```

## Task 5: Complete Assets And Portfolio Analysis

**Module completion boundary:** Instrument search, holdings CRUD/parse, portfolio refresh, asset page, and analysis view.

**Files:**

- Create: `src/i18n/messages/zh-CN/assets.json`
- Create: `src/i18n/messages/en-US/assets.json`
- Modify: `src/features/workbench/pages/AssetsPage.tsx`
- Modify: `src/app/(workbench)/analysis/page.tsx`
- Modify: `src/components/desktop/AShareInstrumentPicker.tsx`
- Modify: `src/components/desktop/AssetOverviewPanel.tsx`
- Modify: `src/components/desktop/AllocationPanel.tsx`
- Modify: `src/components/desktop/HealthMetrics.tsx`
- Modify: `src/components/desktop/DrawdownChart.tsx`
- Modify: `src/lib/financialHealth.ts`
- Modify: `src/lib/financialHealth.test.ts`
- Modify: `src/types/app/asset.ts`
- Modify: `src/services/holdingsService.ts`
- Modify: `src/app/api/v1/holdings/route.ts`
- Modify: `src/app/api/v1/holdings/route.test.ts`
- Modify: `src/app/api/v1/holdings/[id]/route.ts`
- Modify: `src/app/api/v1/holdings/parse/route.ts`
- Modify: `src/app/api/v1/holdings/parse/route.test.ts`
- Modify: `src/app/api/v1/holdings/parse/[parseId]/confirm/route.ts`
- Modify: `src/app/api/v1/instruments/[id]/route.ts`
- Modify: `src/app/api/v1/instruments/resolve/route.ts`
- Modify: `src/app/api/v1/instruments/search/route.ts`
- Modify: `src/app/api/v1/instruments/search/route.test.ts`
- Modify: `src/app/api/v1/instruments/sync/route.ts`
- Modify: `src/app/api/v1/portfolio-analysis/holdings/route.ts`
- Modify: `src/app/api/v1/portfolio-analysis/metrics/route.ts`
- Modify: `src/app/api/v1/portfolio-analysis/refresh/route.ts`
- Modify: `src/app/api/v1/portfolio-analysis/refresh/route.test.ts`
- Modify: `src/app/api/v1/portfolio-analysis/trends/route.ts`
- Modify: `src/app/api/v1/portfolio-analysis/trends/route.test.ts`
- Modify: `tests/e2e/holdings-editor.spec.ts`
- Modify: `tests/e2e/instrument-search.spec.ts`
- Create: `tests/e2e/assets-locales.spec.ts`

- [ ] **Step 1: Localize APIs and services first**

Stable error codes replace direct messages for missing instruments, invalid holding data, duplicate holdings, stale version, and market refresh failures.

- [ ] **Step 2: Migrate asset and analysis UI**

Cover manual entry, natural-language parse confirmation, catalog sync, holdings table, health metrics, chart labels, price quality, CNY, dates, and accessible names.

`src/lib/financialHealth.ts` and `src/types/app/asset.ts` must expose stable machine values rather than Chinese display labels. Translate those values only in UI/report renderers.

- [ ] **Step 3: Preserve instrument identities**

Do not translate source instrument names. English UI renders original name plus symbol.

- [ ] **Step 4: Run, commit, and push**

```bash
pnpm vitest run src/lib/financialHealth.test.ts src/app/api/v1/holdings src/app/api/v1/instruments src/app/api/v1/portfolio-analysis
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/assets-locales.spec.ts tests/e2e/holdings-editor.spec.ts tests/e2e/instrument-search.spec.ts
git add src/i18n/messages src/features/workbench/pages/AssetsPage.tsx \
  'src/app/(workbench)/analysis/page.tsx' src/components/desktop/AShareInstrumentPicker.tsx \
  src/components/desktop/AssetOverviewPanel.tsx src/components/desktop/AllocationPanel.tsx \
  src/components/desktop/HealthMetrics.tsx src/components/desktop/DrawdownChart.tsx \
  src/lib/financialHealth.ts src/lib/financialHealth.test.ts src/types/app/asset.ts \
  src/services/holdingsService.ts src/app/api/v1/holdings \
  src/app/api/v1/instruments src/app/api/v1/portfolio-analysis \
  tests/e2e/assets-locales.spec.ts tests/e2e/holdings-editor.spec.ts tests/e2e/instrument-search.spec.ts
git commit -m "feat: internationalize assets and portfolio analysis"
git push origin HEAD
```

## Task 6: Complete Advisor Conversations And Recommendations

**Module completion boundary:** Conversations, SSE progress, professional Agents, clarification, recommendations, and recommendation detail.

**Files:**

- Create: `src/i18n/messages/zh-CN/advisor.json`
- Create: `src/i18n/messages/en-US/advisor.json`
- Modify: `src/server/extensions/advisor/types.ts`
- Modify: `src/server/extensions/advisor/service.ts`
- Modify: `src/server/extensions/advisor/professional.ts`
- Modify: `src/server/extensions/advisor/professional-contracts.ts`
- Modify: `src/server/extensions/advisor/clarification-service.ts`
- Modify: `src/server/extensions/advisor/decision-summary.ts`
- Modify: `src/server/extensions/advisor/decision-summary.test.ts`
- Modify: `src/server/extensions/advisor/professional-prompt.test.ts`
- Modify: `src/server/extensions/advisor/professional-routing.test.ts`
- Modify: `src/server/extensions/advisor/professional.test.ts`
- Modify: `src/server/extensions/advisor/evidence-observation-time.test.ts`
- Modify: `src/mastra/agents/chief-advisor.ts`
- Modify: `src/mastra/agents/chief-advisor.test.ts`
- Create: `src/server/extensions/sse/localize-event.ts`
- Create: `src/server/extensions/sse/localize-event.test.ts`
- Modify: `src/server/extensions/sse/event-persister.ts`
- Modify: `src/server/extensions/sse/event-persister.test.ts`
- Modify: `src/services/advisorService.ts`
- Modify: `src/services/recommendationService.ts`
- Modify: `src/features/workbench/pages/AdvisorPage.tsx`
- Modify: `src/features/workbench/pages/RecommendationDetailPage.tsx`
- Modify: `src/features/workbench/pages/WorkbenchExpansion.tsx`
- Modify: `src/components/desktop/AdvisorTrace.tsx`
- Modify: `src/app/api/v1/conversations/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/messages/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/messages/route.test.ts`
- Modify: `src/app/api/v1/conversations/[id]/messages/stream/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/clarifications/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/clarifications/[clarificationId]/answer/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/output-preference/route.ts`
- Modify: `src/app/api/v1/recommendations/route.ts`
- Modify: `src/app/api/v1/recommendations/[id]/route.ts`
- Modify: `src/app/api/v1/recommendations/[id]/simulations/route.ts`
- Modify: `src/app/api/v1/analyses/route.ts`
- Modify: `src/app/api/v1/analyses/route.test.ts`
- Modify: `src/app/api/v1/analyses/[id]/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/cancel/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/retry/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/retry/route.test.ts`
- Modify: `src/app/api/v1/analyses/[id]/events/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/events/route.test.ts`
- Create: `tests/e2e/advisor-locales.spec.ts`

- [ ] **Step 1: Add `requestedLocale` and content locale to the Agent contract**

Every conversation run receives:

```ts
requestedLocale: AppLocale;
```

Persist:

```text
conversation_sessions.title_locale
messages.content_locale
agent_runs.requested_locale
recommendations.content_locale
information_requests.content_locale
```

- [ ] **Step 2: Add the output-language contract**

Machine enum fields stay stable. Natural-language fields follow `requestedLocale`.

Add `contentLocale` to structured output and verify it equals the request.

For a clear English/Chinese mismatch:

1. Retry once with the same service facts.
2. Do not refetch market facts.
3. Mark the run language-degraded if the retry still mismatches.

- [ ] **Step 3: Localize deterministic output**

Move all fallback summaries, progress titles, clarification prompts, disclaimers, missing-data questions, and default recommendation strings into `advisor.json`.

- [ ] **Step 4: Make SSE language explicit**

Native `EventSource` cannot set `Accept-Language`. Append the resolved locale to each stream URL, for example:

```text
/api/v1/analyses/<id>/events?locale=en-US
```

Validate the query locale server-side, return `Content-Language`, and localize user-visible event title/content through `localize-event.ts` while keeping event types stable.

Update all three current EventSource consumers:

```text
src/services/advisorService.ts
src/features/workbench/pages/WorkbenchExpansion.tsx
src/app/(workbench)/simulations/page.tsx
```

- [ ] **Step 5: Localize conversation and recommendation APIs**

Use locale-aware error helpers and return content locale fields.

- [ ] **Step 6: Migrate Advisor and detail UI**

Cover conversation list, message composer, progress theater, Agent trace, recommendation cards/detail, compliance states, clarification forms, and all accessibility text.

- [ ] **Step 7: Test mixed-language history**

Create a Chinese conversation, switch to English, send a new message, and assert:

- Old messages remain Chinese.
- New Assistant message is English.
- Each message returns its stored `contentLocale`.
- Switching back does not rewrite content.

- [ ] **Step 8: Run, commit, and push**

```bash
pnpm vitest run src/mastra/agents/chief-advisor.test.ts src/server/extensions/advisor src/server/extensions/sse src/services/recommendationService.test.ts src/app/api/v1/conversations src/app/api/v1/recommendations src/app/api/v1/analyses
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/advisor-locales.spec.ts
git add src/i18n/messages src/server/extensions/advisor src/mastra/agents/chief-advisor.ts \
  src/mastra/agents/chief-advisor.test.ts src/services/advisorService.ts \
  src/server/extensions/sse \
  src/services/recommendationService.ts src/services/recommendationService.test.ts \
  src/features/workbench/pages/AdvisorPage.tsx \
  src/features/workbench/pages/RecommendationDetailPage.tsx \
  src/features/workbench/pages/WorkbenchExpansion.tsx \
  src/components/desktop/AdvisorTrace.tsx \
  'src/app/(workbench)/simulations/page.tsx' \
  src/app/api/v1/conversations src/app/api/v1/recommendations src/app/api/v1/analyses \
  tests/e2e/advisor-locales.spec.ts
git commit -m "feat: internationalize advisor and recommendations"
git push origin HEAD
```

## Task 7: Complete Evidence Lab, Research, Reports, Artifacts, And History

**Module completion boundary:** Research sources, evidence translation, evidence pack, reports, artifact library/preview, and history views.

**Files:**

- Create: `src/i18n/messages/zh-CN/evidence.json`
- Create: `src/i18n/messages/en-US/evidence.json`
- Create: `src/i18n/messages/zh-CN/artifacts.json`
- Create: `src/i18n/messages/en-US/artifacts.json`
- Create: `src/server/extensions/search/source-language.ts`
- Create: `src/server/extensions/search/source-language.test.ts`
- Create: `src/server/extensions/search/evidence-translation.ts`
- Create: `src/server/extensions/search/evidence-translation.test.ts`
- Modify: `src/server/extensions/search/service.ts`
- Modify: `src/server/extensions/search/knowledge-base-adapter.ts`
- Modify: `src/server/extensions/search/mcp-adapter.ts`
- Modify: `src/server/extensions/search/mcp-adapter.test.ts`
- Modify: `src/server/extensions/search/rss-adapter.ts`
- Modify: `src/server/extensions/search/web-adapter.ts`
- Modify: `src/server/extensions/search/web-adapter.test.ts`
- Modify: `src/server/extensions/artifacts/service.ts`
- Modify: `src/server/extensions/artifacts/service.test.ts`
- Modify: `src/services/portfolioReportService.ts`
- Modify: `src/services/recommendationEvidenceMapper.ts`
- Modify: `src/features/workbench/pages/EvidenceLabPage.tsx`
- Modify: `src/components/desktop/EvidenceLab.tsx`
- Modify: `src/features/workbench/components/ArtifactLibrary.tsx`
- Modify: `src/components/desktop/GeneratePortfolioReportDialog.tsx`
- Modify: `src/components/desktop/PortfolioReportProgress.tsx`
- Modify: `src/app/(workbench)/evidence-lab/page.tsx`
- Modify: `src/app/(workbench)/artifacts/page.tsx`
- Modify: `src/app/(workbench)/generated-artifacts/[id]/page.tsx`
- Modify: `src/app/(workbench)/history/page.tsx`
- Modify: `src/app/(workbench)/history/artifacts/page.tsx`
- Modify: `src/app/(workbench)/history/evidence-lab/page.tsx`
- Modify: `src/app/(workbench)/history/decision-log/page.tsx`
- Modify: `src/app/api/v1/research-searches/route.ts`
- Modify: `src/app/api/v1/research-searches/route.test.ts`
- Modify: `src/app/api/v1/research-searches/[id]/route.ts`
- Modify: `src/app/api/v1/research-searches/[id]/results/route.ts`
- Modify: `src/app/api/v1/generated-artifacts/route.ts`
- Modify: `src/app/api/v1/generated-artifacts/route.test.ts`
- Modify: `src/app/api/v1/generated-artifacts/[id]/route.ts`
- Modify: `src/app/api/v1/generated-artifacts/[id]/route.test.ts`
- Modify: `src/app/api/v1/generated-artifacts/[id]/preview/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/evidence-pack/evidence-pack-format.ts`
- Modify: `src/app/api/v1/analyses/[id]/evidence-pack/evidence-time.ts`
- Modify: `src/app/api/v1/analyses/[id]/evidence-pack/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/evidence-pack/route.test.ts`
- Modify: `src/app/api/v1/analyses/[id]/evidence-pack/route-preview.test.ts`
- Modify: `src/app/api/v1/analyses/[id]/evidence-pack/simulation-preview.ts`
- Create: `tests/e2e/evidence-report-locales.spec.ts`

- [ ] **Step 1: Persist source and summary language**

Detect and save `source_locale` on research/RSS evidence. Save `summary_locale` for the displayed summary.

- [ ] **Step 2: Implement cached English evidence summaries**

Cache key:

```text
evidenceItemId + targetLocale + sourceContentSha256
```

Keep original title, URL, citation, number/date tokens, security symbols, and source names.

English translated summaries display `AI translated`.

- [ ] **Step 3: Persist artifact/report language**

Every report/artifact creation and edit writes:

```text
generated_artifacts.content_locale
generated_artifact_versions.content_locale
agent_runs.requested_locale
```

Viewing does not regenerate or translate historical content.

- [ ] **Step 4: Migrate all evidence, report, artifact, and history UI**

Cover source names, time labels, evidence stances, missing data, report progress, version/edit/delete states, Markdown templates, and formatting.

- [ ] **Step 5: Test historical and translated evidence behavior**

Assert original source identity is unchanged and historical Chinese reports remain Chinese in English UI.

- [ ] **Step 6: Run, commit, and push**

```bash
pnpm vitest run src/server/extensions/search src/server/extensions/artifacts src/app/api/v1/research-searches src/app/api/v1/generated-artifacts 'src/app/api/v1/analyses/[id]/evidence-pack'
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/evidence-report-locales.spec.ts tests/e2e/evidence-lab.spec.ts
git add src/i18n/messages src/server/extensions/search src/server/extensions/artifacts \
  src/services/portfolioReportService.ts src/services/recommendationEvidenceMapper.ts \
  src/features/workbench/pages/EvidenceLabPage.tsx src/components/desktop/EvidenceLab.tsx \
  src/features/workbench/components/ArtifactLibrary.tsx \
  src/components/desktop/GeneratePortfolioReportDialog.tsx \
  src/components/desktop/PortfolioReportProgress.tsx \
  'src/app/(workbench)/history' 'src/app/(workbench)/artifacts' \
  'src/app/(workbench)/generated-artifacts' \
  src/app/api/v1/research-searches src/app/api/v1/generated-artifacts \
  'src/app/api/v1/analyses/[id]/evidence-pack' \
  tests/e2e/evidence-report-locales.spec.ts tests/e2e/evidence-lab.spec.ts
git commit -m "feat: internationalize evidence reports and artifacts"
git push origin HEAD
```

## Task 8: Complete Branch Simulation

**Module completion boundary:** Simulation workspaces, scenario Agent, deterministic fallback, branch UI, and APIs.

**Files:**

- Create: `src/i18n/messages/zh-CN/simulation.json`
- Create: `src/i18n/messages/en-US/simulation.json`
- Modify: `src/server/extensions/simulation/scenario-contracts.ts`
- Modify: `src/server/extensions/simulation/scenario-agent.ts`
- Modify: `src/server/extensions/simulation/candidate-generator.ts`
- Modify: `src/server/extensions/simulation/service.ts`
- Modify: `src/server/extensions/simulation/scenario-agent.test.ts`
- Modify: `src/server/extensions/simulation/candidate-generator.test.ts`
- Modify: `src/server/extensions/simulation/deterministic-engine.ts`
- Modify: `src/server/extensions/simulation/deterministic-engine.test.ts`
- Modify: `src/app/api/v1/simulation-workspaces/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/route.test.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/active-branch/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/branches/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/branches/[branchId]/snapshot/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/options/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/tree/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/undo/route.ts`
- Modify: `src/app/(workbench)/simulations/page.tsx`
- Modify: `src/features/workbench/components/branch-diff.tsx`
- Modify: `src/features/workbench/components/branch-event-timeline.tsx`
- Modify: `src/features/workbench/components/branch-option-card.tsx`
- Modify: `src/components/desktop/SimulationCompare.tsx`
- Modify: `src/components/desktop/OutcomeCompare.tsx`
- Create: `tests/e2e/simulation-locales.spec.ts`

- [ ] **Step 1: Propagate requested locale**

Persist `simulation_option_batches.content_locale`; scenario display fields use the target language while strategy/action enums remain stable.

- [ ] **Step 2: Localize deterministic and model output**

Move scenario labels, descriptions, rationale, risk, assumptions, invalidation conditions, callback progress, and model-failure fallback into locale-aware factories.

- [ ] **Step 3: Migrate APIs and UI**

Cover workspace creation, options, branch tree, snapshot differences, undo, archived state, empty holdings, and all chart/table formatting.

- [ ] **Step 4: Run, commit, and push**

```bash
pnpm vitest run src/server/extensions/simulation src/app/api/v1/simulation-workspaces
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/simulation-locales.spec.ts tests/e2e/branch-simulation.spec.ts
git add src/i18n/messages src/server/extensions/simulation \
  src/app/api/v1/simulation-workspaces \
  'src/app/(workbench)/simulations/page.tsx' \
  src/features/workbench/components/branch-diff.tsx \
  src/features/workbench/components/branch-event-timeline.tsx \
  src/features/workbench/components/branch-option-card.tsx \
  src/components/desktop/SimulationCompare.tsx src/components/desktop/OutcomeCompare.tsx \
  tests/e2e/simulation-locales.spec.ts tests/e2e/branch-simulation.spec.ts
git commit -m "feat: internationalize branch simulation"
git push origin HEAD
```

## Task 9: Complete Watchlists, Alerts, Notifications, And RSS

**Module completion boundary:** Watchlist/observatory, observation conditions, proactive scheduler, notifications, preferences, and RSS reader.

**Files:**

- Create: `src/i18n/messages/zh-CN/notifications.json`
- Create: `src/i18n/messages/en-US/notifications.json`
- Create: `src/i18n/messages/zh-CN/watchlist.json`
- Create: `src/i18n/messages/en-US/watchlist.json`
- Create: `src/i18n/messages/zh-CN/rss.json`
- Create: `src/i18n/messages/en-US/rss.json`
- Modify: `src/server/extensions/notifications/alert-engine.ts`
- Modify: `src/server/extensions/notifications/alert-engine.test.ts`
- Modify: `src/server/extensions/notifications/notification-writer.ts`
- Modify: `src/server/extensions/notifications/portfolio-alerts.ts`
- Modify: `src/server/extensions/notifications/proactive-service.ts`
- Modify: `src/server/extensions/notifications/proactive-service.test.ts`
- Modify: `src/server/extensions/notifications/scheduler.ts`
- Modify: `src/server/extensions/notifications/watchlist-alerts.ts`
- Modify: `src/server/extensions/rss/service.ts`
- Modify: `src/server/extensions/rss/text.ts`
- Modify: `src/server/extensions/rss/service.test.ts`
- Modify: `src/app/api/v1/notifications/route.ts`
- Modify: `src/app/api/v1/notifications/route.test.ts`
- Modify: `src/app/api/v1/notifications/[id]/route.ts`
- Modify: `src/app/api/v1/notifications/[id]/route.test.ts`
- Modify: `src/app/api/v1/notifications/read-all/route.ts`
- Modify: `src/app/api/v1/notifications/sync/route.ts`
- Modify: `src/app/api/v1/notifications/sync/route.test.ts`
- Modify: `src/app/api/v1/notification-preference/route.ts`
- Modify: `src/app/api/v1/notification-preference/route.test.ts`
- Modify: `src/app/api/v1/observation-conditions/route.ts`
- Modify: `src/app/api/v1/observation-conditions/[id]/route.ts`
- Modify: `src/app/api/v1/observation-conditions/evaluate/route.ts`
- Modify: `src/app/api/v1/watchlists/route.ts`
- Modify: `src/app/api/v1/watchlists/route.test.ts`
- Modify: `src/app/api/v1/watchlists/[id]/route.ts`
- Modify: `src/app/api/v1/watchlists/[id]/route.test.ts`
- Modify: `src/app/api/v1/watchlists/[id]/items/route.ts`
- Modify: `src/app/api/v1/watchlists/[id]/items/route.test.ts`
- Modify: `src/app/api/v1/watchlist-items/[id]/route.ts`
- Modify: `src/app/api/v1/rss/route.ts`
- Modify: `src/app/api/v1/rss/feeds/route.ts`
- Modify: `src/app/api/v1/rss/items/route.ts`
- Modify: `src/services/alertsService.ts`
- Modify: `src/services/watchlistService.ts`
- Modify: `src/features/workbench/pages/AlertsPage.tsx`
- Modify: `src/features/workbench/pages/WatchlistPage.tsx`
- Modify: `src/app/(workbench)/observatory/page.tsx`
- Modify: `src/app/(workbench)/notification-preference/page.tsx`
- Modify: `src/app/(workbench)/rss/page.tsx`
- Create: `tests/e2e/monitoring-locales.spec.ts`

- [ ] **Step 1: Generate background content using account preference**

The scheduler loads `users.preferred_locale`; `NULL` means `zh-CN`.

Every notification writes `notifications.content_locale`.

No scheduled task reads a Cookie.

- [ ] **Step 2: Localize notification templates and Advisor prompts**

Move all threshold titles, bodies, fallback errors, and Advisor prompt templates into locale-aware factories.

- [ ] **Step 3: Persist RSS source locale**

Keep original RSS title/summary and expose source language. Reuse the evidence translation service for an English summary when needed.

- [ ] **Step 4: Migrate pages, routes, and services**

Cover list names/default descriptions, alert states, date/time, quiet hours, unread actions, sync errors, RSS source actions, and external-link labels.

- [ ] **Step 5: Run, commit, and push**

```bash
pnpm vitest run src/server/extensions/notifications src/app/api/v1/notifications src/app/api/v1/notification-preference src/app/api/v1/observation-conditions src/app/api/v1/watchlists src/app/api/v1/watchlist-items src/app/api/v1/rss
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/monitoring-locales.spec.ts
git add src/i18n/messages src/server/extensions/notifications \
  src/app/api/v1/notifications src/app/api/v1/notification-preference \
  src/app/api/v1/observation-conditions src/app/api/v1/watchlists \
  src/app/api/v1/watchlist-items src/app/api/v1/rss \
  src/services/alertsService.ts src/services/watchlistService.ts \
  src/features/workbench/pages/AlertsPage.tsx src/features/workbench/pages/WatchlistPage.tsx \
  'src/app/(workbench)/observatory/page.tsx' \
  'src/app/(workbench)/notification-preference/page.tsx' \
  'src/app/(workbench)/rss/page.tsx' tests/e2e/monitoring-locales.spec.ts
git commit -m "feat: internationalize monitoring and notifications"
git push origin HEAD
```

## Task 10: Complete Decision Log And Remaining User History Pages

**Module completion boundary:** Decision records and any user history shell not already completed with Evidence/Artifacts.

**Files:**

- Create: `src/i18n/messages/zh-CN/history.json`
- Create: `src/i18n/messages/en-US/history.json`
- Modify: `src/features/workbench/pages/DecisionLogPage.tsx`
- Modify: `src/app/(workbench)/decision-log/page.tsx`
- Modify: `src/app/(workbench)/history/page.tsx`
- Modify: `src/app/(workbench)/history/decision-log/page.tsx`
- Modify: `src/app/(workbench)/history/evidence-lab/page.tsx`
- Modify: `src/services/alertsService.ts` decision mapping
- Modify: `src/app/api/v1/decisions/route.ts`
- Modify: `src/app/api/v1/decisions/route.test.ts`
- Modify: `src/app/api/v1/recommendations/[id]/decisions/route.ts`
- Modify: `src/app/api/v1/recommendations/[id]/decisions/route.test.ts`
- Create: `tests/e2e/history-locales.spec.ts`

- [ ] **Step 1: Localize decision actions and stored-content display**

Stable action codes are translated only at render time. User-entered reasons and historical recommendation summaries retain their stored language.

- [ ] **Step 2: Migrate APIs, page text, formatting, and accessibility**

- [ ] **Step 3: Run, commit, and push**

```bash
pnpm vitest run src/app/api/v1/decisions 'src/app/api/v1/recommendations/[id]/decisions' src/services/alertsService.test.ts
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/history-locales.spec.ts
git add src/i18n/messages src/features/workbench/pages/DecisionLogPage.tsx \
  'src/app/(workbench)/decision-log/page.tsx' 'src/app/(workbench)/history' \
  src/services/alertsService.ts src/services/alertsService.test.ts \
  src/app/api/v1/decisions 'src/app/api/v1/recommendations/[id]/decisions' \
  tests/e2e/history-locales.spec.ts
git commit -m "feat: internationalize decision history"
git push origin HEAD
```

## Task 11: Complete Semantic Layer, System Health, Demo, And Administration

**Module completion boundary:** All administrator and operational pages and APIs.

**Files:**

- Create: `src/i18n/messages/zh-CN/admin.json`
- Create: `src/i18n/messages/en-US/admin.json`
- Create: `src/i18n/messages/zh-CN/semantic.json`
- Create: `src/i18n/messages/en-US/semantic.json`
- Modify: `src/features/workbench/pages/SemanticColumnsPage.tsx`
- Modify: `src/features/workbench/pages/SemanticDatasourcesPage.tsx`
- Modify: `src/features/workbench/pages/SemanticDomainsPage.tsx`
- Modify: `src/features/workbench/pages/SemanticForeignKeysPage.tsx`
- Modify: `src/features/workbench/pages/SemanticTablesPage.tsx`
- Modify: `src/components/desktop/DataPagination.tsx`
- Modify: `src/components/desktop/DataToolbar.tsx`
- Modify: `src/components/desktop/SemanticPageState.tsx`
- Modify: `src/components/desktop/SemanticSyncDialog.tsx`
- Modify: `src/app/(workbench)/admin/rss/page.tsx`
- Modify: `src/app/(workbench)/admin/system/page.tsx`
- Modify: `src/app/(workbench)/admin/users/page.tsx`
- Modify: `src/app/(workbench)/assets/semantic/page.tsx`
- Modify: `src/app/(workbench)/assets/semantic/datasources/page.tsx`
- Modify: `src/app/(workbench)/assets/semantic/domains/page.tsx`
- Modify: `src/app/(workbench)/assets/semantic/foreign-keys/page.tsx`
- Modify: `src/app/(workbench)/assets/semantic/tables/page.tsx`
- Modify: `src/app/(workbench)/assets/semantic/tables/[tableId]/columns/page.tsx`
- Modify: `src/app/(workbench)/demo/bootstrap/page.tsx`
- Modify: `src/app/(workbench)/demo/reset/page.tsx`
- Modify: `src/app/(workbench)/system-health/page.tsx`
- Modify: `src/app/api/v1/admin/rss/feeds/route.ts`
- Modify: `src/app/api/v1/admin/rss/feeds/route.test.ts`
- Modify: `src/app/api/v1/admin/rss/feeds/[id]/route.ts`
- Modify: `src/app/api/v1/admin/rss/feeds/[id]/sync/route.ts`
- Modify: `src/app/api/v1/admin/semantic-layer/[...path]/route.ts`
- Modify: `src/app/api/v1/admin/semantic-layer/[...path]/route.test.ts`
- Modify: `src/app/api/v1/admin/system/route.ts`
- Modify: `src/app/api/v1/admin/users/route.ts`
- Modify: `src/app/api/v1/admin/users/[id]/route.ts`
- Modify: `src/app/api/v1/admin/users/[id]/reset-password/route.ts`
- Modify: `src/app/api/v1/demo/bootstrap/route.ts`
- Modify: `src/app/api/v1/demo/reset/route.ts`
- Modify: `src/app/api/v1/health/route.ts`
- Modify: `src/app/api/v1/health/route.test.ts`
- Modify: `src/server/health/system-health.ts`
- Modify: `src/server/semantic-layer/datasource-service.ts`
- Create: `tests/e2e/admin-locales.spec.ts`

- [ ] **Step 1: Migrate shared data-table controls**

Complete pagination, selection, filters, batch actions, loading, empty, and error states before individual semantic pages.

- [ ] **Step 2: Migrate semantic pages**

Cover domains, data sources, tables, columns, foreign keys, sync dialog, status labels, dates, and validation.

- [ ] **Step 3: Migrate admin, demo, and health pages/APIs**

Keep system status codes and schema/table names unchanged; localize descriptions and user errors.

- [ ] **Step 4: Run, commit, and push**

```bash
pnpm vitest run src/app/api/v1/admin src/app/api/v1/demo src/app/api/v1/health src/server/semantic-layer
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/admin-locales.spec.ts
git add src/i18n/messages src/features/workbench/pages/Semantic*.tsx \
  src/components/desktop/DataPagination.tsx src/components/desktop/DataToolbar.tsx \
  src/components/desktop/SemanticPageState.tsx src/components/desktop/SemanticSyncDialog.tsx \
  'src/app/(workbench)/admin' 'src/app/(workbench)/assets/semantic' \
  'src/app/(workbench)/system-health' 'src/app/(workbench)/demo' \
  src/app/api/v1/admin src/app/api/v1/demo src/app/api/v1/health \
  src/server/health src/server/semantic-layer tests/e2e/admin-locales.spec.ts
git commit -m "feat: internationalize administration and semantic tools"
git push origin HEAD
```

## Task 12: Complete A2A And Public Documentation

**Module completion boundary:** Agent Card, A2A message endpoint, and public submission documentation.

**Files:**

- Create: `src/i18n/messages/zh-CN/a2a.json`
- Create: `src/i18n/messages/en-US/a2a.json`
- Modify: `src/server/a2a/message.ts`
- Modify: `src/server/a2a/agent-card.ts`
- Modify A2A tests
- Modify: `src/app/api/a2a/message-send/route.ts`
- Modify: `src/app/.well-known/agent-card.json/route.ts`
- Modify: `src/app/docs/a2a-submission/route.ts`
- Create: `tests/e2e/a2a-locales.spec.ts`

- [ ] **Step 1: Add explicit A2A locale**

Accept `locale` in the request root or capability metadata.

Resolve:

```text
explicit locale > Accept-Language > zh-CN
```

Pass it to `runConversationAgent`.

- [ ] **Step 2: Localize public text without translating protocol fields**

Keep capability IDs, operation names, task states, artifact types, JSON-RPC fields, and error codes unchanged.

Localize Agent Card descriptions, examples, risk notice, errors, and Markdown documentation.

- [ ] **Step 3: Run, commit, and push**

```bash
pnpm vitest run src/server/a2a src/app/api/a2a src/app/.well-known/agent-card.json
pnpm lint
pnpm typecheck
pnpm playwright test tests/e2e/a2a-locales.spec.ts
git add src/i18n/messages src/server/a2a src/app/api/a2a \
  src/app/.well-known/agent-card.json src/app/docs/a2a-submission \
  tests/e2e/a2a-locales.spec.ts
git commit -m "feat: internationalize A2A and public documentation"
git push origin HEAD
```

## Task 13: Add Repository-Wide Internationalization Gates

**Module completion boundary:** Automated completeness checks and all remaining low-frequency/placeholder surfaces.

**Files:**

- Create: `scripts/check-i18n.mjs`
- Create: `scripts/check-i18n.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`
- Create: `.github/workflows/ci.yml`
- Create: `tests/e2e/all-pages-locales.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Write the failing checker tests**

The checker must fail for:

```text
missing en-US key
different ICU parameter names
empty translation
unregistered API error code
fixed zh-CN formatter call
fixed <html lang="zh-CN">
unapproved hardcoded Han user text
Agent entrypoint without requestedLocale
generated-content INSERT without locale field
```

- [ ] **Step 2: Implement `pnpm i18n:check`**

Add:

```json
{
  "scripts": {
    "i18n:check": "node scripts/check-i18n.mjs",
    "check": "pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build"
  }
}
```

Allow only precise paths:

```text
src/i18n/messages/**
source market data
test fixtures/assertions
approved authoritative model-rule templates
third-party/source quotations
documentation
```

Do not exempt `src/app`, `src/features`, `src/components`, `src/services`, or `src/server` wholesale.

- [ ] **Step 3: Add all-page bilingual E2E**

Visit every production page in desktop and mobile projects in both locales. Assert:

- No uncaught error.
- Correct `<html lang>`.
- Main heading or stable product region is visible.
- No horizontal viewport overflow.
- No overlap in the known navigation/dialog/table surfaces.

- [ ] **Step 4: Enforce checks before deployment**

Production deployment must not begin until:

```bash
pnpm check
pnpm test:e2e
```

has passed in CI.

- [ ] **Step 5: Run, commit, and push**

```bash
pnpm check
pnpm test:e2e
git add scripts/check-i18n.mjs scripts/check-i18n.test.ts package.json pnpm-lock.yaml \
  .github/workflows/ci.yml .github/workflows/deploy.yml \
  playwright.config.ts tests/e2e/all-pages-locales.spec.ts
git commit -m "test: enforce bilingual product completeness"
git push origin HEAD
```

If `scripts/check-i18n.mjs` reports product files that still contain fixed user-facing text, create one follow-up commit containing only the exact reported files, rerun this gate, and push that correction before moving to Task 14.

## Task 14: Run The One-Time Release Migration And Rollback Drill

**Module completion boundary:** Release runbook, data safety, and production probes.

**Files:**

- Create: `docs/internationalization-release-runbook.md`
- Modify: `.env.example`
- Modify: `.env.prod.example`
- Modify: `README.md`
- Modify: `.github/workflows/deploy.yml`
- Create: `scripts/verify-i18n-release.mjs`
- Modify: `src/server/db/migration-runner.test.ts`

- [ ] **Step 1: Prepare a production-data copy**

Back up the production SQLite database and run the internationalization migration against the copy.

Verify:

```sql
SELECT COUNT(*) FROM messages WHERE content_locale != 'zh-CN';
SELECT COUNT(*) FROM agent_runs WHERE requested_locale != 'zh-CN';
SELECT COUNT(*) FROM users WHERE preferred_locale IS NOT NULL;
```

Expected for legacy data before users switch language:

```text
0
0
0
```

- [ ] **Step 2: Verify historical content hashes**

Before and after migration, compute hashes for message content, recommendation text JSON, artifact Markdown/JSON, and evidence title/summary.

Expected: content hashes are unchanged.

- [ ] **Step 3: Verify the actual rollback path**

The current migration runner rejects a database whose `PRAGMA user_version` is newer than the application migration target. Therefore the rollback drill must restore the pre-migration application and database pair:

```text
1. Record the deployed image digest, migration filename, backup path, backup SHA-256, and schema version.
2. Start the new image against a copied database and verify migration success.
3. Stop the new image.
4. Restore the recorded pre-migration database backup to a new rollback path.
5. Start the previous application image against that restored database.
6. Run the Chinese login, existing-data read, and health probes.
```

The drill must prove that:

```text
the backup restores message/recommendation/artifact/evidence hashes
the previous image starts against the restored pre-migration schema
existing Chinese workflows remain readable
the new image can be redeployed after the rollback without a partial migration record
```

Do not claim that the previous image can start against the migrated database; `prepareDatabase()` intentionally rejects that state.

- [ ] **Step 4: Add post-deploy probes**

The release verifier must check:

```text
/login renders and switches language
/api/v1/auth/login localizes an expected validation error
authenticated locale preference persists
/api/v1/health remains healthy
A2A returns localized risk/error text without changing protocol codes
```

- [ ] **Step 5: Run the final release gate**

```bash
pnpm check
pnpm test:e2e
node scripts/verify-i18n-release.mjs --origin http://127.0.0.1:3000
```

Expected: PASS.

- [ ] **Step 6: Commit and push the release runbook**

```bash
git add docs/internationalization-release-runbook.md .env.example .env.prod.example \
  README.md .github/workflows/deploy.yml scripts/verify-i18n-release.mjs
git commit -m "docs: add bilingual release and rollback runbook"
git push origin HEAD
```

## Task 15: Final Review And Release Approval

- [ ] **Step 1: Confirm every vertical-slice commit is on the remote**

```bash
git fetch origin
git rev-list --left-right --count @{upstream}...HEAD
```

Expected:

```text
0 0
```

- [ ] **Step 2: Run complete verification**

```bash
pnpm check
pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 3: Verify release blockers**

```text
[ ] Language setting is available before and after login.
[ ] Every product page has zh-CN and en-US coverage.
[ ] Every user API error uses a stable code and localized message.
[ ] Every generated content record stores its locale.
[ ] Historical content remains unchanged.
[ ] English evidence translations are marked AI translated.
[ ] English financial and compliance terminology passed human review.
[ ] Migration, restore, rollback, and post-deploy probes passed.
```

- [ ] **Step 4: Request final code review**

Use `superpowers:requesting-code-review` for specification compliance, migration safety, security, accessibility, visual quality, and release readiness.
