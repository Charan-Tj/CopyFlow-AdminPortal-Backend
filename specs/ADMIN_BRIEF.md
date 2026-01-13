# Admin Control Plane - Project Brief

**Context:** The Core Backend (NestJS) and Kiosk Edge (Python) are active. You are now adding the Operations Layer.
**Goal:** Enable a human administrator to manage prices, refill paper, and view audit logs.

## 🔧 Tech Stack
* **Backend:** NestJS, Prisma, PostgreSQL, JWT (Admin Guard).
* **Frontend:** Next.js (TypeScript), Tailwind CSS, Shadcn/UI (for tables/forms).
* **State Management:** React Query (TanStack Query) for data fetching.

## 🧱 System Rules (The "Constitution")
1.  **Source of Truth:** The Backend controls all logic. The Frontend is a dumb view layer.
2.  **Audit Trail:** Every state-changing action (Price Change, Paper Refill) must create an `AuditLog` entry in the DB.
3.  **Security:** All `/admin/*` routes in Backend must be protected by an `AdminAuthGuard`.
4.  **Pricing:** Active pricing is global. Changing it only affects *future* jobs.

## 📅 Execution Roadmap

### 🧩 PHASE 1: Admin Authentication (The Gatekeeper)
**Goal:** Secure the API and create the Login UI.
* **Backend:**
    * Update `Prisma`: Add `User` model (email, password_hash, role="ADMIN").
    * Create `AdminAuthGuard`.
    * Endpoint: `POST /admin/auth/login` -> Returns JWT.
    * *Seed:* Create a script to seed one root admin user.
* **Frontend (Next.js):**
    * Initialize Next.js project in `admin-dashboard/`.
    * Create Login Page (`/login`).
    * Store JWT in HTTP-only cookie or LocalStorage (keep it simple for internal tool).

### 🧩 PHASE 2: Dynamic Pricing Engine
**Goal:** Move pricing from hardcoded values to Database control.
* **Backend:**
    * Update `Prisma`: Add `PricingConfig` model (id, bw_price, color_price, active_from, active_until).
    * Logic: Update `JobsService` to fetch the *latest active* price instead of hardcoded values.
    * Endpoint: `GET /admin/pricing` (History), `POST /admin/pricing` (Set new price).
* **Frontend:**
    * Page: `/dashboard/pricing`
    * UI: Display current active price card. Table for price history.
    * Action: Form to update BW/Color price.

### 🧩 PHASE 3: Kiosk Ops (Paper & Status)
**Goal:** Manage hardware status.
* **Backend:**
    * Update `Kiosk` model: Add `paper_status` (OK, LOW, EMPTY) and `paper_count`.
    * Endpoint: `POST /admin/kiosks/:id/refill` -> Resets paper count, logs `PAPER_REFILLED`.
    * Endpoint: `GET /admin/kiosks` -> Returns list with status.
* **Frontend:**
    * Page: `/dashboard/kiosks`
    * UI: Table showing Kiosk ID, Location, Status (Green/Red badge).
    * Action: "Refill Paper" button (requires confirmation).

### 🧩 PHASE 4: Operations & Audit (The Watchtower)
**Goal:** Visibility into the system.
* **Backend:**
    * Endpoint: `GET /admin/jobs` (Paginated, filter by status).
    * Endpoint: `GET /admin/audit-logs` (Read-only).
* **Frontend:**
    * Page: `/dashboard/audit` -> Table of who did what.
    * Page: `/dashboard/jobs` -> List of all print jobs and their payment status.
