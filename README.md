# Lead_Julia: Archetype placement survey

Participants place 10 cases on a spectrum of 6 archetypes with a slider. A case can sit
exactly on one archetype or anywhere between two. Admins edit the survey, hand out
personal IDs, and see individual answers plus a heat map per case.

Static site (plain HTML/CSS/JS) and Supabase (project `dzywbkiezpznowusvfyo`, "Twin Assessment").
All database objects are prefixed `arch_` so they don't clash with the other apps in that project.

## Pages

| Page | Who | What |
|---|---|---|
| `index.html` | Participants | Enter your own ID (2–60 characters; created on first use, case-insensitive), place each case, submit. Answers autosave; the same ID continues later. |
| `admin.html` | Admins | **Results**: heat map, mean/median/SD, individual table, notes, CSV export. **Participants**: see who started/submitted, add labels, reopen or clear. **Survey setup**: title, intro, slider step, archetypes, cases. |

## Slider values

A position runs from `0` (first archetype) to `5` (sixth). `2.25` means 75% C, 25% D.
Slider movement is set in Survey setup: free (continuous), quarter steps, half steps, or archetypes only.
Each answer also stores `scale_max` (number of archetypes − 1 at the time), so answers stay
interpretable if the archetype count changes later.

## Run locally

```bash
python -m http.server 5173
```

Then open http://localhost:5173/ (survey) or http://localhost:5173/admin.html.

## Hosting

Live on GitHub Pages: https://fimplank.github.io/Lead_Julia/ (admin: `/admin.html`).

## Access model

- Participants use the ID-checked RPCs `arch_get_survey`, `arch_save_response` and `arch_submit`.
- The admin page has **no login** by choice (internal research use). The `arch_` tables are readable and
  editable with the public browser key, so anyone who has the site address or the key can view or change
  the data. Export CSVs regularly as a backup.
- Schema lives in `supabase/migrations/`.

