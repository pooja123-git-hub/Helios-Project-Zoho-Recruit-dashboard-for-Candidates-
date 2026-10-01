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
- Data re-syncs from Zoho every 5 seconds (a full fetch each time, so watch the Zoho API limit). Open pages pick up each new sync automatically.
- The access token is refreshed at startup and every 40 minutes, and again on any 401; the new token is written back to `.env`.
- Email and phone numbers are never sent to the browser.

## Using the dashboard

One page, tables only.

- **Date buttons** — Today, Last week (7 days), Last month (30 days), or Custom with From / To dates.
- **Candidate status table** — how many candidates are Fresh / In Progress in that range. Click a row to list only that status; click Total for all.
- **Call status table** — candidates with a call recorded in that range, by call status (Picked / Contacted, Not Picked, …). Dated by Call Date, or the last-updated date when Call Date is blank.
- **Round status table** — Assessment, Technical, HR and CEO round (Zoho's Final Status field): candidates with a result recorded in that range, by result. Dated by the round's date, or the last-updated date when that is blank.
- **Final decision table** — Offer stages (To-be-Offered, Offer-Accepted, Offer-Declined) and Final result (Joined, Not Joined, Rejected). Final result is dated by Date of Joining, or the last-updated date when that is blank.
- **Candidate list** — the matching candidates; click a column heading to sort, **Export CSV** to download.

Status comes from the custom status picklist (`Candidate_Status1`) when it is filled in, otherwise from the `Fresh_Candidate` checkbox. A Fresh candidate is dated by its created date; any other status by its last-updated date.
