# Assumptions and decisions

Where the spec (`docs/SPEC.md`) was silent or ambiguous I took the simplest reasonable option and recorded it here.

## Decisions given by the product owner (Section 10 open questions)

- **Login:** local email + password accounts, bcrypt (`bcryptjs`) hashes, JWT bearer access token (8 h). All auth code lives in `apps/api/src/auth/`, so SSO can replace it later.
- **Projects:** one RCA belongs to exactly one project.
- **Production:** one Production section (team `PROD`), no separate DevOps section.
- **Sign-off:** a "Sign" button per role that records the user and the timestamp. There is no signature image.
- **Notifications:** no email notifications in v1.

## Data model

- Prisma fields use the spec's snake_case names, so API JSON matches the spec samples (`rca_date`, `project_id`) without mapping.
- **RCA number counter:** a helper table `rca_number_seq(year, last_value)` holds the yearly counter. The counter is incremented with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the RCA insert transaction, and the row lock prevents duplicates. The year is taken from `rca_date`.
- **Audit filtering:** `audit_log` has an extra nullable `rca_id` column so the audit screen can filter by RCA even when the entity is a child row such as a section, action or sign-off. A database trigger rejects UPDATE and DELETE on `audit_log`, because the spec says audit rows cannot be edited.
- **Whys:** creating an RCA also creates the five `rca_why` rows (why_no 1–5, empty answer) for each section. This matches "rca_team_section 1 --- 5 rca_why".
- **Password storage:** `users.password_hash` is an extra column the spec does not list; login needs it.
- **Project owner:** `projects.owner_user_id` is NOT NULL, because the header must always show the Project Owner.
- **Team for Dev/QA/Prod users:** users with role DEV, QA or PROD must have the matching `team`. Other roles have no team. Section access is decided by that team.
- **Deleting users:** "deleting" a user sets `is_active = false`, because users are referenced by RCAs and audit rows. Inactive users cannot log in (401).
- **Deleting companies and projects:** deletion is refused with 409 while other rows still reference the company or project.

## RCA header, common sections and list

- **Editing a closed RCA:** header, common, closing, timeline, follow-up and attachment data can be edited while the RCA is DRAFT or IN_REVIEW. On a CLOSED RCA every edit returns 409 until the RCA is reopened.
- **prepared_by:** defaults to the user who creates the RCA. `reviewed_by` is a normal editable header field.
- **Team leader:** `team_leader_id` must be an active user. The picker lists RCA Team Leaders and Admins.
- **Read-only fields:** `rca_number`, `status`, `version`, `closed_at` and `time_to_detect_minutes` are read-only. Sending them to POST or PATCH returns 400 ("Unknown or read-only field"). Time to detect is computed on every read.
- **`team` list filter:** returns RCAs whose section for that team is not yet SUBMITTED. This matches the dashboard chart "sections pending by team", so a click on the chart opens the matching list.
- **Extra list filters:** `open` (DRAFT or IN_REVIEW), `closed_from`/`closed_to` (closed date, IST) and `overdue` (has an overdue action). The dashboard KPI cards need them so that every card opens a list showing the same number. The list, the list export and the dashboard use the same filter code.
- **Overdue action:** status is not COMPLETED, the due date is before today (IST), and the action has not been moved to follow-ups.
- **Tab badges:** Header, Common and Closing have no status column. Their badge shows "Submitted" once the RCA has left DRAFT (Closing: once CLOSED), "In progress" when something is filled, and otherwise "Not started".
- **Audit action names:** besides the spec's CREATE, UPDATE, SUBMIT, SIGN, CLOSE, REOPEN and EXPORT, the log uses `DELETE` (soft delete, removing a timeline row, attachment or action, deactivating a user) and `SEND_BACK` (IN_REVIEW to DRAFT).
