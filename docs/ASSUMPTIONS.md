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

## Team sections and actions

- **Version and actions:** only the section save (PUT) and submit/reopen increase the section `version`. Actions are separate rows with their own endpoints and do not increase the section version. Two people editing different actions never conflict.
- **Submit version:** POST `…/submit` accepts an optional `version`. When it is sent and stale, the API returns 409 `VERSION_CONFLICT`.
- **After submit:** the section fields and the action text, owner and due date are locked (409). Action `status` and `completed_on` stay editable by the team, Lead and Admin until the RCA is closed. Without that, the close rule ("every action is COMPLETED") could never be met, because all sections are submitted before review.
- **Unlocking a section:** a Lead or Admin can unlock a section only while the RCA is DRAFT. In IN_REVIEW the reviewer uses send-back, and a CLOSED RCA must first be reopened.
- **Whys 2–4 are optional** at submit, per "all 5 Whys (or at least Why 1 and Why 5)".
- **Action status COMPLETED** does not require `completed_on`. The spec requires dates only for the section's completion status.
- **Auto-save:** the team tab saves a draft every 60 seconds while it has unsaved edits. After a 409 it stops auto-saving until the user reloads.

## Workflow, sign-off, follow-ups, attachments, audit

- **"Header and common sections complete" before review** means summary, detected_at, resolved_at, impact_users, detection_method and immediate_fix are filled. The optional descriptive fields (impact duration, revenue, applied by) are not required.
- **Sign-off timing:** sign-off is possible only while the RCA is IN_REVIEW (409 otherwise). Following "all three team lead sign-offs are done … Then Project Owner and RCA Team Leader sign off", the PROJECT_OWNER and RCA_LEAD sign-offs return 422 until DEV_LEAD, QA_LEAD and PROD_LEAD have signed.
- **Who signs which role:** a DEV user signs DEV_LEAD, QA signs QA_LEAD, PROD signs PROD_LEAD, and Project Owner and RCA Team Leader sign their own roles. Matching is by role, so any user holding the role may sign. Admin may sign any role, as the matrix gives Admin "Y", and the record shows the admin's name.
- **Send back:** the body is `{ comment, teams: [...] }`. Only the named sections return to IN_PROGRESS. All sign-offs are cleared, because the content will change. The comment is stored in the SEND_BACK audit row.
- **Reopen:** CLOSED goes to DRAFT, `version + 1`, `closed_at` is cleared, and sign-offs are cleared. Sections stay SUBMITTED; the Lead or Admin can unlock the ones that need changes.
- **Moving an action to follow-ups:** `rca_followup` has an extra nullable `action_id`. POST `/followups` with `action_id` requires an owner and a due date, and marks that action as moved. The close rule treats an action as done when it is COMPLETED, or when it has a follow-up with an owner and a due date.
- **Follow-up edit and delete:** the spec lists only GET/POST for follow-ups. PATCH/DELETE `/rcas/{id}/followups/{fid}` (Lead+) were added because the Closing tab's follow-ups table needs inline editing (SPEC 6.2).
- **Attachments:** `.jpeg` is accepted as the same type as `.jpg`. The served Content-Type comes from the file extension, never from the client. Downloads are always `Content-Disposition: attachment` with `nosniff`. Files are stored under `UPLOAD_DIR` with a random UUID name, and the database stores only that name. A GET list endpoint `/rcas/{id}/attachments` was added next to the spec's POST.
- **Global audit endpoint:** the Audit log screen (Owner and Admin, filters by RCA, user and date) needs a cross-RCA query, so `GET /api/v1/audit` was added. It also accepts `action`, `entity` and `rca_number` filters.
- **Seed samples** are written directly with Prisma: RCA-2026-0001 is CLOSED and satisfies every close rule, and RCA-2026-0002 is DRAFT with Dev submitted, QA in progress and Production not started. They are skipped when any RCA already exists.

## Print, PDF, DOCX and list export

- **No RCA_Template.docx was supplied.** The section order and fields come from the spec: title and header grid; 1 Common (1.1 Problem, 1.2 Impact, 1.3 Detection, 1.4 Timeline, 1.5 Immediate fix); 2 Dev, QA and Production (contributor, cause category, 5 Whys, escape analysis and the two team prompts, actions, prevention, completion); 3 Closing (3.1 Lessons, 3.2 Follow-ups, 3.3 Attachments, 3.4 Sign-off). Print, PDF and DOCX are all built from one export model (`apps/api/src/export/model.ts`), so they cannot drift apart.
- **Blank template:** `GET /templates/rca-blank.docx` is generated from that same model with every value empty, instead of a static file. Swap in the approved RCA_Template.docx here if it must match byte for byte.
- **Where the PDF comes from:** it is produced by loading the exact HTML returned by `GET /rcas/{id}/print` into headless Chromium (Playwright `setContent`, print media, `preferCSSPageSize`). The HTML is rendered in-process rather than fetched over HTTP, so the API never calls itself with a user token.
- **Header and footer:** the header line and "Confidential / Page X of Y / Generated …" footer use CSS `@page` margin boxes, which Chromium 131+ supports for both browser print and PDF. Other browsers may print without them; the PDF always has them.
- **Team section pages:** each team section starts on a new page. The "2. Team sections" heading sits at the top of the Dev page so it is never stranded on the page before.
- **Empty rows for handwriting:** empty fields print as empty boxes, and tables are padded with blank rows (timeline 5, actions 3, follow-ups 3, attachments 2).
- **DRAFT marking:** the print and PDF show a diagonal DRAFT watermark on every page until CLOSED (IN_REVIEW RCAs are also marked DRAFT). The spec requires the watermark only for print and PDF. The `docx` library has no watermark support, so the Word file shows a red "DRAFT" in the page header instead.
- **Export audit:** opening the print view counts as a print export and writes `EXPORT {format: "print"}`, because the browser's own print dialog cannot be observed. List export and blank-template downloads are audited with `entity = rca_list` or `template` and a nil UUID `entity_id`.
- **List export:** CSV or XLSX with the same filters as the list, one row per RCA by default, or `rows=actions` for one row per action. CSV cells starting with `= + - @` are prefixed with `'` to prevent formula injection. The export is capped at 50,000 rows.
