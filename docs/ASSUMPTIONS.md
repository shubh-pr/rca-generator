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
