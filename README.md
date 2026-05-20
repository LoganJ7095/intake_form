# Patient Intake Form

An installable intake-form web app for iPads that:

- runs as a home-screen PWA
- generates the PDF on the device
- uploads directly to Google Drive with per-user Google OAuth
- saves drafts locally and queues uploads while offline

---

## What changed

This app no longer depends on a backend `/submit` endpoint, Google service-account JSON, or server-side PDF generation. The browser handles PDF creation and Google Drive upload directly, so you can host it as static files or serve it locally on a LAN for iPads to install.

> This is still a web app, not a native App Store app. For installs on iPads, open it in Safari and use **Add to Home Screen**.

---

## Project structure

```text
intake_form/
├── public/
│   ├── app-config.js       # Google OAuth / Drive folder configuration
│   ├── form.js             # Client-side PDF, queue, and Drive upload logic
│   ├── index.html          # Intake form UI
│   ├── manifest.json       # Install metadata
│   ├── service-worker.js   # Offline shell cache
│   ├── styles.css          # Touch-friendly iPad styling
│   └── icons/              # Home-screen / PWA icons
├── server.js               # Optional local static file server
├── .env.example            # Optional PORT for local hosting
└── package.json
```

---

## Google setup

### 1. Create an OAuth client

In Google Cloud Console:

1. Create or select a project.
2. Enable the **Google Drive API**.
3. Configure the OAuth consent screen.
4. Create an **OAuth 2.0 Client ID** for a **Web application**.
5. Add each deployment origin to **Authorized JavaScript origins**.
   - Example local origin: `http://192.168.1.10:3000`
   - Example hosted origin: `https://your-domain.example`

### 2. Configure the app

Edit `/home/runner/work/intake_form/intake_form/public/app-config.js`:

```js
window.INTAKE_FORM_CONFIG = {
  googleClientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  googleDriveFolderId: "OPTIONAL_SHARED_FOLDER_ID",
};
```

Notes:

- `googleClientId` is required.
- `googleDriveFolderId` is optional. If blank, uploads go to the signed-in user's Drive.
- Do **not** use a service-account JSON file in an iPad-installable app.

---

## Run locally on your network

This app can be served locally for installation and use on iPads connected to the same Wi-Fi.

### 1. Install dependencies

```bash
cd /home/runner/work/intake_form/intake_form
npm install
```

### 2. Optional: set the port

```bash
cp /home/runner/work/intake_form/intake_form/.env.example /home/runner/work/intake_form/intake_form/.env
```

### 3. Start the local static server

```bash
cd /home/runner/work/intake_form/intake_form
npm start
```

### 4. Open it on the iPad

In Safari on the iPad, visit:

```text
http://<computer-local-ip>:3000
```

Then use **Share → Add to Home Screen**.

---

## How uploads work now

1. The user fills out the form.
2. The app generates the PDF directly in the browser.
3. The user signs in with Google.
4. The PDF uploads directly to Google Drive using the user's Wi-Fi/internet connection.
5. If the connection is unavailable, the submission is queued locally and retried later.

---

## Offline and reliability behavior

- Drafts auto-save to local storage on the iPad.
- **Save Draft** writes the current form to the device immediately.
- If the iPad is offline during submit, the form is added to a pending upload queue.
- **Sync Pending Uploads** retries queued uploads once internet is available.
- The service worker caches the app shell so the installed app can reopen without a live server connection after initial load.

---

## iPad usage notes

- Best experience: open in Safari, then install to the home screen.
- Uploading to Google Drive still requires internet access.
- If you use a shared Drive folder, the signed-in Google account must have permission to upload into it.
- For multiple clinics or networks, add each allowed origin to the Google OAuth client settings.

---

## Security model

- The app uses Google OAuth with `drive.file`, not a service account.
- Upload permission is limited to files the app creates.
- No Google credentials are stored in the repository.
- Do not commit real OAuth client IDs for environments you do not control unless you intend them to be public.
