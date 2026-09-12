# GramSathi: Email & Web Push Notification Production Setup Guide

This guide provides complete technical documentation for GramSathi's dual notification architecture:
1. **Transactional Email Delivery** via Resend HTTPS API (with SMTP development fallback).
2. **PWA Standards-Compliant Web Push Notifications** via Service Worker and VAPID.

---

## 1. What the Code Now Does

### A. Email Architecture (`backend/services/notifications/mailer.js`)
- **Primary Delivery Path**: Uses the Resend HTTPS API (`resend.emails.send()`). Avoids fragile SMTP/port connections in cloud/serverless environments.
- **Development Fallback**: Seamlessly falls back to Nodemailer (Gmail SMTP) when `RESEND_API_KEY` is not present.
- **RFC 5322 Email Validation**: Validates recipient email syntax prior to provider calls.
- **Provider Status Tracking**: Captures message IDs (`data.id`), error codes, and provider error messages without exposing API keys or secrets in logs.
- **Sandbox Detection & Guidance**: Explicitly flags if `onboarding@resend.dev` is used with non-account recipients, preventing silent failures.
- **Normalized Configuration**: Checks `RESEND_FROM_EMAIL`, `RESEND_FROM`, and `EMAIL_FROM`.

### B. Push Architecture (`backend/services/notifications/pushService.js`)
- **Standards-Based Web Push**: Built on W3C Push API, Notifications API, and VAPID protocol (RFC 8292).
- **Multi-Device Support**: Users can subscribe multiple devices (e.g. mobile phone, tablet, desktop).
- **Automated Invalid Endpoint Pruning**: When push providers (FCM, Mozilla, Apple) return HTTP 404 or 410 (expired/unregistered), the dead endpoint is pruned automatically from MongoDB.
- **Healthcare Privacy Guard**: Strips clinical diagnoses and prescription details from push bodies. Displays safe, actionable summaries (e.g. *"Your diagnostic report is ready. Open GramSathi to view."*).

### C. Service Worker Integration (`frontend/public/push-sw.js` & `dist/sw.js`)
- **Single Unified Service Worker**: Workbox imports `push-sw.js` directly via `workbox.importScripts`. No competing or duplicate service workers exist.
- **`push` Listener**: Parses JSON payload, sets icons (`/pwa-192x192.png`), badges (`/logo.png`), deduplication tags, and vibration patterns.
- **`notificationclick` Listener**: Closes the notification, safely resolves target URLs, guards against open redirects, and focuses/navigates an existing GramSathi window or opens a new tab.

### D. Subscription Storage (`backend/models/PushSubscription.js`)
- Persists user push subscriptions in MongoDB with compound index on `{ userId: 1, active: 1 }` and unique index on `endpoint`.
- Tracks device `userAgent` and `lastUsedAt`.

### E. Notification Event Integration (`backend/services/notifications/notificationService.js`)
- **Unified Dispatcher**: `sendNotification({ userId, email, type, title, body, data, channels })` dispatches to push and email in parallel.
- **Failure Isolation**: An email provider outage does not stop push; a push failure does not stop email.
- **Non-Blocking Execution**: Healthcare workflows (booking, confirming, ordering) are never rolled back or blocked due to external network timeouts.
- **Integrated Events**:
  - **Appointments**: Booked (patient & doctor), Confirmed, Rejected, Cancelled.
  - **Queue / OPD**: Status updates, final session allocation, doctor daily schedule.
  - **Diagnostics**: Medical lab results completed and ready to view.
  - **Health Records**: New clinical encounter record uploaded.
  - **Referrals**: Specialist facility referral created and status transitions.
  - **Pharmacy**: New prescription order placed (alerts pharmacy owner); order status changed to confirmed/ready/completed (alerts patient).

---

## 2. API Documentation

All notification endpoints are mounted under `/api/notifications` and require a valid Bearer token.

### `GET /api/notifications/push/public-key`
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Description**: Returns the server's VAPID public key needed by browser `pushManager.subscribe()`.
- **Response**:
  ```json
  {
    "publicKey": "BCntcZhIAYSf_5I95WZfLl6qEL5NeiswtmAg28x_v8N9pM2QASlcFw6gvtmNylhqJrvhujrjpMOaTgIld08b6IA"
  }
  ```

### `POST /api/notifications/push/subscribe`
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Description**: Registers or updates a device push subscription for the authenticated user.
- **Request Body**:
  ```json
  {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA...",
      "auth": "tBHItJAhVoA2ukNhhQI..."
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Subscription registered successfully",
    "id": "65f1234567890abcdef12345"
  }
  ```

### `POST /api/notifications/push/unsubscribe`
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Description**: Deactivates a device push subscription for the authenticated user.
- **Request Body**:
  ```json
  {
    "endpoint": "https://fcm.googleapis.com/fcm/send/..."
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Subscription deactivated"
  }
  ```

### `POST /api/notifications/push/test`
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Description**: Dispatches a test Web Push alert to all active devices registered to the caller's account.
- **Response**:
  ```json
  {
    "success": true,
    "message": "Dispatched to 1 device(s)",
    "diagnostics": {
      "sent": 1,
      "failed": 0,
      "total": 1
    }
  }
  ```

### `POST /api/notifications/test-email`
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Description**: Dispatches a diagnostic test email to the caller's email address and reports provider details.
- **Response**:
  ```json
  {
    "success": true,
    "recipient": "doctor@gmail.com",
    "diagnostics": {
      "success": true,
      "sent": true,
      "provider": "resend",
      "id": "e3b0c442-98fc-1c14-9aaf-0453a992671a"
    }
  }
  ```

---

## 3. What You Must Configure (Checklist)

> [!IMPORTANT]
> **Never paste secret credentials, private keys, or API tokens into public Git commits or chat.**
> Add them directly to your hosting provider's environment variables dashboard (Vercel / Render).

### Manual Configuration Checklist:
- [ ] **1. Resend Account & API Key**
  - Sign in to [resend.com](https://resend.com).
  - Go to **API Keys** &rarr; **Create API Key** (Permission: `Sending access` or `Full access`).
- [ ] **2. Add & Verify Sending Domain in Resend**
  - In Resend dashboard, navigate to **Domains** &rarr; **Add Domain**.
  - Enter your domain (e.g. `gramsathi.org` or a subdomain `mail.gramsathi.org`).
- [ ] **3. Copy & Apply DNS Records**
  - Copy the exact **SPF (TXT)**, **DKIM (CNAME / TXT)**, and **DMARC (TXT)** records provided by Resend into your DNS manager (Cloudflare, GoDaddy, Namecheap, etc.).
- [ ] **4. Configure Backend Environment Variables (Render / Host)**
  - Set `RESEND_API_KEY=<your-resend-api-key>`
  - Set `RESEND_FROM_EMAIL=notifications@yourdomain.com` (Use your verified domain)
  - Set `VAPID_PUBLIC_KEY=BCntcZhIAYSf_5I95WZfLl6qEL5NeiswtmAg28x_v8N9pM2QASlcFw6gvtmNylhqJrvhujrjpMOaTgIld08b6IA`
  - Set `VAPID_PRIVATE_KEY=<server-private-key>`
  - Set `VAPID_SUBJECT=mailto:support@gramsathi.org`
- [ ] **5. Configure Frontend Environment Variables (Vercel)**
  - Set `VITE_API_URL=https://sih2026-2h1k.onrender.com/api`
  - Set `VITE_SIGNAL_URL=https://sih2026-2h1k.onrender.com`

---

## 4. DNS Setup (Resend Domain Verification)

> [!CAUTION]
> Do **NOT** invent DNS values. You must copy the exact values generated for your domain in your Resend Dashboard.

Resend requires three types of DNS records to authenticate your sender domain:

1. **DKIM (DomainKeys Identified Mail)**:
   - **Type**: `CNAME` or `TXT` (as specified by Resend)
   - **Name / Host**: e.g., `resend._domainkey` or `resend._domainkey.yourdomain.com`
   - **Value**: Exact string provided by Resend.
2. **SPF (Sender Policy Framework)**:
   - **Type**: `TXT`
   - **Name / Host**: e.g., `bounces` or `@`
   - **Value**: `v=spf1 include:amazonses.com ~all` (or the exact SPF line shown by Resend).
3. **DMARC (Domain-based Message Authentication)**:
   - **Type**: `TXT`
   - **Name / Host**: `_dmarc`
   - **Value**: `v=DMARC1; p=none;` (or as recommended by Resend).

Once added, click **Verify Domain** in Resend. Status will transition to **Verified**.

---

## 5. Deployment & Environment Variables Reference

### Backend Server Variables (Render / Serverless)

| Variable Name | Required | Example / Description |
|---|---|---|
| `PORT` | Yes | `5001` (or assigned by host) |
| `FRONTEND_URL` | Yes | `https://sih-2026-roan.vercel.app` |
| `MONGO_URI` | Yes | MongoDB Atlas connection URI |
| `JWT_SECRET` | Yes | Server-side authentication secret |
| `RESEND_API_KEY` | Yes | `re_123456789...` (Server-side only) |
| `RESEND_FROM_EMAIL` | Yes | `notifications@yourdomain.com` (Verified address) |
| `EMAIL_FROM_NAME` | Optional | `GramSathi` (Defaults to `GramSathi`) |
| `VAPID_PUBLIC_KEY` | Yes | `BCntcZhIAYSf_5I95WZfLl6qEL5NeiswtmAg28x_v8N9pM2QASlcFw6gvtmNylhqJrvhujrjpMOaTgIld08b6IA` |
| `VAPID_PRIVATE_KEY` | Yes | Server-side elliptic curve private key (**Never expose to client**) |
| `VAPID_SUBJECT` | Yes | `mailto:support@gramsathi.org` |

### Frontend Variables (Vercel)

| Variable Name | Required | Example / Description |
|---|---|---|
| `VITE_API_URL` | Yes | `https://sih2026-2h1k.onrender.com/api` |
| `VITE_SIGNAL_URL` | Yes | `https://sih2026-2h1k.onrender.com` |

---

## 6. Testing & Validation Checklist

### Step 1: Verify Email Delivery
1. Sign in to GramSathi with any Gmail address (e.g. `patient.test@gmail.com`).
2. Trigger the diagnostic test:
   ```bash
   curl -X POST https://sih2026-2h1k.onrender.com/api/notifications/test-email \
     -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
   ```
3. Verify the response has `"success": true` and `"provider": "resend"`.
4. Inspect your Gmail inbox to confirm message arrival.

### Step 2: Verify Web Push on Desktop / Android (PWA)
1. Open GramSathi in Google Chrome, Edge, or Firefox.
2. Sign in to your account.
3. Click the **Notification Bell** icon in the navigation header.
4. Click **Enable Notifications**.
5. When the browser prompts *"GramSathi wants to show notifications"*, select **Allow**.
6. The bell indicator turns green (**Active**).
7. Click **Send Test Alert**.
8. A native system notification will appear:
   - **Header**: *GramSathi Push Verification*
   - **Body**: *Web Push notifications are working properly on your device!*
   - **Icon**: GramSathi logo.
9. Click the notification: GramSathi window is focused and navigated to the application root.

### Step 3: Verify Background & Offline Push
1. Close all GramSathi browser tabs or minimize the PWA.
2. Trigger a notification from a different session (e.g. book an appointment or send a test push).
3. The device receives the notification tray alert even with the PWA closed.

---

## 7. Troubleshooting Guide

| Issue | Root Cause | Solution |
|---|---|---|
| Email error: `You can only send testing emails to your own email address...` | Using `onboarding@resend.dev` to email arbitrary recipients | Set `RESEND_FROM_EMAIL` to an address on your verified domain in the Resend dashboard. |
| Email returns `not_configured` | Missing `RESEND_API_KEY` on backend | Add `RESEND_API_KEY` to Render/Vercel environment variables and redeploy. |
| Email provider returns 200/Success but Gmail does not receive it | Missing SPF/DKIM or Gmail Spam filtering | Check spam folder; verify SPF/DKIM DNS records in Resend dashboard. |
| Push returns `unsupported` | Browser does not support Web Push (e.g. Safari on iOS without Home Screen installation) | On iOS 16.4+, user must tap Share &rarr; "Add to Home Screen" and open from Home Screen. |
| Push error: `permission_denied` | User clicked "Block" on notification prompt | User must click the site settings/lock icon in browser URL bar, set Notifications to "Allow", and reload. |
| Push subscriptions return 404 or 410 in server logs | User uninstalled browser or cleared site data | Normal lifecycle: GramSathi's `pushService` automatically prunes expired subscriptions from MongoDB. |
| CORS error contacting backend | Origin mismatch between frontend and backend | Verify `server.js` contains `https://sih-2026-roan.vercel.app` and `FRONTEND_URL` is configured. |

---

## 8. Security Summary

- **Zero Secret Inlining**: Private keys (`VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, `JWT_SECRET`, `MONGO_URI`) are strictly server-side and never prefixed with `VITE_` or sent to the browser.
- **Server Authorization**: Client requests cannot forge user IDs or send push notifications to other users; all subscriptions and dispatches derive the actor from verified JWT claims.
- **HIPAA / Rural Privacy Guard**: Push payloads never contain diagnoses, lab values, or medications.
- **Open Redirect Guard**: Service worker validates destination URLs against `self.location.origin` before navigation.
