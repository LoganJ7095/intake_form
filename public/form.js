const form = document.getElementById("intake-form");
const submitBtn = document.getElementById("submit-btn");
const saveDraftBtn = document.getElementById("save-draft-btn");
const statusMessage = document.getElementById("status-message");

const rawAppConfig = window.INTAKE_FORM_CONFIG || {};
const appConfig = {
  googleClientId:
    (typeof rawAppConfig.googleClientId === "string" &&
      rawAppConfig.googleClientId.trim()) ||
    (typeof rawAppConfig.googleOAuthClientId === "string" &&
      rawAppConfig.googleOAuthClientId.trim()) ||
    (typeof rawAppConfig.clientId === "string" &&
      rawAppConfig.clientId.trim()) ||
    "",
  googleDriveFolderId:
    typeof rawAppConfig.googleDriveFolderId === "string"
      ? rawAppConfig.googleDriveFolderId.trim()
      : "",
};
const STORAGE_KEYS = {
  draft: "intake-form-draft-v2",
  queue: "intake-form-upload-queue-v2",
  auth: "intake-form-google-auth",
};
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 50;
const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const LINE_HEIGHT_MULTIPLIER = 1.35;
const PDF_FONT_FAMILIES = {
  regular: "Helvetica, Arial, sans-serif",
  bold: '"Helvetica Neue", Helvetica, Arial, sans-serif',
};

let queueProcessingPromise = null;
let accessToken = null;
let accessTokenExpiresAt = 0;

const sections = [
  {
    title: "Client Information",
    fields: [
      ["Patient's Name", "patient-name"],
      ["DOB", "patient-dob"],
      ["Sponsor's Name", "sponsor-name"],
      ["SSN", "ssn"],
      ["DSM-V Diagnosis and Severity Level", "dsm"],
      ["Email", "email"],
    ],
  },
  {
    title: "Parent / Guardian Information",
    fields: [
      ["Parent Name", "parent-name"],
      ["DOB", "parent-dob"],
      ["Age", "parent-age"],
    ],
  },
  {
    title: "PCM Information",
    fields: [
      ["Referring Provider", "reffering-provider"],
      ["Date of Diagnosis", "diagnosis-date"],
    ],
  },
  {
    title: "Client's History",
    items: [
      { type: "field", label: "Age", descriptor: "patient-age" },
      {
        type: "field",
        label: "Address",
        descriptor: (data) =>
          [data["street-name"], data.city, data.state, data["zip-code"]]
            .filter(Boolean)
            .join(", "),
      },
      { type: "field", label: "Siblings", descriptor: "sibling" },
      { type: "field", label: "School", descriptor: "school" },
      { type: "field", label: "IEP", descriptor: "iep" },
      { type: "field", label: "Dual Diagnosis", descriptor: "dual-diag" },
      { type: "paragraph", label: "Family History", key: "history" },
      { type: "field", label: "Medications", descriptor: "medications" },
      { type: "paragraph", label: "Allergies", key: "allergies" },
      { type: "field", label: "Previous Services", descriptor: "services" },
      {
        type: "field",
        label: "Mo/Yr of Services",
        descriptor: "date-of-services",
      },
      {
        type: "paragraph",
        label: "Outcome of Prior Services",
        key: "outcome",
      },
      {
        type: "field",
        label: "Additional Services (OT/PT/SLP)",
        descriptor: "additional-service",
      },
      { type: "field", label: "Hours Per Week", descriptor: "hours" },
      { type: "field", label: "Enrolled in Echo?", descriptor: "echo" },
      { type: "field", label: "CCP by ASN", descriptor: "asn" },
      {
        type: "field",
        label: "Days of Additional Services",
        descriptor: "additional-days",
      },
      { type: "paragraph", label: "Concerns", key: "concerns" },
      { type: "paragraph", label: "Goals", key: "goals" },
      { type: "paragraph", label: "End Result", key: "end-result" },
    ],
  },
];

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = "status-message " + type;
}

function hideStatus() {
  statusMessage.textContent = "";
  statusMessage.className = "status-message hidden";
}

function getQueue() {
  try {
    const rawQueue = localStorage.getItem(STORAGE_KEYS.queue);
    if (!rawQueue) {
      return [];
    }

    const queue = JSON.parse(rawQueue);
    return Array.isArray(queue) ? queue : [];
  } catch (_error) {
    return [];
  }
}

function setQueue(queue) {
  localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(queue));
}

function setBusyState(isBusy) {
  submitBtn.disabled = isBusy;
}

function collectFormData() {
  const formData = new FormData(form);
  const data = {};
  formData.forEach((value, key) => {
    data[key] = String(value).trim();
  });
  return data;
}

function fillForm(data) {
  Object.entries(data).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field && "value" in field) {
      field.value = value;
    }
  });
}

function saveDraft(data = collectFormData()) {
  localStorage.setItem(
    STORAGE_KEYS.draft,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      data,
    })
  );
  showStatus("Draft saved on this iPad.", "info");
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEYS.draft);
}

function restoreDraft() {
  try {
    const rawDraft = localStorage.getItem(STORAGE_KEYS.draft);
    if (!rawDraft) {
      return;
    }

    const parsedDraft = JSON.parse(rawDraft);
    if (!parsedDraft || typeof parsedDraft !== "object" || !parsedDraft.data) {
      return;
    }

    fillForm(parsedDraft.data);
    showStatus("Recovered the last saved draft on this iPad.", "info");
  } catch (_error) {
    localStorage.removeItem(STORAGE_KEYS.draft);
  }
}

function queueSubmission(data, fileName) {
  const queue = getQueue();
  queue.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fileName,
    data,
  });
  setQueue(queue);
}

function buildSafeFileName(data, createdAt = new Date()) {
  const safeName = (data["patient-name"] || "patient")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return `${safeName || "patient"}.pdf`;
}

function buildClientFolderName(data) {
  const patientName = String(data["patient-name"] || "")
    .trim()
    .replace(/\s+/g, " ");
  const nameParts = patientName.split(" ").filter(Boolean);
  const rawFirstName = (nameParts[0] || "Client").replace(/[^a-zA-Z0-9-]/g, "");
  const firstName = rawFirstName || "Client";
  const lastNamePart =
    nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const lastInitial = lastNamePart
    ? lastNamePart
        .replace(/[^a-zA-Z0-9]/g, "")
        .charAt(0)
        .toUpperCase()
    : "";

  return lastInitial ? `${firstName}${lastInitial}` : firstName;
}

function getFieldValue(data, descriptor) {
  if (typeof descriptor === "function") {
    return descriptor(data);
  }

  return data[descriptor];
}

function wrapText(text, fontSize = 10, indent = 0) {
  const normalizedText = String(text || "—").replace(/\r/g, "");
  const paragraphs = normalizedText.split("\n");
  const maxChars = Math.max(
    16,
    Math.floor((USABLE_WIDTH - indent) / Math.max(fontSize * 0.55, 1))
  );
  const lines = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      lines.push("");
    } else {
      let line = "";
      words.forEach((word) => {
        if (word.length > maxChars) {
          if (line) {
            lines.push(line);
            line = "";
          }

          for (let i = 0; i < word.length; i += maxChars) {
            lines.push(word.slice(i, i + maxChars));
          }
          return;
        }

        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > maxChars) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });

      if (line) {
        lines.push(line);
      }
    }

    if (paragraphIndex < paragraphs.length - 1) {
      lines.push("");
    }
  });

  return lines;
}

function getPdfTextWidth(text, fontSize, font = "regular") {
  if (typeof document === "undefined") {
    return String(text || "").length * fontSize * 0.55;
  }

  const canvas =
    getPdfTextWidth.canvas ||
    (getPdfTextWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");

  if (!context) {
    return String(text || "").length * fontSize * 0.55;
  }

  const fontWeight = font === "bold" ? "700" : "400";
  const fontFamily = PDF_FONT_FAMILIES[font] || PDF_FONT_FAMILIES.regular;
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return context.measureText(String(text || "")).width;
}

function createDocumentLines(data) {
  const lines = [];
  const pushLine = (text, options = {}) => {
    lines.push({
      text,
      fontSize: 10,
      font: "regular",
      center: false,
      indent: 0,
      ...options,
    });
  };

  pushLine("Patient Intake Form", {
    fontSize: 18,
    font: "bold",
    center: true,
    marginBottom: 10,
  });
  pushLine(`Submitted: ${new Date().toLocaleString()}`, {
    fontSize: 9,
    center: true,
    marginBottom: 18,
  });

  sections.forEach((section) => {
    pushLine(section.title, {
      fontSize: 12,
      font: "bold",
      marginTop: 8,
      marginBottom: 8,
    });

    const items = section.items || [
      ...(section.fields || []).map(([label, descriptor]) => ({
        type: "field",
        label,
        descriptor,
      })),
      ...(section.paragraphs || []).map(([label, key]) => ({
        type: "paragraph",
        label,
        key,
      })),
    ];

    items.forEach((item) => {
      if (item.type === "paragraph") {
        pushLine(`${item.label}:`, {
          marginTop: 3,
          marginBottom: 2,
        });

        wrapText(data[item.key] || "—", 10, 10).forEach(
          (line, index, wrapped) => {
            pushLine(line, {
              indent: 10,
              marginBottom: index === wrapped.length - 1 ? 4 : 0,
            });
          }
        );
        return;
      }

      const wrapped = wrapText(
        `${item.label}: ${getFieldValue(data, item.descriptor) || "—"}`,
        10
      );
      wrapped.forEach((line, index) => {
        pushLine(line, {
          indent: index === 0 ? 0 : 10,
          marginBottom: index === wrapped.length - 1 ? 4 : 0,
        });
      });
    });
  });

  return lines;
}

function paginateLines(lines) {
  const pages = [[]];
  let currentPageIndex = 0;
  let currentY = PAGE_HEIGHT - PAGE_MARGIN;

  lines.forEach((line) => {
    currentY -= line.marginTop || 0;
    const lineHeight = Math.ceil(line.fontSize * LINE_HEIGHT_MULTIPLIER);

    if (currentY - lineHeight < PAGE_MARGIN) {
      currentPageIndex += 1;
      pages[currentPageIndex] = [];
      currentY = PAGE_HEIGHT - PAGE_MARGIN;
    }

    const textWidthEstimate = getPdfTextWidth(
      line.text,
      line.fontSize,
      line.font
    );
    const x = line.center
      ? Math.max(PAGE_MARGIN, (PAGE_WIDTH - textWidthEstimate) / 2)
      : PAGE_MARGIN + line.indent;

    pages[currentPageIndex].push({
      text: line.text,
      x,
      y: currentY,
      fontSize: line.fontSize,
      fontResource: line.font === "bold" ? "F2" : "F1",
    });

    currentY -= lineHeight + (line.marginBottom || 0);
  });

  return pages;
}

function pdfHexString(text) {
  let hex = "";

  for (const character of String(text || "")) {
    const codePoint = character.codePointAt(0);
    // Type1 fonts use single-byte Latin-1 encoding; replace unsupported characters with '?'
    const byte = codePoint <= 0xff ? codePoint : 0x3f;
    hex += byte.toString(16).padStart(2, "0");
  }

  return `<${hex.toUpperCase()}>`;
}

function createPdfBlob(data) {
  const pages = paginateLines(createDocumentLines(data));
  const objects = new Map();
  const catalogObjectNumber = 1;
  const pagesObjectNumber = 2;
  const regularFontObjectNumber = 3;
  const boldFontObjectNumber = 4;
  const pageNumbers = [];
  const contentNumbers = [];

  pages.forEach((_page, pageIndex) => {
    pageNumbers.push(5 + pageIndex * 2);
    contentNumbers.push(6 + pageIndex * 2);
  });

  objects.set(catalogObjectNumber, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    pagesObjectNumber,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageNumbers
      .map((number) => `${number} 0 R`)
      .join(" ")}] >>`
  );
  objects.set(
    regularFontObjectNumber,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );
  objects.set(
    boldFontObjectNumber,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  );

  pages.forEach((page, index) => {
    const contentStream = page
      .map(
        (line) =>
          `BT /${line.fontResource} ${
            line.fontSize
          } Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(
            2
          )} Tm ${pdfHexString(line.text)} Tj ET`
      )
      .join("\n");
    const pageObjectNumber = pageNumbers[index];
    const contentObjectNumber = contentNumbers[index];

    objects.set(
      pageObjectNumber,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regularFontObjectNumber} 0 R /F2 ${boldFontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    );
    objects.set(
      contentObjectNumber,
      `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`
    );
  });

  const encoder = new TextEncoder();
  const maxObjectNumber = 4 + pages.length * 2;
  let output = "%PDF-1.4\n";
  let offset = encoder.encode(output).length;
  const offsets = [0];

  for (
    let objectNumber = 1;
    objectNumber <= maxObjectNumber;
    objectNumber += 1
  ) {
    const objectBody = `${objectNumber} 0 obj\n${objects.get(
      objectNumber
    )}\nendobj\n`;
    offsets[objectNumber] = offset;
    output += objectBody;
    offset += encoder.encode(objectBody).length;
  }

  const xrefOffset = offset;
  output += `xref\n0 ${maxObjectNumber + 1}\n0000000000 65535 f \n`;

  for (
    let objectNumber = 1;
    objectNumber <= maxObjectNumber;
    objectNumber += 1
  ) {
    output += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${
    maxObjectNumber + 1
  } /Root ${catalogObjectNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([output], { type: "application/pdf" });
}

function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (
      window.google &&
      window.google.accounts &&
      window.google.accounts.oauth2
    ) {
      resolve();
      return;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (
        window.google &&
        window.google.accounts &&
        window.google.accounts.oauth2
      ) {
        window.clearInterval(intervalId);
        resolve();
        return;
      }

      if (Date.now() - startedAt > 10000) {
        window.clearInterval(intervalId);
        reject(
          new Error(
            "Google sign-in could not load. Check internet access and try again."
          )
        );
      }
    }, 100);
  });
}

async function requestAccessToken(interactive) {
  if (!appConfig.googleClientId) {
    throw new Error(
      "Google Drive is not configured. Add your OAuth client ID to /public/app-config.js."
    );
  }

  if (accessToken && Date.now() < accessTokenExpiresAt - 60000) {
    return accessToken;
  }

  await waitForGoogleIdentity();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: appConfig.googleClientId,
      scope: DRIVE_SCOPE,
      include_granted_scopes: true,
      callback: (response) => {
        if (!response || !response.access_token) {
          reject(new Error("Google sign-in did not return an access token."));
          return;
        }

        accessToken = response.access_token;
        accessTokenExpiresAt =
          Date.now() + Number(response.expires_in || 3600) * 1000;
        localStorage.setItem(STORAGE_KEYS.auth, "granted");
        resolve(accessToken);
      },
      error_callback: () => {
        reject(
          new Error(
            interactive
              ? "Google sign-in was cancelled."
              : "Background sync needs you to sign in to Google again."
          )
        );
      },
    });

    tokenClient.requestAccessToken({
      prompt:
        interactive || localStorage.getItem(STORAGE_KEYS.auth) !== "granted"
          ? "consent"
          : "",
    });
  });
}

async function uploadPdfToDrive(
  pdfBlob,
  fileName,
  { interactive = false, data = {} } = {}
) {
  const token = await requestAccessToken(Boolean(interactive));
  const parentFolderId = appConfig.googleDriveFolderId || "root";
  const clientFolderName = buildClientFolderName(data);
  const escapedFolderName = clientFolderName
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const query = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${escapedFolderName}'`,
    "trashed=false",
    `'${parentFolderId}' in parents`,
  ].join(" and ");
  const lookupUrl = new URL("https://www.googleapis.com/drive/v3/files");
  lookupUrl.searchParams.set("q", query);
  lookupUrl.searchParams.set("pageSize", "1");
  lookupUrl.searchParams.set("fields", "files(id,name)");
  lookupUrl.searchParams.set("supportsAllDrives", "true");
  lookupUrl.searchParams.set("includeItemsFromAllDrives", "true");
  const lookupResponse = await fetch(lookupUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const lookupResult = await lookupResponse.json().catch(() => ({}));
  if (!lookupResponse.ok) {
    throw new Error(
      lookupResult?.error?.message ||
        "Failed to locate the client folder in Google Drive."
    );
  }
  let clientFolderId = lookupResult?.files?.[0]?.id;
  if (!clientFolderId) {
    const createFolderResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          name: clientFolderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentFolderId],
        }),
      }
    );
    const createFolderResult = await createFolderResponse
      .json()
      .catch(() => ({}));
    if (!createFolderResponse.ok || !createFolderResult?.id) {
      throw new Error(
        createFolderResult?.error?.message ||
          "Failed to create the client folder in Google Drive."
      );
    }
    clientFolderId = createFolderResult.id;
  }
  const metadata = {
    name: fileName,
    mimeType: "application/pdf",
    parents: [clientFolderId],
  };

  const boundary = `intake-form-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
      pdfBlob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      accessToken = null;
      accessTokenExpiresAt = 0;
    }

    throw new Error(
      result?.error?.message || "Google Drive upload failed. Please try again."
    );
  }

  return result;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Ignore registration failures; the app still works online.
    });
  });
}

async function processQueue(interactive = false) {
  if (queueProcessingPromise) {
    return queueProcessingPromise;
  }

  if (!navigator.onLine || getQueue().length === 0) {
    return;
  }

  queueProcessingPromise = (async () => {
    const queue = [...getQueue()];
    if (queue.length === 0) {
      return;
    }

    setBusyState(true);

    let nextQueue = [...queue];
    let uploadedCount = 0;

    try {
      for (const entry of queue) {
        const pdfBlob = createPdfBlob(entry.data);
        await uploadPdfToDrive(pdfBlob, entry.fileName, {
          interactive,
          data: entry.data,
        });
        nextQueue = nextQueue.filter(
          (queuedEntry) => queuedEntry.id !== entry.id
        );
        setQueue(nextQueue);
        uploadedCount += 1;
      }

      if (uploadedCount > 0) {
        showStatus(
          `Uploaded ${uploadedCount} queued ${
            uploadedCount === 1 ? "PDF" : "PDFs"
          } to Google Drive.`,
          "success"
        );
      }
    } catch (error) {
      setQueue(nextQueue);
      if (interactive) {
        showStatus(error.message, "error");
      }
    } finally {
      setBusyState(false);
      queueProcessingPromise = null;
    }
  })();

  return queueProcessingPromise;
}

saveDraftBtn.addEventListener("click", () => {
  saveDraft();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = collectFormData();
  const fileName = buildSafeFileName(data);
  const pdfBlob = createPdfBlob(data);

  setBusyState(true);
  hideStatus();

  try {
    if (!navigator.onLine) {
      queueSubmission(data, fileName);
      clearDraft();
      form.reset();
      showStatus(
        "No internet connection detected. The form was saved on this iPad and queued for Google Drive upload.",
        "info"
      );
      return;
    }

    const result = await uploadPdfToDrive(pdfBlob, fileName, {
      interactive: true,
      data,
    });
    clearDraft();
    form.reset();
    showStatus(
      "✅ Form submitted successfully!" +
        (result.webViewLink ? ` View it here: ${result.webViewLink}` : ""),
      "success"
    );
    await processQueue(false);
  } catch (error) {
    if (!navigator.onLine) {
      queueSubmission(data, fileName);
      clearDraft();
      form.reset();
      showStatus(
        "Connection dropped during upload. The PDF was queued and will retry when the iPad is back online.",
        "info"
      );
      return;
    }

    showStatus(`❌ ${error.message}`, "error");
  } finally {
    setBusyState(false);
  }
});

window.addEventListener("online", () => {
  processQueue(false);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && navigator.onLine) {
    processQueue(false);
  }
});

restoreDraft();
registerServiceWorker();

if (appConfig.googleClientId) {
  processQueue(false);
}
