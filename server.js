"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const { Readable } = require("stream");
const PDFDocument = require("pdfkit");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Google Drive auth (service account) ────────────────────────────────────
function getDriveClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set."
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  return google.drive({ version: "v3", auth });
}

// ── PDF builder ─────────────────────────────────────────────────────────────
/**
 * Generates a patient intake PDF and resolves with the PDF buffer.
 * @param {Object} data - Form field values keyed by input name.
 * @returns {Promise<Buffer>}
 */
function buildPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ──────────────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Patient Intake Form", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(`Submitted: ${new Date().toLocaleString()}`, { align: "center" });
    doc.moveDown(1);

    const field = (label, value) => {
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text(label + ":", { continued: true })
        .font("Helvetica")
        .text("  " + (value || "—"));
    };

    const section = (title) => {
      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#2B6CB0")
        .text(title)
        .fillColor("black");
      doc
        .moveTo(doc.x, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor("#2B6CB0")
        .stroke();
      doc.moveDown(0.4);
    };

    // ── Patient Information ──────────────────────────────────────────────────
    section("Patient Information");
    field("Patient's Name", data["patient-name"]);
    field("DOB", data["patient-dob"]);
    field("Sponsor's Name", data["sponsor-name"]);
    field("SSN", data["ssn"]);
    field("DSM-V Diagnosis and Severity Level", data["dsm"]);
    field("Email", data["email"]);

    // ── Parent / Guardian Information ────────────────────────────────────────
    section("Parent / Guardian Information");
    field("Parent Name", data["parent-name"]);
    field("DOB", data["parent-dob"]);
    field("Age", data["parent-age"]);

    // ── PCM Information ──────────────────────────────────────────────────────
    section("PCM Information");
    field("Referring Provider", data["reffering-provider"]);
    field("Date of Diagnosis", data["diagnosis-date"]);

    // ── Client's History ────────────────────────────────────────────────────
    section("Client's History");
    field("Age", data["patient-age"]);
    field(
      "Address",
      [
        data["street-name"],
        data["city"],
        data["state"],
        data["zip-code"],
      ]
        .filter(Boolean)
        .join(", ")
    );
    field("Siblings", data["sibling"]);
    field("School", data["school"]);
    field("IEP", data["iep"]);
    field("Dual Diagnosis", data["dual-diag"]);
    field("Medications", data["medications"]);
    field("Previous Services", data["services"]);
    field("Mo/Yr of Services", data["date-of-services"]);
    field("Additional Services (OT/PT/SLP)", data["additional-service"]);
    field("Hours Per Week", data["hours"]);
    field("Enrolled in Echo?", data["echo"]);
    field("CCP by ASN", data["asn"]);
    field("Days of Additional Services", data["additional-days"]);

    // Long-text fields rendered as paragraphs
    const paragraph = (label, value) => {
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica-Bold").text(label + ":");
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(value || "—", { indent: 10 });
    };

    paragraph("Family History", data["history"]);
    paragraph("Allergies", data["allergies"]);
    paragraph("Outcome of Prior Services", data["outcome"]);
    paragraph("Concerns", data["concerns"]);
    paragraph("Goals", data["goals"]);
    paragraph("End Result", data["end-result"]);

    doc.end();
  });
}

// ── Upload to Google Drive ───────────────────────────────────────────────────
/**
 * Uploads a PDF buffer to Google Drive.
 * @param {Buffer} pdfBuffer - The PDF data.
 * @param {string} fileName - The file name to use on Drive.
 * @returns {Promise<{id: string, webViewLink: string}>}
 */
async function uploadToDrive(pdfBuffer, fileName) {
  const drive = getDriveClient();

  const fileMetadata = {
    name: fileName,
    mimeType: "application/pdf",
    ...(FOLDER_ID ? { parents: [FOLDER_ID] } : {}),
  };

  const media = {
    mimeType: "application/pdf",
    body: Readable.from(pdfBuffer),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, webViewLink",
  });

  return response.data;
}

// ── Route: form submission ───────────────────────────────────────────────────
app.post("/submit", async (req, res) => {
  try {
    const data = req.body;

    if (!data || typeof data !== "object") {
      return res
        .status(400)
        .json({ success: false, error: "Invalid request body." });
    }

    // Required fields validation (server-side)
    const required = [
      "patient-name",
      "patient-dob",
      "sponsor-name",
      "ssn",
      "email",
      "parent-name",
      "parent-dob",
      "parent-age",
      "reffering-provider",
      "diagnosis-date",
      "patient-age",
      "street-name",
      "city",
      "state",
      "zip-code",
      "sibling",
      "school",
      "iep",
      "dual-diag",
      "medications",
      "allergies",
      "services",
      "outcome",
      "additional-service",
      "hours",
      "additional-days",
      "concerns",
      "goals",
      "end-result",
    ];

    const missing = required.filter((f) => !data[f] || data[f].trim() === "");
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    // Build the PDF
    const pdfBuffer = await buildPdf(data);

    // Derive a safe file name from the patient's name and timestamp
    const safeName = (data["patient-name"] || "patient")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const fileName = `IntakeForm_${safeName}_${timestamp}.pdf`;

    // Upload to Google Drive
    const file = await uploadToDrive(pdfBuffer, fileName);

    return res.json({
      success: true,
      fileId: file.id,
      fileUrl: file.webViewLink,
    });
  } catch (err) {
    console.error("Submission error:", err);
    return res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === "production"
          ? "An internal server error occurred."
          : err.message,
    });
  }
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Intake form server running at http://localhost:${PORT}`);
});
