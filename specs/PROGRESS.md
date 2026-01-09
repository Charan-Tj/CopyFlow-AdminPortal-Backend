# Copy Flow Backend - Progress Tracker

## 🧩 PHASE 1: Foundation & Data Layer
**Goal:** Initialize project, Dockerize DB, and apply schema.
- [x] **Setup:** Initialize NestJS project.
- [x] **Infra:** Create `docker-compose.yml` for PostgreSQL.
- [x] **Schema:** Define Prisma models for:
    - [x] `Kiosk` (pi_id, secret, location)
    - [x] `PrintJob` (job_id, kiosk_id, pages, status, payable_amount)
    - [x] `Payment` (job_id, amount, currency, status, razorpay_order_id)
    - [x] `PrintToken` (job_id, token, expires_at, used)
    - [x] `AuditLog` (event, actor, metadata, timestamp)
- [x] **Action:** Run migrations and generate the Prisma client.
- [x] **Deliverable:** Working server connecting to a local Docker Postgres.

## 🧩 PHASE 2: Logic & Pricing Engine
**Goal:** Enable Kiosks to upload job metadata.
- [x] **Endpoint:** `POST /kiosks/:pi_id/jobs`
- [x] **Security:** Middleware to authenticate `pi_id` + `secret`.
- [x] **Logic:**
    - [x] Accept: `page_count`, `color_mode`.
    - [x] Calculate price (e.g., 2 INR for BW, 10 INR for Color).
    - [x] Create `PrintJob` (Status: `UPLOADED_NOT_PAID`).
- [x] **Output:** Return `job_id` and `payable_amount`.

## 🧩 PHASE 3: Razorpay Integration (The Critical Path)
**Goal:** Secure payment handling.
- [x] **Service:** Create `RazorpayService` wrapper.
- [x] **Endpoint:** `POST /jobs/:job_id/pay` -> Creates Razorpay Order -> Returns Order Details.
- [x] **Webhook:** `POST /webhooks/razorpay`
    - [x] Verify `x-razorpay-signature`.
    - [x] Match `order_id` and `amount`.
    - [x] Update `PrintJob` to `PAID`.
    - [x] Create `Payment` record.
    - [x] Log to `AuditLog`.

## 🧩 PHASE 4: The Token Bridge
**Goal:** Generate offline-safe print tokens.
- [ ] **Logic:** Generate HMAC-SHA256 token containing `{job_id, kiosk_id, exp}`.
- [x] **Endpoint:** `GET /kiosks/:pi_id/jobs/:job_id/token`
    - [x] Guard: `KioskAuthGuard`.
    - [x] Logic: Verify `Job.status == PAID` and `Job.kiosk_id == Requesting Kiosk`.
    - [x] Output: HMAC-SHA256 Signed Token `{ payload, signature }`.
- [x] **Safety:** Ensure `PrintToken` record is created to track usage (idempotency foundation).

## 🧩 PHASE 5: Hardening & Admin
**Goal:** Production readiness.
- [x] **Audit:** `AuditLog` model tracks payments and job outcomes.
- [x] **Admin API:**
    - [x] `GET /admin/kiosks`: List details.
    - [x] `GET /admin/jobs`: List recent jobs.
    - [x] `GET /admin/audit-logs`: View history.
- [x] **Docs:** Swagger UI available at `/api`.
