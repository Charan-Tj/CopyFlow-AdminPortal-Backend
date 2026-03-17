# CopyFlow Kiosk Web Agent

This folder now contains a local web-based print agent.

## What this does

- Pulls pending jobs from your backend server
- Finds printers connected to the local Windows computer
- Polls true SNMP consumable levels when enabled
- Prints PDF jobs to selected printer
- Sends job updates back to the backend
- Sends periodic printer status updates back to the backend
- Hosts a local dashboard at `http://localhost:4173`

## Your 4 questions answered

1. Can I create a website that takes print jobs from server and prints documents?
   - Yes, with a local agent process. A plain remote browser app cannot directly control local printers without a local bridge.
2. Find printer connected to the computer?
   - Yes, this uses Windows `Get-Printer` via PowerShell.
3. Send job info back to server?
   - Yes, this posts `JOB_UPDATE` events to your backend.
4. Check printer status and update server?
   - Yes, it syncs printer status on interval and posts `PRINTER_STATUS` events.

## Setup

1. Create env file
   - Copy `.env.example` to `.env`
2. Install dependencies
   - `npm install`
3. Start the agent
   - `npm start`
4. Open dashboard
   - `http://localhost:4173`

## Required server endpoints

By default this agent expects:

- `POST /node/auth/login`
- `GET /node/jobs`
- `POST /node/events`

`/node/events` request shape:

- `{ "type": "JOB_UPDATE|PRINTER_STATUS|AGENT_LOGOUT", "agentId": "...", "time": "ISO", "payload": {...} }`

You can change endpoint paths using `.env` values:

- `PENDING_JOBS_PATH`
- `EVENTS_PATH`
- `NODE_EMAIL`
- `NODE_PASSWORD`

SNMP consumable telemetry settings:

- `SNMP_ENABLED`
- `SNMP_COMMUNITY`
- `SNMP_TIMEOUT_MS`

## Notes

- This baseline currently prints PDF files.
- If your backend uses different payload shape, adapt `src/serverApi.js` and `src/agent.js`.

## Added feature set

The kiosk now includes these additional capabilities:

- Duplicate job protection (`jobId` and content fingerprint)
- Retry engine for failed prints (`RETRY_MAX_ATTEMPTS`)
- Queue controls (pause, resume, cancel queued job)
- Cost estimation and revenue tracking
- Printer routing rules (manual rule list via API)
- Printer health score and estimated ink/page forecast
- SLA metrics (success rate, average latency, jobs/hour)
- Error diagnostics summary
- Audit log with actor metadata
- CSV report export for jobs
- Payment registration and reconciliation
- Notification center for failures/offline/duplicate cases
- Document history lifecycle cleanup (`JOB_HISTORY_RETENTION_HOURS`)
- Role-based dashboard login and actor-attributed audit trails
- Direct persistence of kiosk events into Nest `AuditLog` and `PrintJob` state
- Optional real SNMP-based consumable polling

## Local dashboard API highlights

- `GET /api/dashboard`
- `POST /api/jobs/print`
- `POST /api/queue/pause`
- `POST /api/queue/resume`
- `DELETE /api/queue/:jobId`
- `POST /api/estimate-cost`
- `POST /api/payments`
- `GET /api/reconciliation`
- `GET /api/reports/jobs.csv`
- `POST /api/logout`
