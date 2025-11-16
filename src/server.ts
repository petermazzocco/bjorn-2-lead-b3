import dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import mailchimp from "@mailchimp/mailchimp_marketing";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { z } from "zod";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Mailchimp
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY || "",
  server: process.env.MAILCHIMP_SERVER_PREFIX || "",
});

// Configure Nodemailer for Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// Validation Schema
const contactFormSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  email: z.email({
    message: "Please enter a valid email address.",
  }),
  phone: z.string().min(10, {
    message: "Please enter a valid phone number.",
  }),
  contactAbout: z.string({
    message: "Please select a topic.",
  }),
  message: z
    .string()
    .min(20, {
      message: "Message must be at least 20 characters.",
    })
    .max(1000, {
      message: "Message must not exceed 1000 characters.",
    }),
  agreeToPolicy: z.boolean().refine((val) => val === true, {
    message: "You must agree to the policies to continue.",
  }),
});

// Types
interface SubscribeRequestBody {
  email: string;
  firstName?: string;
  lastName?: string;
}

interface MailchimpError {
  status?: number;
  response?: {
    body?: {
      title?: string;
    };
  };
  message: string;
}

// Health check endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Backend API is running!" });
});

// Ping Mailchimp to verify connection
app.get("/api/mailchimp/ping", async (_req: Request, res: Response) => {
  try {
    const response = await mailchimp.ping.get();
    res.json({
      success: true,
      message: "Successfully connected to Mailchimp!",
      data: response,
    });
  } catch (error) {
    const err = error as MailchimpError;
    res.status(500).json({
      success: false,
      message: "Failed to connect to Mailchimp",
      error: err.message,
    });
  }
});

// Subscribe to newsletter
app.post(
  "/api/mailchimp/newsletter/subscribe",
  async (req: Request<{}, {}, SubscribeRequestBody>, res: Response) => {
    const { email, firstName, lastName } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!process.env.MAILCHIMP_AUDIENCE_ID) {
      return res.status(500).json({
        success: false,
        message: "Mailchimp audience ID is not configured",
      });
    }

    try {
      const response = await mailchimp.lists.addListMember(
        process.env.MAILCHIMP_AUDIENCE_ID,
        {
          email_address: email,
          status: "subscribed",
          merge_fields: {
            FNAME: firstName || "",
            LNAME: lastName || "",
          },
        },
      );

      return res.status(201).json({
        success: true,
        message: "Successfully subscribed to newsletter!",
        status: response.status,
      });
    } catch (error) {
      const err = error as MailchimpError;

      // Handle duplicate email
      if (err.status === 400 && err.response?.body?.title === "Member Exists") {
        return res.status(400).json({
          success: false,
          message: "This email is already subscribed to the newsletter",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to subscribe to newsletter",
        error: err.message,
      });
    }
  },
);

// Unsubscribe from newsletter
app.delete(
  "/api/mailchimp/newsletter/unsubscribe/:email",
  async (req: Request, res: Response) => {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!process.env.MAILCHIMP_AUDIENCE_ID) {
      return res.status(500).json({
        success: false,
        message: "Mailchimp audience ID is not configured",
      });
    }

    try {
      const subscriberHash = crypto
        .createHash("md5")
        .update(email.toLowerCase())
        .digest("hex");

      await mailchimp.lists.updateListMember(
        process.env.MAILCHIMP_AUDIENCE_ID,
        subscriberHash,
        {
          status: "unsubscribed",
        },
      );

      return res.json({
        success: true,
        message: "Successfully unsubscribed from newsletter",
      });
    } catch (error) {
      const err = error as MailchimpError;

      return res.status(500).json({
        success: false,
        message: "Failed to unsubscribe from newsletter",
        error: err.message,
      });
    }
  },
);

// Contact form submission
app.post("/api/contact", async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = contactFormSchema.parse(req.body);
    const { name, email, phone, contactAbout, message, agreeToPolicy } =
      validatedData;

    // Send email via Gmail SMTP
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: process.env.CONTACT_FORM_RECIPIENT || process.env.GMAIL_USER,
      subject: `New Contact Form Submission: ${name} ${email}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Topic:</strong> ${contactAbout}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
        <hr>
        <p><em>Agreed to policies: ${agreeToPolicy ? "Yes" : "No"}</em></p>
      `,
      replyTo: email,
    };

    await transporter.sendMail(mailOptions);

    // Add user to newsletter if not already subscribed
    if (process.env.MAILCHIMP_AUDIENCE_ID) {
      try {
        const subscriberHash = crypto
          .createHash("md5")
          .update(email.toLowerCase())
          .digest("hex");

        // Check if user already exists
        try {
          await mailchimp.lists.getListMember(
            process.env.MAILCHIMP_AUDIENCE_ID,
            subscriberHash,
          );
          // User already exists, skip adding
        } catch (error) {
          // User doesn't exist, add them
          const nameParts = name.split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          await mailchimp.lists.addListMember(
            process.env.MAILCHIMP_AUDIENCE_ID,
            {
              email_address: email,
              status: "subscribed",
              merge_fields: {
                FNAME: firstName,
                LNAME: lastName,
                PHONE: phone,
              },
              tags: ["contact-form"],
            },
          );
        }
      } catch (mailchimpError) {
        // Log the error but don't fail the request
        console.error("Failed to add to newsletter:", mailchimpError);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Contact form submitted successfully!",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        //@ts-ignore expect error
        errors: error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }

    const err = error as Error;
    console.error("Contact form error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit contact form",
      error: err.message,
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});

export default app;
