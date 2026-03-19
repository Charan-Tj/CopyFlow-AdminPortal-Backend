# CopyFlow Backend Engine 🖨️🚀

The core backend infrastructure powering **CopyFlow** — a distributed cloud print network. This NestJS-based API handles file uploads, payment processing, WhatsApp bot interactions, and real-time WebSocket communication with edge printing kiosks (Nodes).

## 🌟 Key Features

* **Multi-Channel Chatbots:** Native integration with WhatsApp (via Twilio/Meta) and Telegram bots for users to seamlessly upload documents and configure print jobs.
* **Real-time Node Communication:** WebSocket namespace (`/node`) utilizing Socket.IO for pushing instant print jobs to distributed Windows Kiosk clients.
* **Payment Integration:** Secure checkout and webhook verification via Razorpay for per-page printing costs.
* **Document Processing:** Automated page counting and format validation (PDF, DOCX, Images) before spooling.
* **Admin Portal API:** Secure endpoints for managing print nodes, transaction history, and pricing configurations.
* **Cloud Storage:** Supabase integration for temporary document storage using signed URLs.

## 🏗️ Architecture

The backend is built with **NestJS** and uses **Prisma** + **PostgreSQL** for the database.
- **`src/whatsapp`**: Webhook endpoints and service logic for Meta, Twilio, and Telegram providers.
- **`src/payment`**: Razorpay checkout generation and webhook verification.
- **`src/node`**: Node operator authentication, REST polling paths, and Socket.IO gateway (`node.gateway.ts`).
- **`src/print`**: Job status tracking, routing, and final acknowledgment processing.
- **`src/admin`**: JWT-secured endpoints consumed by the Next.js Admin Portal.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- PostgreSQL database
- Supabase account (for file storage)
- Razorpay account (for payments)
- Twilio/Meta/Telegram tokens (for bot interactions)

### Installation

```bash
$ npm install
```

### Environment Variables

Create a `.env` file in the root directory. See `.env.example` (or configure via your deployment platform):
```env
# Database
DATABASE_URL="postgresql://user:pass@host:5432/copyflow"

# Authentication
JWT_SECRET="your_jwt_secret"
NODE_JWT_SECRET="your_node_jwt_secret"

# Cloud & Third-Party
SUPABASE_URL="..."
SUPABASE_KEY="..."
RAZORPAY_KEY_ID="..."
RAZORPAY_KEY_SECRET="..."

# Bot Tokens
TELEGRAM_BOT_TOKEN="..."
META_PHONE_NUMBER_ID="..."
# ... (see codebase for full list)
```

### Running the App

```bash
# Generate Prisma Client
$ npx prisma generate

# Development mode
$ npm run start:dev

# Production mode
$ npm run build
$ npm run start:prod
```

## 📚 API Documentation

Once the server is running, you can access the interactive Swagger documentation at:
**`http://localhost:3000/api`**

## 📟 Kiosk Client (Node)

The actual printing is done by edge clients (Kiosks). The latest client is an **Electron-based Windows app** located in the `Kiosk/` directory, which connects to this backend via WebSocket.

## 📄 License & Ownership
Proprietary software. Created for the CopyFlow Print Network.