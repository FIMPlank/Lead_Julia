# Lead_Julia: Archetype placement survey

Participants place 10 cases on a spectrum of 6 archetypes with a slider. A case can sit
exactly on one archetype or anywhere between two. Admins edit the survey, hand out
personal IDs, and see individual answers plus a heat map per case.

Static site (plain HTML/CSS/JS) and Supabase (project `dzywbkiezpznowusvfyo`, "Twin Assessment").
All database objects are prefixed `arch_` so they don't clash with the other apps in that project.

## Pages

| Page | Who | What |
|---|---|---|
| `index.html` | Participants | Enter ID (or open `index.html?id=ABC123`), place each case, submit. Answers autosave. |
| `admin.html` | Admins | **Results**: heat map, mean/median/SD, individual table, notes, CSV export. **Participants**: generate IDs, copy links. **Survey setup**: title, intro, slider step, archetypes, cases. |

## Slider values

A position runs from `0` (first archetype) to `5` (sixth). `2.25` means 75% C, 25% D.
Slider movement is set in Survey setup: free (continuous), quarter steps, half steps, or archetypes only.
Each answer also stores `scale_max` (number of archetypes − 1 at the time), so answers stay
interpretable if the archetype count changes later.

## Admin setup (one-time)

1. Supabase dashboard → Authentication → Users → **Add user** (email + password, auto-confirm).
2. SQL editor:
   ```sql
   insert into arch_admins(email) values ('you@example.com');
   ```
3. Open `admin.html` and sign in.

## Run locally

```bash
python -m http.server 5173
```

Then open http://localhost:5173/ (survey) or http://localhost:5173/admin.html.

## Hosting

Any static host works (GitHub Pages, Netlify, …). Participant links are built from the admin page's
own URL, so generate and copy links from the hosted admin page.

## Security model

- Participants never read tables directly. They call `arch_get_survey`, `arch_save_response` and
  `arch_submit`, which check the ID and only return or change that participant's own answers.
- Admin access is Supabase Auth + the `arch_admins` email allowlist, enforced by row-level security.
- Schema lives in `supabase/migrations/`.
