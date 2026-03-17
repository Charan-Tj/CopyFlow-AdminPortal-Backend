# Copy Flow Admin Control Plane

## 1. Project Overview
The **Copy Flow Admin Control Plane** is a comprehensive management system for a network of printing kiosks. It consists of a robust **Backend (NestJS)** and a responsive **Frontend Dashboard (Next.js)**. This system allows administrators to:
- Monitor kiosk status (paper levels, heartbeats).
- Manage dynamic pricing for B&W and Color prints.
- View real-time job history and payment statuses.
- Audit system-wide events and administrative actions.
- Securely authenticate via JWT.

---

## 2. Architecture & Tech Stack

### Backend
- **Framework:** NestJS (Node.js)
- **Database:** PostgreSQL (via Prisma ORM)
- **API Documentation:** Swagger (OpenAPI)
- **Authentication:** Passport.js + JWT (JSON Web Tokens)
- **Payment Integration:** PhonePe and Cashfree (Webhooks & Verification)

### Frontend
- **Framework:** Next.js (React)
- **Styling:** Tailwind CSS
- **State Management:** React Hooks
- **HTTP Client:** Native `fetch`

---

## 3. Features Implemented

### Phase 1: Authentication & Security
- **AdminAuthGuard:** Protects sensitive endpoints.
- **JWT Strategy:** Stateless authentication for API requests.
- **Login Flow:** Secure admin login page with token storage.

### Phase 2: Dynamic Pricing Engine
- **Database-Driven Pricing:** Prices are fetched from the `PricingConfig` table, not hardcoded.
- **Management UI:** Admins can update B&W and Color rates instantly via the dashboard.
- **Fallback Logic:** System defaults to safe values if no config is active.

### Phase 3: Kiosk Operations
- **Heartbeat Monitoring:** Tracks `last_heartbeat` to identify offline kiosks.
- **Paper Status:** Monitors levels (`HIGH`, `LOW`, `EMPTY`).
- **Remote Refill:** Admins can trigger a "Refill" action to reset paper status.

### Phase 4: Operations & Audit
- **Job History:** Paginated list of all print jobs with status (PAID, PRINTED, FAILED) and revenue.
- **Audit Logs:** Immutable record of critical actions (e.g., `KIOSK_REFILL`, `PRICING_UPDATE`).

### Phase 5: Dashboard Overview
- **"At a Glance" Metrics:** Total Kiosks, Jobs Today, Revenue Today, and Active Alerts.
- **Navigation:** Centralized hub for quick access to all modules.

---

## 4. Getting Started

### Prerequisites
- Node.js (v18+)
- Docker & Docker Compose (for PostgreSQL)

### Backend Setup
1.  **Navigate to the project root**:
    ```bash
    cd /home/crackjack/Projects/CopyFlow/backend-engine
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the Database**:
    ```bash
    docker-compose up -d
    ```
4.  **Run Migrations & Seed Data**:
    ```bash
    npx prisma migrate dev
    npx prisma db seed
    ```
5.  **Start the Server**:
    ```bash
    npm run start:dev
    ```
    *Server runs on `http://localhost:3000`*

### Frontend Setup
1.  **Navigate to the dashboard directory**:
    ```bash
    cd admin-dashboard
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the Development Server**:
    ```bash
    npm run dev
    ```
    *Dashboard runs on `http://localhost:3001`*

---

## 5. Usage Guide

### Accessing the Dashboard
- **URL:** `http://localhost:3001`
- **Default Credentials:**
    - **Email:** `admin@copyflow.com`
    - **Password:** `admin123`

### Using Swagger API Docs
- **URL:** `http://localhost:3000/api`
- **Instructions:**
    1.  Login via `POST /admin/auth/login` to get an `access_token`.
    2.  Click "Authorize" in Swagger.
    3.  Enter `Bearer <your_token>`.
    4.  Test any endpoint directly from the browser.

---

## 6. Verification & Testing

The project includes automated shell scripts to verify core functionality. Run these from the project root:

1.  **Verify Dynamic Pricing:**
    ```bash
    ./verify_phase2_pricing.sh
    ```
2.  **Verify Kiosk Operations:**
    ```bash
    ./verify_phase3_kiosks.sh
    ```
3.  **Verify Job History & Audit Logs:**
    ```bash
    ./verify_phase4_ops.sh
    ```
4.  **Verify Dashboard Overview Stats:**
    ```bash
    ./verify_phase5_admin.sh
    ```

---

## 7. Future Roadmap (What's Left)
- **Real Hardware Integration:** Connect actual Raspberry Pi heartbeats to the `kiosks` endpoint.
- **Role-Based Access Control (RBAC):** Multiple admin roles (e.g., Super Admin vs. Operator).
- **Email Notifications:** Alerts for "Low Paper" or "Kiosk Offline".
- **Advanced Analytics:** Charts and graphs for weekly/monthly revenue trends.

---

## 8. Repository Structure Recommendation
**Current State:** Monorepo-style (nested folders).
**Recommendation:** **Separate Repositories.**
- **Why?** 
  - **Deployment:** Frontend is best hosted on Vercel/Netlify (Edge), Backend on Docker/Cloud Run/AWS (Long-running process).
  - **CI/CD:** Pipelines are cleaner when triggers are scoped to the specific application.
  - **Scalability:** Allows independent scaling of frontend traffic vs. backend logic.
- **Suggested Structure:**
  - `CopyFlow-Backend` (NestJS)
  - `CopyFlow-Admin-Frontend` (Next.js)
