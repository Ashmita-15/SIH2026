# GramSathi PWA Implementation Analysis

## Overview
This document contains the comprehensive analysis of the existing GramSathi MERN application as required by **Phase 0** of the PWA transformation roadmap.

---

## 1. Technical Baseline & Answers to Phase 0 Inquiries

### 1. Is frontend Vite?
**Yes.** The frontend is built using **Vite v5.4.2** (`vite: ^5.4.2`, `@vitejs/plugin-react: ^4.3.1`, ES modules `type: "module"`).

### 2. React version?
**React v18.3.1** and `react-dom: ^18.3.1`.

### 3. Router?
**`react-router-dom: ^6.26.1`**.
Routing uses `<Routes>` and `<Route>` in `src/App.jsx` with code-split lazy routes (`React.lazy` / `<Suspense>`):
- Landing page (`/`)
- Login/Signup (`/login`)
- Role-scoped dashboards:
  - `/patient/*` (`PatientDashboard`)
  - `/doctor/*` (`DoctorDashboard`)
  - `/pharmacy/*` (`PharmacyDashboard`)
  - `/hospital/*` (`HospitalDashboard`)
  - `/health-worker/*` (`HealthWorkerDashboard`)
- Legacy aliases/redirects (`/doctors`, `/pharmacies`, `/checkout/:pharmacyId`, `/order-success/:orderId`).

### 4. Axios or fetch?
**Both are used, with Axios being primary:**
- **Axios (`axios: ^1.7.2`)**: Configured as an instance in `src/services/api.js` with Bearer token injection and 401 interceptors.
- **Fetch**: Used in `src/lib/assistantClient.js` for custom payloads / assistant communication.

### 5. API base URL?
Configured in `src/services/api.js`:
```javascript
baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
```
Production Backend Base URL:
```text
https://sih2026-2h1k.onrender.com/api
```
Socket.IO Signal URL:
```javascript
import.meta.env.VITE_SIGNAL_URL || 'http://localhost:5000'
```
Production Socket.IO Signal URL:
```text
https://sih2026-2h1k.onrender.com
```

### 6. Authentication mechanism?
- **JSON Web Tokens (JWT)**: Generated upon successful login via `jwt.sign({ id, role, name }, JWT_SECRET, { expiresIn: '7d' })`.
- Sent by client on every HTTP request as `Authorization: Bearer <token>`.
- Verified server-side by `backend/middleware/authMiddleware.js` (`authRequired` and `authorizeRoles`).
- Roles supported: `patient`, `doctor`, `pharmacy`, `hospital`, `health_worker`.

### 7. JWT / Cookie / localStorage usage?
- **localStorage keys in frontend**:
  - `token`: Stored as raw JWT string.
  - `user`: Stored as serialized JSON `{ id, role, name, workerType, hospitalId }`.
  - `i18nextLng`: UI language preference (`en`, `hi`, `pa`).
  - `gramsathi:assistant:outbox`: Assistant unsent message queue.
  - `gramsathi:assistant:offline:<lang>`: Cached offline knowledge pack for assistant.
- **Cookies**: Not used for session or API auth (header-based JWT only).
- **SessionStorage**: Used for `auth:returnTo` redirect after session timeout.

### 8. Existing environment variables?
- **Frontend**:
  - `VITE_API_URL` (production: `https://sih2026-2h1k.onrender.com/api`)
  - `VITE_SIGNAL_URL` (production: `https://sih2026-2h1k.onrender.com`)
- **Backend**:
  - `PORT` (defaults to `5001` or Render-provided)
  - `MONGO_URI` (defaults to `mongodb://127.0.0.1:27017/telemedicine_mvp`)
  - `JWT_SECRET` (defaults to `dev_secret`)
  - `FRONTEND_URL` (configured in CORS whitelist)
  - `EMAIL_USER`, `EMAIL_APP_PASSWORD` (Gmail SMTP in dev)
  - `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` (Resend HTTPS API in prod)
  - `NODE_ENV`

### 9. Existing service worker?
**None.** There is no active Service Worker registration, sw file, or workbox config.

### 10. Existing manifest?
**None.** `index.html` has `<meta name="theme-color" content="#0B5F63" />` and `<link rel="icon" type="image/png" href="/logo.png" />`, but no `manifest.json` / `<link rel="manifest">`.

### 11. Existing caching?
- `src/lib/assistantStore.js` uses IndexedDB (`gramsathi` database, version 1, object store `assistant-threads`) for storing assistant chat history.
- `src/lib/assistantClient.js` caches static offline health guidance in `localStorage`.
- No HTTP response caching or Service Worker asset caching exists yet.

### 12. Socket.IO?
**Yes.**
- **Backend**: Attached in `server.js` with CORS support for allowed origins.
  - Rooms: `user_${userId}`, `pharmacy_${pharmacyId}`, `pharmacy-updates-${pharmacyId}`, video call rooms `roomId`.
  - Events: `new-order`, `order-status-updated`, `stock-updated`, `medicine-added`, `medicine-removed`, WebRTC signaling (`join-room`, `signal`, `call-declined`, `call-ended`).
- **Frontend**: Connected dynamically in `PharmacyShop.jsx`, `PharmacyDashboard.jsx`, and `VideoCall.jsx`.

### 13. WebRTC?
**Yes.**
- Implemented in `src/components/VideoCall.jsx`, `src/utils/SimpleWebRTC.js`, and `src/utils/SimplePeerLoader.js`.
- Uses `simple-peer` over Socket.IO signaling to establish peer-to-peer audio/video consultations between doctors and patients.
- Requires live network connection (Category C - Online only).

### 14. Notifications?
- **Transactional Emails**: Handled on backend via `backend/services/notifications/mailer.js` (Resend API in prod, Nodemailer in dev). Emails sent on account creation, appointment bookings/confirmations, queue alerts.
- **In-App Realtime Badges**: Emitted via Socket.IO for orders and domestic events (`appointments:changed`).
- Push notifications / Web Push API: Not currently implemented.

### 15. Important forms?
- **Login / Signup**: `src/pages/LoginSignup.jsx` (role selection, multi-field registration).
- **Appointment Booking**: `src/components/patient/BookingForm.jsx` (supports slot/session picking, multipart symptom notes and media file uploads).
- **Clinical Health Record Creation**: `src/components/PatientTracker.jsx` (diagnosis, prescription, appointment linkage).
- **Frontline Health Worker Forms**: `src/pages/HealthWorkerDashboard.jsx` (patient intake, clinical encounters, maternal/child vitals, teleconsultation referral).
- **Pharmacy Inventory & Cart Checkout**: `src/pages/PharmacyDashboard.jsx` (medicine stock CRUD) & `src/pages/CheckoutPage.jsx` (order placement, address, prescription upload).
- **Hospital Staff & Facility Management**: `src/pages/HospitalDashboard.jsx`.
- **User Profile**: `src/components/ProfileSection.jsx` (profile details, password updates).

### 16. API Endpoints Map (Methods, Roles & Sensitivity)

| Endpoint | Method | Role / Middleware | Sensitivity | Category |
|---|---|---|---|---|
| `/api/auth/register` | POST | Public | High (Password) | C (Online only) |
| `/api/auth/login` | POST | Public | High (Credentials, JWT) | C (Online only) |
| `/api/users/:id/password` | PUT | authRequired | High (Password) | C (Online only) |
| `/api/appointments/book` | POST | authRequired | Moderate (Symptoms/Media) | B (Queueable) |
| `/api/appointments/patient/:id` | GET | authRequired | Sensitive (Appointments) | A/B (User-isolated Cache) |
| `/api/appointments/doctor/:id` | GET | authRequired | Sensitive (Appointments) | A/B (User-isolated Cache) |
| `/api/appointments/doctor/:id/availability` | GET | authRequired | Low (Available slots) | A (Network-First / Cache) |
| `/api/appointments/queue` | GET | authRequired | Low (Queue counts) | C (Online only) |
| `/api/appointments/queue/notify` | POST | authRequired | Low (Trigger email) | C (Online only) |
| `/api/appointments/:id/confirm` | PUT | authRequired (Doctor) | Moderate | B (Queueable) |
| `/api/appointments/:id/reject` | PUT | authRequired (Doctor) | Moderate | B (Queueable) |
| `/api/appointments/:id/complete` | PUT | authRequired (Doctor) | Moderate | B (Queueable) |
| `/api/appointments/:id/cancel` | PUT | authRequired | Moderate | B (Queueable) |
| `/api/appointments/media/:filename` | GET | authRequired | Moderate (Media) | C / Cache-first if downloaded |
| `/api/records/create` | POST | authRequired (Doctor) | High (Medical Record) | B (Queueable) |
| `/api/records/:patientId` | GET | authRequired | High (Clinical history) | A/B (User-isolated Cache) |
| `/api/records/:patientId/download` | GET | authRequired | High (PDF) | C (Online only) |
| `/api/health-worker/me` | GET | health_worker | Low (Profile) | A (User-isolated Cache) |
| `/api/health-worker/danger-rules` | GET | health_worker | Public clinical rules | A (Cache-First) |
| `/api/health-worker/patients` | GET | health_worker | Sensitive (Catchment PII)| A/B (User-isolated Cache) |
| `/api/health-worker/patients` | POST | health_worker | Sensitive (Patient intake)| B (Queueable) |
| `/api/health-worker/patients/:id` | GET | health_worker | Sensitive (Patient PII) | A/B (User-isolated Cache) |
| `/api/health-worker/patients/:id/encounters` | POST | health_worker | High (Clinical vitals) | B (Queueable) |
| `/api/health-worker/patients/:id/encounters` | GET | health_worker | High (Clinical history) | A/B (User-isolated Cache) |
| `/api/health-worker/patients/:id/consultations`| POST | health_worker | Moderate | B (Queueable) |
| `/api/health-worker/patients/:id/care-plans` | POST | health_worker | Moderate | B (Queueable) |
| `/api/pharmacy/all` | GET | Public | Low (Directory) | A (Stale-While-Revalidate) |
| `/api/pharmacy/:id` | GET | Public | Low (Profile) | A (Stale-While-Revalidate) |
| `/api/pharmacy/:id/medicines` | GET | Public | Low (Catalog) | A (Stale-While-Revalidate) |
| `/api/pharmacy/search/stock/:name` | GET | Public | Low (Stock search) | C / Network-First |
| `/api/pharmacy/cart/:id` | GET | authRequired (Patient) | Low (Cart) | B (Local cart) |
| `/api/pharmacy/cart/add` | POST | authRequired (Patient) | Low (Cart) | B (Local cart) |
| `/api/pharmacy/orders` | POST | authRequired (Patient) | Moderate (Order items) | B (Queueable) |
| `/api/pharmacy/my/patient-orders` | GET | authRequired (Patient) | Moderate (Order list) | A/B (User-isolated Cache) |
| `/api/pharmacy/medicines` | POST | authRequired (Pharmacy) | Low (Inventory) | B (Queueable) |
| `/api/pharmacy/medicines/:id` | PUT | authRequired (Pharmacy) | Low (Stock update) | B (Queueable) |
| `/api/pharmacy/orders/:id/status` | PUT | authRequired (Pharmacy) | Low (Status change) | B (Queueable) |
| `/api/users/doctors` | GET | authRequired | Low (Doctor directory) | A (Stale-While-Revalidate) |
| `/api/users/doctors/specialization` | GET | authRequired | Low (Specializations) | A (Stale-While-Revalidate) |
| `/api/facilities/*` | GET | authRequired | Low (Directory/tree) | A (Cache-First) |
| `/api/referrals` | POST | authRequired | Moderate (Referrals) | B (Queueable) |
| `/api/referrals` | GET | authRequired | Moderate | A/B (User-isolated Cache) |
| `/api/tasks` | GET | authRequired | Moderate | A/B (User-isolated Cache) |
| `/api/tasks/:id/complete` | PATCH | authRequired | Moderate | B (Queueable) |
| `/api/diagnostics` | POST | authRequired | Moderate (Lab test) | B (Queueable) |
| `/api/diagnostics` | GET | authRequired | Moderate | A/B (User-isolated Cache) |
| `/api/assistant/config` | GET | authRequired | Low (Offline pack) | A (Cache-First) |
| `/api/assistant/chat` | POST | authRequired | High (Medical query) | C (Online only) |
| `/api/assistant/transcribe` | POST | authRequired | Moderate (Audio) | C (Online only) |
| `/api/health` | GET | Public | None (Heartbeat) | Network-Only |

### 17. Sensitive Data Classification
- **NEVER CACHE / STORE PERSISTENTLY**:
  - Raw passwords or password hashes.
  - JWT Secrets, SMTP Passwords, API Keys.
  - Credit/payment information (all checkout uses Cash on Delivery / Pay at Clinic).
- **DO NOT BLINDLY CACHE**:
  - Full medical records, prescriptions, and patient timelines must NOT be placed in unauthenticated or global caches.
  - Cached patient data must be scoped to the authenticated `userId` in IndexedDB.
  - When the user logs out, all user-scoped cached records and pending mutations must be purged or isolated so subsequent users on shared village tablets/kiosks cannot view prior medical information.

### 18. Offline Capabilities Strategy (Category A, B, C)
- **Category A — Fully Offline (Static & Cached)**:
  - Application shell: HTML, CSS, JavaScript chunks, fonts (`Noto Sans`, `Devanagari`, `Gurmukhi`), icons, logos, static illustrations.
  - Navigation fallbacks for client-side routing.
  - Offline reference data: danger signs (`/api/health-worker/danger-rules`), facilities tree (`/api/facilities/tree`, `/api/facilities/meta`), doctor directories, pharmacy catalogs previously viewed.
  - Multilingual translation bundles (`en.json`, `hi.json`, `pa.json`).
  - Assistant offline rulebook (`/api/assistant/config` cached pack).
  - Last-loaded user profile, appointments, and medical records for the current active user in isolated IndexedDB.
- **Category B — Offline + Synchronize Later (Mutations)**:
  - Appointment booking (`POST /api/appointments/book`).
  - Doctor appointment status updates (`PUT /api/appointments/:id/confirm`, `reject`, `complete`, `cancel`).
  - Frontline Health Worker patient registration (`POST /api/health-worker/patients`).
  - Frontline Health Worker clinical encounters (`POST /api/health-worker/patients/:id/encounters`).
  - Frontline Health Worker care plan initiation (`POST /api/health-worker/patients/:id/care-plans`).
  - Doctor clinical health record creation (`POST /api/records/create`).
  - Pharmacy order creation (`POST /api/pharmacy/orders`).
  - Pharmacy stock updates (`PUT /api/pharmacy/medicines/:id`).
  - Task completion (`PATCH /api/tasks/:id/complete`).
  - Diagnostic test orders (`POST /api/diagnostics`).
- **Category C — Online Only**:
  - User registration & login (`POST /api/auth/register`, `POST /api/auth/login`).
  - Password change (`PUT /api/users/:id/password`).
  - Live WebRTC audio/video consultations (`SimpleWebRTC` & `VideoCall.jsx`).
  - Live Socket.IO signaling and real-time room broadcasts.
  - Live AI Gemini chat & voice transcription (`POST /api/assistant/chat`, `POST /api/assistant/transcribe`).
  - Server-side PDF generation & download (`/api/records/:id/download`).
  - Queue live notification triggering (`/api/appointments/queue/notify`).

---

## 2. Checkpoint 0 Verification

- **Frontend Install & Build**:
  - `npm install` executed cleanly with 0 errors.
  - `npm run build` completed successfully in ~990ms (Vite v5.4.20 production bundle generated in `dist/`).
- **Backend Verification**:
  - `npm install` executed cleanly with 0 errors.
  - `node --check server.js` passed syntax and import checks without error.
  - Production backend health check `https://sih2026-2h1k.onrender.com/api/health` returned HTTP 200 `{"status":"ok"}`.
- **Identified Risks & Remediation Plan**:
  1. *IndexedDB collision*: `src/lib/assistantStore.js` already opens database `gramsathi` at version 1 with store `assistant-threads`. Upgrading to version 2 must preserve `assistant-threads` while creating stores for `cache`, `mutationQueue`, and `syncMeta`.
  2. *Shared device data leakage*: Village kiosks and frontline health worker tablets are shared among family members or workers. A robust logout handler must purge or isolate local user cache.
  3. *Idempotency*: When offline mutations are synchronized upon reconnection, a unique `clientOperationId` header/property must accompany requests to prevent duplicate creation if the network drops midway.
  4. *Large media uploads offline*: Voice notes and images in appointment booking require IndexedDB Blob storage rather than string storage; compression before enqueueing is essential.

---

## 3. Conclusion
Phase 0 analysis and build verification are complete. The project is ready to proceed to Phase 1 (PWA Foundation) upon user approval of the implementation plan.
