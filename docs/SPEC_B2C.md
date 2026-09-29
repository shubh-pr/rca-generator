# RCA Dashboard: B2C specification (supplement to SPEC.md)

`docs/SPEC.md` still defines the RCA content, the workflow rules, print, PDF and DOCX, and the UI layout. This document replaces its **roles, permissions and master data** (SPEC Sections 2, 4.3 and 6.1 "Masters") for the multi-tenant product. Build notes are in `docs/B2C_PLAN.md`; decisions are in `docs/ASSUMPTIONS.md`.

## Product model

- **Signing up.** Anyone can sign up with email and a password (Google sign-in is optional). A new account gets a personal **workspace**, which the user owns.
- **Tenant isolation.** Every RCA belongs to exactly one workspace. Users can see and change only the data of the workspaces they belong to and the RCAs shared with them directly. Anything else returns 404.
- **Solo use.** A single user can fill every section, sign every sign-off row and close an RCA alone.
- **Collaboration.** A workspace OWNER invites people by email to the workspace or to a single RCA as **OWNER, EDITOR, CONTRIBUTOR** (edits only their assigned team section: DEV, QA or PROD) or **VIEWER**. Team assignment is per RCA, or per workspace for workspace-level contributors.
- **Platform admin.** `is_platform_admin` belongs to the operator only. It gives account metadata and an audited, time-limited, read-only **support access** to a workspace. There is no other access to RCA content.

## Permissions

| Action | OWNER | EDITOR | CONTRIBUTOR | VIEWER |
|---|---|---|---|---|
| View, print, PDF, DOCX, history | Y | Y | Y | Y |
| Create RCA (verified email, within quota) | Y | Y | - | - |
| Edit header, common, closing, follow-ups; edit or remove timeline events | Y | Y | - | - |
| Add timeline events, upload attachments, delete own uploads | Y | Y | Y | - |
| Edit, submit or add actions to team section X | Y | Y | only X | - |
| Unlock section, submit for review, send back, close, reopen, assign sign-offs | Y | Y | - | - |
| Sign a sign-off row | assigned to them, or unassigned | assigned to them, or unassigned | assigned to them | assigned to them |
| Delete RCA | Y | - | - | - |
| Invite, members, roles, workspace settings | Y | - | - | - |

- **Sign-off labels.** The five sign-off rows (Dev Lead, QA Lead, Production Lead, Project Owner, RCA Team Leader) are labels an OWNER or EDITOR may assign to a person. The three team rows are still signed before the other two.
- **Workflow unchanged.** The workflow rules of SPEC Section 3 are unchanged: DRAFT → IN_REVIEW → CLOSED, section submit and lock, optimistic locking with 409, the review and close gates, and reopen with version + 1.

## Master data → labels

Company, Project, Project Owner, RCA Team Leader, Prepared by, Reviewed by, section contributor and Verified by are free-text fields on the RCA. The name fields default to the creator's name. Suggestions come from names already used in the workspace. Action owners, follow-up owners and sign-off assignees are people with access to the RCA. RCA numbers `RCA-YYYY-NNNN` are sequential per workspace.

## Accounts

- **Sign-up and verification.** Sign-up requires email verification before creating RCAs; the link is valid for 24 h and can be used once.
- **Password reset.** Reset links are valid for 1 h, single use, and sign out every session.
- **Sessions.** A 15-minute access token plus a rotating refresh token in an httpOnly cookie. There is an active-sessions list and "log out of all devices".
- **Rate limits.** Per IP and per account, plus lockout. The CAPTCHA (Turnstile) is optional.
- **Account settings.** Profile and email change, password change, sessions, usage, **export my data** (zip with JSON and PDFs), **security log**, and **delete account**. Deletion is immediate soft delete; the hard delete follows after the grace period, 14 days by default.

## Limits (defaults, configurable)

| Limit | Default |
|---|---|
| File size | 10 MB |
| Storage per user | 200 MB |
| RCAs per user | 500 |

Usage counts toward the primary owner of each workspace. `workspaces.plan` and `usage_quotas` are the extension points for paid plans; there are no paid plans today.

## Public pages

Landing, Sign up, Log in, Forgot password, Reset password, Verify email, Invitation, Terms of Service, Privacy Policy and Contact. The legal texts are templates with `[REPLACE BEFORE LAUNCH]` markers.
