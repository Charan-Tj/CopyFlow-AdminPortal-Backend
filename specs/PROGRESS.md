# Project Progress: Admin Control Plane

## 🚀 PHASE 1: Admin Authentication
**Goal:** Secure the API and create the Login UI.
- [x] **Backend:** Update Prisma Schema (User model).
- [x] **Backend:** Implement AdminAuthGuard & JWT Strategy.
- [x] **Backend:** Login Endpoint `POST /admin/auth/login`.
- [x] **Backend:** Seed Root Admin.
- [x] **Frontend:** Initialize Next.js App (`admin-dashboard`).
- [x] **Frontend:** Login Page UI & Integration.

## 🧩 PHASE 2: Dynamic Pricing Engine
**Goal:** Move pricing from hardcoded values to Database control.
- [x] **Backend:** Update Prisma (PricingConfig).
- [x] **Backend:** Update `JobsService` to use dynamic pricing.
- [x] **Backend:** Pricing Endpoints (GET/POST).
- [x] **Frontend:** Pricing Dashboard Page.

## 🧩 PHASE 3: Kiosk Ops (Paper & Status)
**Goal:** Manage hardware status.
- [x] **Backend:** Update Kiosk Model (paper status).
- [x] **Backend:** Refill Endpoint.
- [x] **Frontend:** Kiosks Dashboard with Status & Actions.

## 🧩 PHASE 4: Operations & Audit
**Goal:** Visibility into the system.
- [x] **Backend:** Filterable Jobs Endpoint.
- [x] **Frontend:** Audit Log Table.
- [x] **Frontend:** Jobs History Table.

## 🧩 PHASE 5: Hardening & Admin
**Goal:** Final Polish.
- [x] **Backend:** Overview Stats Endpoint.
- [x] **Frontend:** Dashboard Overview Widgets.
- [x] **Frontend:** Cleanup & Navigation.
