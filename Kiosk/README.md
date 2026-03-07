# CopyFlow Kiosk App (Windows Print Agent)

This folder contains a Windows desktop app that:
- pulls print jobs from server,
- prints through local Windows printers,
- sends completion/failure callbacks,
- provides a live monitoring UI for printers, queues, jobs, and alerts.

## Current Implementation Status

Implemented in this starter:
- Electron desktop shell
- Worker engine with polling and heartbeat loops
- Printer discovery (PowerShell `Get-Printer` with fallback)
- Per-printer queue management
- Simulated print pipeline (`downloading -> spooling -> printing -> success`)
- Callback integration stubs (`complete`, `failed`, `heartbeat`)
- Live UI dashboard
- Operator controls:
- pause/resume queue per printer
- acknowledge alerts
- enqueue mock jobs for testing

## Folder Structure

```text
Kiosk/
  .env.example
  package.json
  src/
    main.js
    preload.js
    renderer/
      index.html
      app.js
      styles.css
    worker/
      agent.js
      state-store.js
      services/
        config-service.js
        printer-service.js
        job-service.js
        queue-service.js
        print-service.js
      utils/
        logger.js
  readme.mmd
```

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
copy .env.example .env
```

3. Start app:

```bash
npm run start
```

## Environment Variables

All runtime values are configuration-driven through `.env` (no in-code operational defaults).

- `DEVICE_ID`: unique client machine id
- `API_BASE_URL`: backend root URL
- `API_TOKEN`: bearer token for backend (optional)
- `NODE_EMAIL`: node login email
- `NODE_PASSWORD`: node login password
- `POLL_INTERVAL_MS`: next-job polling interval
- `HEARTBEAT_INTERVAL_MS`: heartbeat interval
- `PRINTER_REFRESH_INTERVAL_MS`: printer discovery refresh interval
- `DEFAULT_PRINTER`: preferred printer (optional)
- `FALLBACK_PRINTERS`: comma-separated fallback printer names
- `SIMULATE_PRINT`: `true` or `false`
- `MOCK_FILE_URL`: URL used for mock jobs
- `MOCK_OWNER`: owner label used for mock jobs
- `MOCK_PRIORITY`: priority label used for mock jobs
- `MOCK_FILE_PREFIX`: generated mock file prefix
- `UNKNOWN_PRINTER_NAME`: fallback printer label when none can be resolved
- `UNKNOWN_FILE_NAME`: fallback file label when name/url is missing
- `UNKNOWN_OWNER_NAME`: fallback owner label when owner is missing
- `HEARTBEAT_PAPER_LEVEL`: heartbeat paper level (`HIGH` / `LOW` / `EMPTY`)
- `HEARTBEAT_INK_BLACK`: heartbeat black ink percentage
- `STAGE_DOWNLOAD_MS`: simulated download stage duration
- `STAGE_SPOOL_MS`: simulated spool stage duration
- `STAGE_PRINT_MS`: simulated print stage duration
- `APP_VERSION`: app version attached to heartbeat payload

## API Contract Used by Worker

- `POST /node/auth/login`
- `POST /node/heartbeat`
- `GET /node/jobs`
- `PATCH /node/jobs/:job_id/claim`
- `POST /node/jobs/:job_id/acknowledge`
- `POST /node/jobs/:job_id/fail`

Polling strategy:
- heartbeat every `HEARTBEAT_INTERVAL_MS`
- pending jobs polling every `POLL_INTERVAL_MS`
- claim immediately before queueing
- acknowledge or fail after print attempt

Worker behavior if API is unavailable:
- keeps running,
- logs warning,
- raises UI alerts,
- continues local monitoring and mock test flow.

## UI Features Included

- Header health line:
- worker status
- API connectivity
- last heartbeat time

- Dashboard metrics:
- total printers
- online printers
- busy printers
- queued jobs
- failed jobs
- unacknowledged alerts

- Printers panel:
- printer cards
- model/status
- queue length
- active job
- pause/resume control

- Queue panel:
- filter by printer
- queued jobs table

- Recent jobs panel:
- final status and completion time

- Alerts panel:
- latest alerts with acknowledge action

- Logs panel:
- live worker logs

## Notes About Printing Adapter

`src/worker/services/print-service.js` currently simulates physical print flow to keep development unblocked.

To use real printing:
- integrate a Windows print adapter (`pdf-to-printer` or direct spooler command),
- keep the same stage callback model,
- map adapter errors to `failJob` callback payload.

## Packaging (Windows Installer)

Build installer:

```bash
npm run dist
```

This uses `electron-builder` with NSIS target configured in `package.json`.

## Next Implementation Steps

1. Replace simulated printer execution with real print adapter.
2. Add retry queue persistence (SQLite).
3. Add job reassignment and cancel actions in UI.
4. Add secure token storage (Windows Credential Manager).
5. Add auto-update workflow.
