# 🌾 Agri-Procurement & Ledger PWA

A free, installable Progressive Web App (PWA) for recording agricultural
procurement (contract / direct farmer purchases), tracking farmer balances
and payments, and maintaining a cash book — with Google Sheets as the
cloud database.

This is a rebranded clone of an existing cane-procurement app, generalized
for any agri-procurement use case, with the original company branding
(logo, name, login) removed and replaced.

---

## 🗂️ Folder Structure

```
agri-procurement-pwa/
├── index.html              ← The entire app (main file)
├── sw.js                   ← Service worker — makes it work offline
├── manifest.json           ← Makes it installable on phone (PWA manifest)
├── google-apps-script.js   ← Paste this into Google Sheets (Apps Script backend)
├── favicon.ico             ← Browser tab icon
├── icons/
│   ├── icon-192.png        ← App icon (small, crop/wheat themed)
│   ├── icon-512.png        ← App icon (large, crop/wheat themed)
│   └── logo.png            ← In-app logo (crop/wheat themed)
└── README.md                ← This file
```

---

## 🔑 Login Credentials

The app ships with a single pre-set login:

| Field    | Value                    |
|----------|---------------------------|
| Email    | `giricreates@gmail.com`   |
| Password | `giricreates`              |

> ⚠️ To change this, open `index.html`, search for `CREDENTIALS`, and edit
> the email/password values there:
> ```js
> const CREDENTIALS = [
>   {email:'giricreates@gmail.com', pass:'giricreates'}
> ];
> ```
> After editing, redeploy/re-upload `index.html` to your host.

---

## ✅ What You Need

- A Gmail / Google account (for Google Sheets sync)
   if you dont want create use this 
   - sheets:https://docs.google.com/spreadsheets/d/1Bz9zMrEHwCOYFS4WxH414Jx1H_DKoVqn3xO5hOAmgfg/edit?gid=0#gid=0
   - Appscript link:https://script.google.com/macros/s/AKfycbxcXlzBciukUGZjrLkdvaloCFAT9bxz5cb7LY0kx2ej5baSL0cX90Uen8pQ4BHFM5Ge/exec

- A computer, just for one-time setup
- A GitHub account (to push this repo) and a static host such as
  Netlify, Vercel, GitHub Pages, or Cloudflare Pages
- Any Android phone with Chrome, to install and use the app

No coding knowledge is required beyond copy-pasting, and there are no
monthly fees.

---

## 🚀 Part 1 — Push to GitHub

1. Create a new repository on GitHub named, e.g., `agri-procurement-ledger-pwa`.
2. From this folder, run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit — Agri-Procurement & Ledger PWA"
   git branch -M main
   git remote add origin https://github.com/<your-username>/agri-procurement-ledger-pwa.git
   git push -u origin main
   ```

---

## 🌐 Part 2 — Put the App Online

You can deploy straight from GitHub using any static hosting provider.

### Option A — Netlify
1. Go to **https://www.netlify.com** and sign in with GitHub.
2. Click **"Add new site" → "Import an existing project"**.
3. Choose your `agri-procurement-ledger-pwa` repo.
4. Leave build settings empty (this is a static site — no build command,
   publish directory is the repo root `/`).
5. Click **Deploy**. Netlify gives you a URL like
   `https://your-site-name.netlify.app`.

### Option B — GitHub Pages
1. In your repo, go to **Settings → Pages**.
2. Under "Build and deployment", select **Deploy from a branch**.
3. Choose branch `main`, folder `/ (root)`, and save.
4. Your app will be live at
   `https://<your-username>.github.io/agri-procurement-ledger-pwa/`.

---

## 📱 Part 3 — Install on Android Phone

1. Open **Chrome** on your Android phone.
2. Go to the URL from Part 2.
3. Wait for the page to load fully.
4. You'll see a popup: **"Add Agri-Procurement & Ledger PWA to Home screen"**.
   Tap **Add / Install**.
5. If it doesn't appear automatically: tap the **⋮ menu** → **"Add to Home
   screen"** → **Add**.
6. The app icon (crop/wheat logo) now appears on your Home screen and opens
   like a native app, with no browser bar.

---

## 🔐 Part 4 — Login

Use the credentials from the **Login Credentials** section above:
- Email: `giricreates@gmail.com`
- Password: `giricreates`

---

## ☁️ Part 5 — Google Sheets Sync Setup

The app uses a Google Sheet as its live database — every device signed in
with the same login sees the same data.

### Step 1 — Create a Google Sheet
1. Go to **https://sheets.google.com** → **"+ Blank"**.
2. Name it, e.g., **"Agri Procurement Records"**.

### Step 2 — Add the Apps Script
1. In the Sheet, click **Extensions → Apps Script**.
2. Delete any existing starter code.
3. Open `google-apps-script.js` from this folder, copy all of it, and
   paste it into the Apps Script editor.
4. Save (Ctrl+S), name the project (e.g., "Agri PWA Webhook").

### Step 3 — Deploy as a Web App
1. Click **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" → **Web app**.
3. Fill in:
   - **Description:** Agri PWA Webhook
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone
4. Click **Deploy**, then **Authorize access** and allow the permissions
   requested (this is your own script — it's safe).
5. Copy the **Web app URL** — it looks like
   `https://script.google.com/macros/s/AKfycb.../exec`.

### Step 4 — Connect the App
1. Open the app on your phone and log in.
2. Go to **⚙️ Settings** → **Apps Script Webhook**.
3. Paste the Web app URL and save.
4. The app will now sync records, farmers, payments, and cash book entries
   to your Google Sheet automatically.

The script auto-creates the required sheets/tabs (**Records**, **Farmers**,
**Payments**, **Cash Book**) the first time it runs.

---

## ✨ Features

- Contract & Direct farmer procurement entry with auto-calculations
  (gross/tare weight, deduction %, rate-based totals)
- Optional Land Owner field, treated as an independent farmer identity
- Farmer master list with autocomplete, search, and filters
- Outstanding balance tracking with Record Payment + WhatsApp receipts
- Cash Book (manual expenses + automatic procurement payment entries)
- Delete farmer profile (never deletes procurement/payment history)
- WhatsApp sharing of weighment slips and payment receipts
- Offline-first storage with automatic sync when back online
- Google Sheets as the cloud database — same data on every device
- CSV export / download
- Bilingual UI (Kannada + English)
- Installable on Android as a PWA — no Play Store needed

---

## 🛠️ Troubleshooting

| Problem                        | Solution |
|---------------------------------|----------|
| App not installing on phone     | Use Chrome, not a third-party browser |
| Data not syncing                | Check internet; re-enter the Webhook URL in Settings |
| Wrong calculations              | Ensure Gross weight is greater than Tare weight |
| Forgot password                 | Open `index.html`, search for `CREDENTIALS` |
| App shows an old version        | Clear the browser cache / re-install the PWA |
| WhatsApp button not working     | Make sure WhatsApp is installed on the phone |

---

## 📄 License

Internal/private use. This application is created by Giridhar Prabhu.
