/* Client-side form submission script */

const form = document.getElementById("intake-form");
const submitBtn = document.getElementById("submit-btn");
const statusMessage = document.getElementById("status-message");

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = "status-message " + type;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // HTML5 validation check
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  // Collect form data
  const formData = new FormData(form);
  const data = {};
  formData.forEach((value, key) => {
    data[key] = value;
  });

  // Disable the button and show progress
  submitBtn.disabled = true;
  showStatus("Generating PDF and uploading to Google Drive…", "info");

  try {
    const response = await fetch("/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      showStatus(
        "✅ Form submitted successfully! PDF uploaded to Google Drive." +
          (result.fileUrl ? " View it here: " + result.fileUrl : ""),
        "success"
      );
      form.reset();
    } else {
      showStatus(
        "❌ Submission failed: " + (result.error || "Unknown error"),
        "error"
      );
    }
  } catch (err) {
    showStatus(
      "❌ Network error: " + err.message + ". Please try again.",
      "error"
    );
  } finally {
    submitBtn.disabled = false;
  }
});
