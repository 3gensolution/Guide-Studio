/**
 * Guide doc rendering — turns a GuideDoc into a single-file HTML page
 * (screenshots embedded as data URLs, printable to PDF) or Markdown for
 * pasting into Notion / Confluence / GitHub.
 */
import type { GuideDoc } from "./types";

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function formatTimestamp(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

/** Render a guide as a self-contained HTML document (no external assets) */
export function renderGuideHtml(doc: GuideDoc): string {
	const steps = doc.steps
		.map((step) => {
			const screenshot = step.screenshotDataUrl
				? `<img class="shot" src="${step.screenshotDataUrl}" alt="${escapeHtml(step.title)}" />`
				: "";
			const description = step.description
				? `<p class="desc">${escapeHtml(step.description)}</p>`
				: "";
			return `
		<section class="step">
			<div class="step-head">
				<span class="badge">${step.index}</span>
				<div>
					<h2>${escapeHtml(step.title)}</h2>
					<span class="time">at ${formatTimestamp(step.timeMs)}</span>
				</div>
			</div>
			${description}
			${screenshot}
		</section>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.title)}</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; margin: 0; }
	body {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
		color: #1c1917; background: #fafaf9; line-height: 1.55;
	}
	main { max-width: 860px; margin: 0 auto; padding: 48px 24px 96px; }
	header { margin-bottom: 40px; border-bottom: 2px solid #e7e5e4; padding-bottom: 24px; }
	header h1 { font-size: 28px; letter-spacing: -0.02em; }
	header .meta { margin-top: 8px; color: #78716c; font-size: 13px; }
	header .intro { margin-top: 16px; color: #44403c; font-size: 15px; }
	.step { margin: 32px 0; }
	.step-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
	.badge {
		flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
		background: #6E6BFF; color: #fff; font-size: 14px; font-weight: 700;
		display: flex; align-items: center; justify-content: center; margin-top: 2px;
	}
	.step h2 { font-size: 17px; font-weight: 650; }
	.time { color: #a8a29e; font-size: 12px; }
	.desc { margin: 0 0 12px 40px; color: #44403c; font-size: 14px; }
	.shot {
		display: block; width: 100%; margin-left: 0; border-radius: 10px;
		border: 1px solid #e7e5e4; box-shadow: 0 2px 10px rgb(0 0 0 / 0.06);
	}
	footer { margin-top: 56px; color: #a8a29e; font-size: 12px; text-align: center; }
	@media print {
		body { background: #fff; }
		.step { break-inside: avoid; }
	}
</style>
</head>
<body>
<main>
	<header>
		<h1>${escapeHtml(doc.title)}</h1>
		<div class="meta">${doc.steps.length} steps · video length ${formatTimestamp(doc.durationMs)} · ${formatDate(doc.createdAt)}</div>
		${doc.intro ? `<p class="intro">${escapeHtml(doc.intro)}</p>` : ""}
	</header>
${steps}
	<footer>Made with Guide Studio</footer>
</main>
</body>
</html>`;
}

/** Render a guide as Markdown with embedded (data URL) screenshots */
export function renderGuideMarkdown(doc: GuideDoc): string {
	const lines: string[] = [
		`# ${doc.title}`,
		"",
		`> ${doc.steps.length} steps · video length ${formatTimestamp(doc.durationMs)} · ${formatDate(doc.createdAt)}`,
		"",
	];

	if (doc.intro) {
		lines.push(doc.intro, "");
	}

	for (const step of doc.steps) {
		lines.push(`## ${step.title}`, "");
		lines.push(`*At ${formatTimestamp(step.timeMs)}*`, "");
		if (step.description) lines.push(step.description, "");
		if (step.screenshotDataUrl) {
			lines.push(`![Step ${step.index}](${step.screenshotDataUrl})`, "");
		}
	}

	lines.push("---", "", "*Made with Guide Studio*", "");
	return lines.join("\n");
}
