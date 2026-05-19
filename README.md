# Patient Intake Form

A web application that renders a patient intake form, generates a PDF from the submitted data, and uploads it directly to a Google Drive folder.

---

## Features

- All required patient, parent/guardian, PCM, and history fields
- Server-side PDF generation using [PDFKit](https://pdfkit.org/)
- Automatic upload to a specified Google Drive folder via a service account
- Client-side and server-side validation of required fields
- **iPad-optimized**: installable as a home-screen PWA, touch-friendly 44 px targets, no auto-zoom

---

## Prerequisites

- **Node.js** ≥ 18
- A **Google Cloud project** with the **Google Drive API** enabled
- A **service account** with a downloaded JSON key file
- The target Google Drive folder shared with the service account's email address

---

## Setup

### 1. Clone & install dependencies

```bash
git clone https://github.com/LoganJ7095/intake_form.git
cd intake_form
npm install
```

### 2. Create a Google Cloud service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Enable the **Google Drive API** for the project.
4. Navigate to **IAM & Admin → Service Accounts** and create a new service account.
5. Create a JSON key for the service account and download it — save it as `credentials.json` in the project root.
6. Open the target Google Drive folder, click **Share**, and add the service account email (looks like `name@project.iam.gserviceaccount.com`) with **Editor** access.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
PORT=3000
GOOGLE_DRIVE_FOLDER_ID=<your_folder_id>
GOOGLE_APPLICATION_CREDENTIALS=./credentials.json
```

The **folder ID** is the last segment of your Google Drive folder URL:
`https://drive.google.com/drive/folders/<FOLDER_ID>`

### 4. Run the server

```bash
npm start
```

Open your browser at **http://localhost:3000**.

---

## How it works

1. The user fills out the intake form in the browser and clicks **Submit & Upload to Google Drive**.
2. The browser sends a JSON `POST` to `/submit`.
3. The server validates all required fields, builds a formatted PDF with [PDFKit](https://pdfkit.org/), and uploads it to the configured Google Drive folder using a service account.
4. The form displays a success message with a link to the uploaded file.

---

## Project structure

```
intake_form/
├── public/
│   ├── index.html   # Intake form UI
│   ├── styles.css   # Form styling
│   └── form.js      # Client-side submission logic
├── server.js        # Express server, PDF builder, Drive uploader
├── package.json
├── .env.example     # Environment variable template
└── .gitignore
```

---

## Using on an iPad

### Install as a home-screen app (recommended)

This app is a **Progressive Web App (PWA)**, so it runs in full-screen mode without the browser toolbar — ideal for clinical use on an iPad.

1. Open **Safari** on the iPad and navigate to the server URL (e.g. `http://192.168.1.10:3000`).
2. Tap the **Share** button (box with an upward arrow) in the Safari toolbar.
3. Tap **"Add to Home Screen"**.
4. Confirm the name **"Intake Form"** and tap **Add**.

The app will appear on the home screen and launch as a standalone full-screen app, just like a native application.

> **Tip:** For production use, host the app over **HTTPS** (e.g. behind an nginx reverse proxy with a TLS certificate). Safari on iPadOS requires HTTPS for full PWA features.

### Adding the home-screen icon

Place PNG images in the `public/icons/` folder:

| File | Size | Used for |
|------|------|---------|
| `icon-180.png` | 180×180 | Safari "Add to Home Screen" icon |
| `icon-192.png` | 192×192 | PWA manifest (Android / Chrome) |
| `icon-512.png` | 512×512 | PWA manifest splash screen |

### iPad-specific optimizations included

| Optimization | Details |
|---|---|
| No auto-zoom on focus | All inputs use `font-size: 16px` — iOS Safari only zooms when size < 16 px |
| 44 px touch targets | Every input and the submit button meet Apple's Human Interface Guideline minimum |
| `touch-action: manipulation` | Removes the 300 ms double-tap delay for instant response |
| `-webkit-appearance: none` | Removes iOS inner-shadow / rounded-rect styling for a consistent look |
| Safe-area insets | Padding respects the home indicator on iPad Pro with Face ID |
| `viewport-fit=cover` | Content fills edge-to-edge on modern iPad Pros |
| Apple meta tags | `apple-mobile-web-app-capable` enables full-screen standalone mode |
| PWA manifest | `manifest.json` enables "Add to Home Screen" on all modern browsers |
| `autocomplete` / `inputmode` | Correct keyboard type (numeric, email, etc.) and autofill on each field |

