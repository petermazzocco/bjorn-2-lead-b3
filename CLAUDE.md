# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based Express.js backend API for managing Mailchimp newsletter subscriptions and handling contact form submissions. The application provides REST endpoints for newsletter management and sends contact form submissions via Gmail SMTP while automatically adding contacts to the newsletter list.

## Development Commands

### Setup
```bash
npm install
```

Create a `.env` file based on `.env.example` with the required configuration:

**Mailchimp:**
- `MAILCHIMP_API_KEY`: Get from https://admin.mailchimp.com/account/api/
- `MAILCHIMP_SERVER_PREFIX`: The datacenter prefix (e.g., us19, us6) from your API key
- `MAILCHIMP_AUDIENCE_ID`: Found in Mailchimp under Audience > Settings > Audience name and defaults

**Gmail SMTP:**
- `GMAIL_USER`: Your Gmail address
- `GMAIL_APP_PASSWORD`: Generate an App Password at https://myaccount.google.com/apppasswords
- `CONTACT_FORM_RECIPIENT`: Email address to receive contact form submissions

**Server:**
- `PORT`: Server port (defaults to 3000)

### Running the Application
```bash
npm run dev    # Development mode with hot reload (nodemon + ts-node)
npm run build  # Compile TypeScript to dist/
npm start      # Run compiled production build from dist/
```

### Docker Deployment
```bash
docker build -t bjorn-2-lead-be .
docker run -p 3000:3000 --env-file .env bjorn-2-lead-be
```

For Dokploy, push the repository and configure environment variables in the Dokploy dashboard.

## Architecture

### Single-File Application
The entire application logic is contained in `src/server.ts`. This is a straightforward REST API with no additional layers or modules. Uses Zod for request validation and Nodemailer for email sending via Gmail SMTP.

### API Endpoints

**General:**
- `GET /` - Health check

**Mailchimp Newsletter:**
- `GET /api/mailchimp/ping` - Verify Mailchimp connection
- `POST /api/mailchimp/newsletter/subscribe` - Subscribe email to newsletter (body: `{ email, firstName?, lastName? }`)
- `DELETE /api/mailchimp/newsletter/unsubscribe/:email` - Unsubscribe email from newsletter

**Contact Form:**
- `POST /api/contact` - Submit contact form with validation (Zod schema), sends email via Gmail SMTP, and automatically adds user to newsletter if not already subscribed

### Mailchimp Integration
The application uses the `@mailchimp/mailchimp_marketing` SDK configured at startup with API key and server prefix from environment variables. All Mailchimp operations target a single audience list identified by `MAILCHIMP_AUDIENCE_ID`.

### Contact Form Flow
The `/api/contact` endpoint (src/server.ts:211-304) performs these operations:
1. Validates the request body using Zod schema (name, email, phone, contactAbout, message, agreeToPolicy)
2. Sends an HTML-formatted email via Gmail SMTP using Nodemailer
3. Checks if the user exists in the Mailchimp newsletter using MD5 email hash
4. Adds them to the newsletter with "contact-form" tag if they don't exist
5. Gracefully handles Mailchimp errors without failing the email send

### Email Hashing
When looking up or updating existing subscribers, the API generates an MD5 hash of the lowercase email address as required by Mailchimp's API for subscriber identification.

### Error Handling
- Custom `MailchimpError` type handles Mailchimp-specific errors
- Zod validation errors return structured field-level error messages
- The newsletter subscribe endpoint handles duplicate email scenarios by checking for status 400 with title "Member Exists"
- Contact form endpoint catches Mailchimp errors without failing the primary email send operation

## TypeScript Configuration

The project uses strict TypeScript settings:
- Target: ES2020
- Strict mode enabled with all null/type checks
- Unused locals/parameters flagged as errors
- Output directory: `dist/`
- Source maps and declarations generated
