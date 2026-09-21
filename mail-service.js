"use strict";

require("dotenv").config();
const nodemailer = require("nodemailer");

const REQUIRED_SMTP_ENV = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];

let cachedTransporter = null;

function getMissingSmtpEnvVars() {
	return REQUIRED_SMTP_ENV.filter((name) => !process.env[name] || !process.env[name].trim());
}

function getSmtpConfig() {
	const missing = getMissingSmtpEnvVars();
	if (missing.length > 0) {
		throw new Error(`Missing required SMTP environment variables: ${missing.join(", ")}`);
	}

	const port = process.env.SMTP_PORT;
	const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;

	return {
		host: process.env.SMTP_HOST.trim(),
		port,
		secure,
		auth: {
			user: process.env.SMTP_USER.trim(),
			pass: process.env.SMTP_PASS,
		},
	};
}

function getTransporter() {
	return cachedTransporter ? cachedTransporter : (cachedTransporter = nodemailer.createTransport(getSmtpConfig()));
}

function normalizeRecipients(to) {
	if (Array.isArray(to)) {
		if (to.length === 0) {
			throw new Error("'to' must include at least one recipient email.");
		}
		return to;
	}

	if (typeof to === "string" && to.trim()) {
		return to.trim();
	}

	throw new Error("'to' must be a non-empty string or array of recipient emails.");
}

function normalizeOptionalRecipients(recipients, fieldName) {
	if (typeof recipients === "undefined") {
		return undefined;
	}

	if (Array.isArray(recipients)) {
		if (recipients.length === 0) {
			throw new Error(`'${fieldName}' must include at least one recipient email when provided.`);
		}
		return recipients;
	}

	if (typeof recipients === "string" && recipients.trim()) {
		return recipients.trim();
	}

	throw new Error(`'${fieldName}' must be a non-empty string or array of recipient emails when provided.`);
}

function validatePayload({ senderEmail, senderName, to, bcc, subject, text, html, attachments }) {
	if (!senderEmail || typeof senderEmail !== "string" || !senderEmail.trim()) {
		throw new Error("'senderEmail' is required and must be a non-empty string.");
	}

	if (typeof senderName !== "undefined" && typeof senderName !== "string") {
		throw new Error("'senderName' must be a string when provided.");
	}

	if (!subject || typeof subject !== "string" || !subject.trim()) {
		throw new Error("'subject' is required and must be a non-empty string.");
	}

	if (!text || typeof text !== "string" || !text.trim()) {
		throw new Error("'text' is required and must be a non-empty string.");
	}

	if (typeof html !== "undefined" && typeof html !== "string") {
		throw new Error("'html' must be a string when provided.");
	}

	if (typeof attachments !== "undefined" && !Array.isArray(attachments)) {
		throw new Error("'attachments' must be an array when provided.");
	}

	return {
		senderEmail: senderEmail.trim(),
		senderName: senderName ? senderName.trim() : "",
		to: normalizeRecipients(to),
		bcc: normalizeOptionalRecipients(bcc, "bcc"),
		subject: subject.trim(),
		text,
		html,
		attachments,
	};
}

function buildFromHeader(senderEmail, senderName) {
	if (!senderName) {
		return senderEmail;
	}

	const safeName = senderName.replace(/"/g, "").trim();
	return `${safeName} <${senderEmail}>`;
}

function formatServiceError(error) {
	if (!error) {
		return "SMTP mail service error: unknown error";
	}

	const code = error?.code ? ` [${error.code}]` : "";
	const responseCode = error?.responseCode ? ` (responseCode ${error.responseCode})` : "";
	const message = error?.message || "unknown error";

	return `SMTP mail service error${responseCode}${code}: ${message}`;
}

/**
 * Sends an email through SMTP.
 * Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional env: SMTP_SECURE (defaults to true when SMTP_PORT=465)
 */
async function sendSmtpMail({ senderEmail, senderName, to, bcc, subject, text, html, attachments }) {
	const payload = validatePayload({ senderEmail, senderName, to, bcc, subject, text, html, attachments });
	const transporter = getTransporter();

	try {
		const info = await transporter.sendMail({
			from: buildFromHeader(payload.senderEmail, payload.senderName),
			to: payload.to,
			bcc: payload.bcc,
			subject: payload.subject,
			text: payload.text,
			html: payload.html,
			attachments: payload.attachments,
		});

		return {
			messageId: info.messageId,
			accepted: info.accepted || [],
			rejected: info.rejected || [],
			pending: info.pending || [],
			response: info.response || "",
		};
	} catch (error) {
		throw new Error(formatServiceError(error));
	}
}

async function main() {
	const { default: pLimit } = await import("p-limit");
	const limit = pLimit(5); // 5 emails sent concurrently

	const sender = process.env.SMTP_USER;
	const senderName = process.env.MAIL_FROM_NAME || "Custom Mail Service";
	const users = ["yethishpv.vp@gmail.com", "varunpv.vp@gmail.com", "yethish.coorg@gmail.com"];
	const BCC_BATCH_SIZE = 2;

	const batches = [];
	for (let i = 0; i < users.length; i += BCC_BATCH_SIZE) {
		batches.push(users.slice(i, i + BCC_BATCH_SIZE));
	}

	const results = await Promise.all(
		batches.map((batch) =>
			limit(() =>
				sendSmtpMail({
					senderEmail: sender,
					senderName,
					to: sender,
					bcc: batch,
					subject: "Maintenance Notice",
					text: "Our service will be down tonight.",
					html: "<h2>Our service will be down tonight.</h2>",
				})
			)
		)
	);

	console.log("SUCCESS");
	console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
	console.error("ERROR");
	console.error(error.message);
	process.exitCode = 1;
});