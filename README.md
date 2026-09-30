# Candidate Analytics Dashboard

Interactive analytics over the Zoho Recruit **Candidates** module (plus Applications and Job Openings for job-level views).

## Run

```
npm start
```

Open http://localhost:3000. Requires Node 18+; no dependencies to install.

Credentials come from `.env` (`ZOHO_ACCESS_TOKEN`, `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_DATA_CENTER`, `ZOHO_ORG_ID`).

## How data flows

- `server.js` fetches every Candidate, Application and Job Opening from Zoho, normalizes them (`lib/transform.js`) and caches the result in `data/cache.json`.
- Data re-syncs from Zoho every 5 seconds (a full fetch each time, so watch the Zoho API limit), or on demand with **Refresh from Zoho**. Open pages pick up each new sync automatically.
- The access token is refreshed at startup and every 40 minutes, and again on any 401; the new token is written back to `.env`.
- Email and phone numbers are never sent to the browser.

## Derived fields

Some dimensions are not native Candidate fields in this org and are derived:

| Dimension | Derived from |
|---|---|
| Country / State / City | Free-text `Current_Location` (falls back to `Hometown_Location`) |
| Gender | `Salutation` (Mr. / Ms. / Mrs.) — covers under 1% of records |
| Experience band | `Work_Exp` text ("Fresher", "6 M", "1.5 Yr", "> 5 Yrs", …) |
| Job opening | Applications linked to the candidate |
| Selection outcome | `Final_Status`, `Hiring_Result`, `HR_Result`, `Technical_Status`, stage |
| Pipeline step | Furthest step reached: sourced → engaged → applied → screened → interviewed → selected → offered/hired |

## Using the dashboard

- Filters sit in one row at the top; every KPI, chart and the records table update together.
- Click any bar, slice, funnel step or month to toggle it as a filter (cross-filtering). Active filters show as chips.
- Each chart has a **Table** toggle; **Export CSV** downloads the filtered records.
