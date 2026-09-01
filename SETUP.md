# Domain Task Portal — Setup Guide

A dashboard over your existing **DevOps Domain Task Sheet**. Mentors sign in with Google and see only their own students. The HOD sees the whole department with charts. Nothing in your current tabs has to change.

Total setup time: about 30 minutes, once.

---

## What this reads from your sheet

Your workbook is not a tidy database, and the portal was built around that:

| What your sheet does | How the portal handles it |
|---|---|
| No Faculty Email column anywhere | Matches on **Mentor UID** first, mentor **name** second, through a `_Faculty` tab it builds for you |
| Headers sometimes in row 1, sometimes row 2 or 3, under a paragraph of instructions | Finds the header row itself on each tab |
| One person written as "Dr. Alok Misra", "Alok Misra", "Akshansh", "Dr. Jaspreet" | Strips titles and matches partial names, so all variants resolve to one person |
| A different status column on every tab — `MARs Registration`, `Verification Status`, `Taken/Not-Taken`, `PAN CARD STATUS` | Detects each tab's status columns and keeps that tab's own vocabulary in the dropdown |
| Several status columns on one tab (L&T has five) | Shows all of them when you open that tab |
| Mentor written once with blank rows under it | Carries the mentor down, and marks those rows "carried" |
| `ToDo` tab listing tasks, deadlines and links | Becomes the task board at the top of the portal |
| Tabs that are not student rosters (`Research Target`, `CSE Top 200`, `Cognizant Selected`) | Skipped, and the reason is shown to the HOD |
| Faculty-level tabs with no students (`Edu-Rev Projects`) | Shown with the project title in place of a student name |

Run against your actual file, it reads **20 of 24 tabs, 4,236 rows, 11 board items**, and resolves **19 mentors**.

---

## What is in this repository

| File | Purpose | Do you edit it? |
|---|---|---|
| `index.html`, `app.js`, `style.css` | The website | No |
| `config.js` | Your API URL and Client ID | **Yes — 2 lines** |
| `apps-script/Code.gs` | The backend, pasted into Apps Script | **Yes — 2 lines** |
| `SETUP.md` | This guide | No |

```
Mentor's browser              Google                    Your sheet
────────────────              ──────                    ──────────
GitHub Pages site ──sign in──► Google Identity
                  ◄─ID token── Services

  fetch(API_URL + token) ─────► Apps Script web app ───► reads every tab
                                verifies the token       matches Mentor UID
                                decides who they are     or mentor name
  ◄──── only the rows they may see ───────────────────
```

Mentors never get access to the spreadsheet itself. The script runs as you and hands out only their rows.

---

## Step 1 — Put the code on GitHub and switch on Pages

Do this first: Google needs your live URL in step 3.

1. Create a repository, name it `domain-task-portal`, make it **Public**.
2. **Add file → Upload files** and drop in everything from this folder, including the `apps-script` folder. Commit.
3. **Settings → Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. After a minute your site is at `https://YOUR-USERNAME.github.io/domain-task-portal/`. It will show a configuration message for now — expected.

Keep two things handy: that full URL, and the bare origin `https://YOUR-USERNAME.github.io`.

---

## Step 2 — Install the backend in your sheet

1. Open the **DevOps Domain Task Sheet** → **Extensions → Apps Script**.
2. Delete everything in `Code.gs`, paste the whole of `apps-script/Code.gs` from this repository.
3. Edit two lines near the top:

```javascript
CLIENT_ID: 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',  // filled in at step 3
MASTER_EMAILS: ['gursharan.singh@lpu.in'],                          // whoever gets full access
```

`MASTER_EMAILS` can hold several addresses — the HOD, the HOS, a coordinator.

4. Save, name the project **Domain Portal API**, and reload the spreadsheet tab in your browser. A **Task Portal** menu appears.

---

## Step 3 — Build the two control tabs

In the spreadsheet: **Task Portal → Set up portal**. Approve the permission prompt the first time (your account → *Advanced* → *Go to Domain Portal API (unsafe)* → **Allow**; that warning just means the script is unverified and yours).

Two tabs appear.

### `_Faculty` — the one manual step

Every mentor found across your tabs, with their UID and each spelling of their name:

| Mentor UID | Faculty name | Email (fill this in) | Role | Name variants found in sheets |
|---|---|---|---|---|
| 16967 | Dr. Gursharan Singh | | FACULTY | Dr. Gursharan Singh |
| 31011 | Dr. Alok Misra | | FACULTY | Dr. Alok Misra \| Alok Misra |
| 35154 | Akshansh Rana | | FACULTY | Akshansh Rana \| Akshansh |

**Fill in the Email column.** That is the whole job — about 19 rows.

- **Role** takes `FACULTY`, `HOD` or `MASTER`. `HOD` also sees rows where they are named in a *Mentor HOD* column. `MASTER` sees everything.
- Add any missing spelling to **Name variants**, separated by `|`. The portal matches on those too.
- Re-run **Refresh faculty list** after new mentors appear; existing emails are kept.

### `_Tasks` — check it, do not retype it

Every tab, with what the portal detected, plus title, deadline and link pulled from your `ToDo` tab:

| Tab name | Show in portal | Task title | Deadline | Header row | Owner column | Status columns | Done values | Link |
|---|---|---|---|---|---|---|---|---|
| DOC Verification | Yes | Document Verification | 28th August | 2 | Mentor Name | Verification Status | | https://forms.gle/… |
| MARs Registration | Yes | MARs Status of Mentees | 1st Sept | 1 | Placement Mentor | MARs Registration 31st August 2026 \| Status of Mock Test Attempted… | | |

Three things worth doing here:

- Set **Show in portal** to `No` for anything mentors should not open — `Only PAN Verification` holds PAN status and parent numbers, for instance.
- Trim **Status columns** where detection was greedy. `L & T` picks up seven; keep the two that matter, separated by `|`.
- Use **Done values** when a tab's vocabulary is unusual — for `Cognizant Test Status`, put `Taken` there so everything else counts as open.

Leave a cell blank and the portal falls back to what it detected.

---

## Step 4 — Create the Google Client ID

1. [console.cloud.google.com](https://console.cloud.google.com) → new project, **Domain Portal**.
2. **APIs & Services → OAuth consent screen**. Choose **Internal** if LPU uses Google Workspace, which skips the next warning entirely. Otherwise **External**, then open **Audience** and press **Publish app** — an External app left in *Testing* only lets listed test users sign in, and that is the most common reason faculty get locked out.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorised JavaScript origins**, both, exactly, no trailing slash and no path:
     ```
     https://YOUR-USERNAME.github.io
     http://localhost:8000
     ```
   - Leave redirect URIs empty. Create.
4. Copy the **Client ID**, paste it into `CLIENT_ID` in `Code.gs`, and save.

If your mentors all use `@lpu.in`, also set `ALLOWED_DOMAIN: 'lpu.in'` in `Code.gs` to block personal Gmail accounts.

---

## Step 5 — Deploy and connect

1. In Apps Script: **Deploy → New deployment** → gear icon → **Web app**.
   - **Execute as: Me**
   - **Who has access: Anyone** ← required. Access is enforced by the token check inside the script; picking *Anyone with a Google account* breaks the request instead of securing it.
   - Deploy and copy the **Web app URL**, ending in `/exec`.
2. Edit `config.js` in your GitHub repository:

```javascript
window.PORTAL_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
  GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
  INSTITUTION_NAME: 'Lovely Professional University',
  DEPARTMENT_NAME: 'DevOps Domain'
};
```

Commit. The site rebuilds in under a minute.

---

## Step 6 — Test it

1. Sign in as yourself. You should see the task board, four figures, two charts, and every row.
2. Sign in as a mentor in a private window. They should see only their own students, no charts, no Faculty column.
3. Change a dropdown and watch the cell change in the sheet.
4. Check the grey line under the table. It names any tab the portal could not read, and any mentor name that has no match in `_Faculty` — that list is a useful data-quality report on the sheet itself.

---

## Living with it

**Adding a task.** Add a row to `ToDo` with the task, deadline, the tab name in the *Domain Sheet* column and any form link. Create the tab, paste the rows, keep a Mentor UID or Mentor Name column. Run **Task Portal → Refresh task list** so it appears in `_Tasks`, and it shows up for mentors on their next refresh. No code changes.

**Adding a mentor.** Add their rows, run **Refresh faculty list**, fill in their email.

**Changing `Code.gs`.** Saving is not enough: **Deploy → Manage deployments → pencil → Version: New version → Deploy**. Same URL, new code. Creating a *New deployment* instead gives you a different URL and you would have to update `config.js`.

**Changing the website files.** Commit to GitHub; live in a minute. Hard-refresh (`Ctrl+Shift+R`) if you still see the old page.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| "Account not listed" | Their email is missing from `_Faculty`. Add it against the right UID. |
| "The portal could not reach the Apps Script web app" | `API_URL` must end `/exec`, and deployment access must be **Anyone**. |
| "The given origin is not allowed for the given client ID" | The origin must be `https://user.github.io` exactly — no slash, no repository path. Allow a few minutes. |
| A mentor sees rows that are not theirs | Two people share a UID in the sheet, or a name variant is listed under the wrong person in `_Faculty`. |
| A mentor sees nothing on a tab | Their UID is not in that tab's mentor column, or the tab has `Show in portal = No`. |
| A tab is missing | Check the grey note under the table. Usually no mentor column, or no student column. Set the **Header row** and **Owner column** in `_Tasks` to force it. |
| Too many status dropdowns on one tab | Trim the **Status columns** cell in `_Tasks`. |
| A status shows as open when it is done | Put the exact done values in the **Done values** cell for that tab. |
| "That row moved in the sheet" | Someone inserted or deleted rows while the page was open. Press **Refresh data**. |
| "Token was issued for a different app" | `CLIENT_ID` differs between `Code.gs` and `config.js`. |
| HOD view is slow to load | Expected on the first load — it reads every tab. Extra per-row columns load only when a tab is opened. |

Test locally before pushing with `python3 -m http.server 8000`, then `http://localhost:8000`.

Run **Task Portal → Check what the portal can read** and open **Execution log** to see, tab by tab, exactly which columns were detected.

---

## Privacy and security

- **Filtering happens on the server.** The browser sends a Google-signed token, not an email address; the script verifies it against Google before deciding what to return. Editing the page in DevTools gets nothing extra.
- **Contact numbers, parent numbers, personal emails, CGPA and PAN status** go only to the row's own mentor and to master accounts, and appear only when a row is expanded. Adjust the list in `PRIVATE_COLUMN_WORDS`.
- **Writes are re-checked.** Before any cell is written, the script confirms the row still belongs to that mentor and still holds the same registration number.
- **`config.js` is safe to publish.** An OAuth Client ID is a public identifier tied to the origins you registered. No secret is in this repository.
- **Sessions last about an hour**, then the portal asks the person to sign in again.

## Cost

| Piece | Service | Cost |
|---|---|---|
| Hosting | GitHub Pages | Free |
| API | Google Apps Script | Free, well inside the 20,000 calls/day quota |
| Data | Google Sheets | Free |
| Sign-in | Google Identity Services | Free |
| Charts, styling | Chart.js, Tailwind, both via CDN | Free |
