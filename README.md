# Ang Probinsyanong Ahente

Vercel-ready static landing page for Erwin Baguioan, serving provincial families searching for a dream home in Cavite. The frontend submits consultation requests to the Vercel API proxy, which forwards them to Google Apps Script. Apps Script saves the lead to Google Sheets, sends the owner/client emails using `EmailTemplate.html`, and keeps the follow-up workflow active.

## Repository files

- `index.html` — complete public landing page and consultation form.
- `api/submit-consultation.js` — Vercel serverless proxy to the Apps Script Web App.
- `Code.gs` — complete Google Apps Script backend for Sheets, email, and follow-ups. Copy this into Apps Script.
- `EmailTemplate.html` — complete branded email template. Add this as an HTML file named exactly `EmailTemplate` in Apps Script.
- `vercel.json` — Vercel configuration.
- `robots.txt` and `sitemap.xml` — Google search-indexing files.

`Code.gs` and `EmailTemplate.html` are intentionally visible in GitHub for setup and backup, but are excluded from the public Vercel deployment by `.vercelignore`.

## Data flow

```text
Vercel index.html
  → /api/submit-consultation
  → Apps Script doPost(e)
  → Google Sheets CRM
  → owner notification + client confirmation
  → 30-day follow-up sequence
```

## Apps Script setup

Copy the root `Code.gs` into the Apps Script project connected to the Google Sheet. Add `EmailTemplate.html` as a separate HTML file named `EmailTemplate`. Deploy the project as a Web App with `Execute as: Me` and `Who has access: Anyone`, then place the deployed `/exec` URL in `api/submit-consultation.js`.

## Vercel setup

Import the repository using the repository root. No build command is required. Redeploy after every endpoint or frontend change. The public site is configured for `https://ang-probinsyanong-ahente.vercel.app/`.

## Search readiness

The site includes Filipino-language metadata, canonical URL, Open Graph metadata, JSON-LD, `robots.txt`, and `sitemap.xml`. Submit the final Vercel URL in Google Search Console to request indexing.
