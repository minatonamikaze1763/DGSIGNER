from flask import Flask, request, send_file
import tempfile
import os
import datetime
from endesive import pdf

app = Flask(__name__)

# 🔐 Path to your PFX certificate on pendrive
PFX_PATH = r"E:\certificate.pfx"       # Change drive letter if needed
PFX_PASSWORD = "YourPasswordHere"      # Replace with your actual certificate password

@app.route("/sign", methods=["POST"])
def sign_pdf():
    # Check if file uploaded
    if "file" not in request.files:
        return "No PDF uploaded", 400

    uploaded_file = request.files["file"]
    rect = request.form.get("rect", "{}")  # Optional: signing area coords (unused here)

    # Save uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_input:
        uploaded_file.save(tmp_input.name)
        input_pdf = tmp_input.name

    output_pdf = tempfile.NamedTemporaryFile(delete=False, suffix="_signed.pdf").name

    # Read PDF & certificate
    with open(input_pdf, "rb") as f:
        pdf_data = f.read()
    with open(PFX_PATH, "rb") as f:
        pfx_data = f.read()

    # Signature info
    date = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S+00'00'")
    signature_meta = {
        "sigflags": 3,
        "contact": "Digital Signer",
        "location": "India",
        "signingdate": date.encode(),
        "reason": "Document digitally signed",
        "signature": "E-Signed via Digital Signer",
    }

    try:
        signature = pdf.sign(
            pdf_data,
            signature_meta,
            pfx_data,
            PFX_PASSWORD.encode("utf-8")
        )
        with open(output_pdf, "wb") as f:
            f.write(pdf_data + signature)
    except Exception as e:
        return f"Signing error: {e}", 500

    # Return signed PDF to frontend
    return send_file(output_pdf, as_attachment=True, download_name="signed.pdf")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5678)