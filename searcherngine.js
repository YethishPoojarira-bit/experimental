"use strict";

require("dotenv").config();
const OpenAI = require("openai");

const REQUIRED_ENV = [
	"AZURE_OPENAI_API_KEY",
	"AZURE_OPENAI_ENDPOINT",
	"AZURE_OPENAI_DEPLOYMENT",
	"AZURE_OPENAI_API_VERSION",
	"TAVILY_API_KEY",
];

function getMissingEnvVars() {
	return REQUIRED_ENV.filter((name) => !process.env[name] || !process.env[name].trim());
}

function buildAzureClient() {
	const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
	const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
	const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

	return new OpenAI({
		apiKey: process.env.AZURE_OPENAI_API_KEY,
		baseURL: `${endpoint}/openai/deployments/${deployment}`,
		defaultQuery: { "api-version": apiVersion },
		defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
	});
}

async function tavilyJobSearch({ query, max_results = 10, include_domains = [], exclude_domains = [] }) {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			api_key: process.env.TAVILY_API_KEY,
			query,
			max_results,
			search_depth: "advanced",
			include_answer: false,
			include_raw_content: false,
			include_images: false,
			include_domains,
			exclude_domains,
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Tavily request failed (${res.status}): ${body}`);
	}

	const data = await res.json();
	return {
		query,
		results: (data.results || []).map((item) => ({
			title: item.title,
			url: item.url,
			content: item.content,
			score: item.score,
		})),
	};
}

function buildMessages(role, location) {
	const locationHint = location ? ` in ${location}` : "";
	return [
		{
			role: "system",
			content:
				"You are a job-search agent. You must use available tools to find current job openings. " +
				"Return STRICT JSON with this schema: " +
				"{\"role\": string, \"location\": string, \"openings\": [{\"title\": string, \"company\": string, \"location\": string, \"link\": string, \"summary\": string}], \"sources\": [string]}. " +
				"Rules: 1) Each opening must have a direct URL. 2) summary must be short (max 30 words). " +
				"3) Do not invent companies or links. 4) Prefer postings from company/career pages and major job boards.",
		},
		{
			role: "user",
			content:
				`Find job openings for the role \"${role}\"${locationHint}. ` +
				"Use the search tool multiple times if needed and return at least 8 openings when possible.",
		},
	];
}

function tryParseJson(text) {
	try {
		return JSON.parse(text);
	} catch (_) {
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) {
			return null;
		}
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	}
}

async function runRoleJobAgent({ role, location }) {
	const client = buildAzureClient();
	let toolWasUsed = false;
	const tools = [
		{
			type: "function",
			function: {
				name: "tavily_job_search",
				description:
					"Search the web for job postings and career pages for a specific role. Use focused queries by role, location, and hiring keywords.",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string" },
						max_results: { type: "number", minimum: 1, maximum: 20 },
						include_domains: {
							type: "array",
							items: { type: "string" },
						},
						exclude_domains: {
							type: "array",
							items: { type: "string" },
						},
					},
					required: ["query"],
				},
			},
		},
	];

	const messages = buildMessages(role, location);

	for (let i = 0; i < 8; i += 1) {
		let completion;
		try {
			completion = await client.chat.completions.create({
				model: process.env.AZURE_OPENAI_DEPLOYMENT,
				messages,
				tools,
				tool_choice: i === 0 ? { type: "function", function: { name: "tavily_job_search" } } : "auto",
				temperature: 0.2,
			});
		} catch (error) {
			const details = formatServiceError(error, "Azure OpenAI");
			throw new Error(details);
		}

		const message = completion.choices?.[0]?.message;
		if (!message) {
			throw new Error("No response from Azure OpenAI.");
		}

		messages.push(message);

		if (!message.tool_calls || message.tool_calls.length === 0) {
			const payload = tryParseJson(message.content || "");
			if (!payload) {
				throw new Error("Agent returned non-JSON output. Please retry.");
			}
			if (!toolWasUsed) {
				messages.push({
					role: "user",
					content:
						"You must call tavily_job_search at least once before finalizing. Retry and provide refreshed output.",
				});
				continue;
			}
			return payload;
		}

		for (const call of message.tool_calls) {
			if (call.type !== "function") {
				continue;
			}

			const name = call.function.name;
			const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};

			if (name !== "tavily_job_search") {
				messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: JSON.stringify({ error: `Unknown tool: ${name}` }),
				});
				continue;
			}

			try {
				const result = await tavilyJobSearch(args);
				toolWasUsed = true;
				messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: JSON.stringify(result),
				});
			} catch (error) {
				messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: JSON.stringify({
						error: error instanceof Error ? error.message : "Unknown Tavily tool error",
					}),
				});
			}
		}
	}

	throw new Error("Agent reached max iterations without final answer.");
}

function printUsage() {
	console.log("Usage: node searcherngine.js --role \"Backend Developer\" [--location \"Bengaluru\"]");
}

function formatServiceError(error, serviceName) {
	if (!error) {
		return `${serviceName} error: unknown error`;
	}

	const status = error?.status || error?.response?.status;
	const code = error?.code;
	const msg = error?.message || "unknown error";

	if (status || code) {
		return `${serviceName} error${status ? ` (status ${status})` : ""}${code ? ` [${code}]` : ""}: ${msg}`;
	}

	return `${serviceName} error: ${msg}`;
}

function parseCliArgs(argv) {
	const args = { role: "", location: "" };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--role") {
			args.role = argv[i + 1] || "";
			i += 1;
		} else if (token === "--location") {
			args.location = argv[i + 1] || "";
			i += 1;
		}
	}
	return args;
}

function printOutput(result) {
	const openings = cleanOpenings(result.openings);

	console.log(`Role: ${result.role || "N/A"}`);
	console.log(`Location: ${result.location || "N/A"}`);
	console.log(`Openings found: ${openings.length}`);
	console.log("");

	openings.forEach((job, index) => {
		console.log(`${index + 1}. ${job.title || "Untitled"}`);
		console.log(`   Company: ${job.company || "Unknown"}`);
		console.log(`   Location: ${job.location || "Unknown"}`);
		console.log(`   Link: ${job.link || "N/A"}`);
		console.log(`   Summary: ${job.summary || "N/A"}`);
		console.log("");
	});
}

function cleanOpenings(openings) {
	if (!Array.isArray(openings)) {
		return [];
	}

	const seenLinks = new Set();
	const cleaned = [];

	for (const item of openings) {
		const link = typeof item?.link === "string" ? item.link.trim() : "";
		if (!/^https?:\/\//i.test(link)) {
			continue;
		}
		if (seenLinks.has(link)) {
			continue;
		}

		seenLinks.add(link);
		cleaned.push({
			title: item?.title || "Untitled",
			company: item?.company || "Unknown",
			location: item?.location || "Unknown",
			link,
			summary: typeof item?.summary === "string" ? item.summary.trim().slice(0, 220) : "N/A",
		});
	}

	return cleaned;
}

async function main() {
	const missing = getMissingEnvVars();
	if (missing.length > 0) {
		console.error("Missing required environment variables:");
		missing.forEach((name) => console.error(`- ${name}`));
		process.exitCode = 1;
		return;
	}

	const { role, location } = parseCliArgs(process.argv.slice(2));
	if (!role.trim()) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	try {
		const result = await runRoleJobAgent({ role, location });
		printOutput(result);
	} catch (error) {
		const text = error instanceof Error ? error.message : "Unexpected error";
		console.error(text);
		console.error("Troubleshooting:");
		console.error("- Verify AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_VERSION are correct.");
		console.error("- Verify AZURE_OPENAI_API_KEY and TAVILY_API_KEY are valid and active.");
		console.error("- Check if your network/firewall allows access to Azure OpenAI and api.tavily.com.");
		process.exitCode = 1;
	}
}

main();
