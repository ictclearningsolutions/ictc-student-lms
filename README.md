# ICTC Student LMS

A lightweight Learning Management System for ICTC students to view details of the courses they have enrolled in — accessible from both **phone and web**.

## Features

**Students**
- Login with their ICTC Student ID (provided by admin after enrollment)
- Dashboard showing all enrolled courses with progress %
- Course details page with:
  - Overview & description
  - Syllabus / topics
  - Schedule & class sessions (online join links / onsite)
  - Trainer name & contact
  - Course materials (videos, PDFs, slides, links)
  - Assessments (quizzes) with scores, pass/fail and retake options
- Profile page to update name, email and mobile
- Mobile-first responsive design + PWA manifest (add to home screen on phones)

**Admin**
- Login (`admin` / `admin123`)
- Create student accounts (single or batch) — default password `ictc2026`
- Activate / deactivate / delete students
- Create and edit courses (syllabus, schedule, trainer, materials, assessments)
- Enroll / unenroll students per course
- Track per-student progress and assessment scores per course
- Export-free simple SQLite storage (sql.js)

## Quick start

```bash
cd ictc-student-lms
npm install
npm start
```

Then open http://localhost:4000

| Role | URL | Login |
| ---- | --- | ----- |
| Admin | http://localhost:4000/admin/login | `admin` / `admin123` |
| Student | http://localhost:4000/login | `ICTC-STU-001` / `ictc2026` (demo account) |

## Phone access

The app is fully responsive and installable. On a phone:
- Open the web URL (host it on Render/Railway/VPS, or tunnel with `ngrok http 4000`)
- Use your browser menu → **Add to Home Screen** to install it like a native app

## Data storage

All data is stored in `data/ictc_lms.db` (SQLite via sql.js). The database is created
and seeded automatically on first run. Delete the file to reset to fresh seed data.

## Admin course form quick-reference

**Syllabus** — one topic per line.

**Sessions** — one per line: `date | time | topic | mode | link` (mode: Online/Onsite, link optional).

**Materials** — one per line: `type | title | url` (type: Video/PDF/Slides/Link/File).

**Assessments** — header line then question lines:

```
A:Quiz title|passing percent
Q:Question text|Option A|Option B|Option C|Option D|correct option index
```
