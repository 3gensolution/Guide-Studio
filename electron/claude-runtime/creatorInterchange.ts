import fs from "node:fs";
import path from "node:path";
import type { CreatorSession } from "./creator";

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function seconds(value: number): string {
	return `${Math.max(0, value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

function sceneLabel(scene: {
	kind?: string;
	headline?: string;
	text?: string;
	tagline?: string;
}): string {
	return scene.headline ?? scene.text ?? scene.tagline ?? scene.kind ?? "Scene";
}

/** A stable, editable description of the generated plan for future timeline tooling. */
export function buildCreatorProjectManifest(session: CreatorSession): string {
	const scenes = session.motion?.scenes ?? session.storyboard?.frames ?? [];
	let offsetSeconds = 0;
	const manifest = {
		schema: "guide-studio-creator-project",
		version: 1,
		sessionId: session.id,
		title: session.motion?.title ?? session.storyboard?.title ?? "Guide Studio video",
		format: session.format,
		creativeSkill: session.creativeSkill,
		request: session.request,
		videoPath: session.videoPath,
		masterPath: session.masterPath,
		brandPalette: session.motion?.brandPalette,
		assets: [
			...(session.assets ?? []).map((asset) => ({
				id: asset.id,
				kind: "image",
				label: asset.label,
				path: asset.path,
				attribution: asset.attribution,
				sourceUrl: asset.sourceUrl,
			})),
			...(session.referenceAssets ?? []).map((asset) => ({
				id: asset.id,
				kind: asset.kind,
				label: asset.label,
				path: asset.previewPath,
			})),
		],
		scenes: scenes.map((scene, index) => {
			const entry = {
				...scene,
				index,
				offsetSeconds,
				durationSeconds: scene.durationSeconds,
				kind: scene.kind,
				label: sceneLabel(scene),
			};
			offsetSeconds += scene.durationSeconds;
			return entry;
		}),
		finishing: session.finishing,
	};
	return JSON.stringify(manifest, null, 2);
}

/**
 * Export a conservative FCPXML interchange file. The validated master is the
 * picture reference; scene markers preserve the generated editorial beats,
 * while the JSON companion retains the full editable scene/layer contract.
 */
export function buildCreatorFcpXml(session: CreatorSession): string {
	const scenes = session.motion?.scenes ?? session.storyboard?.frames ?? [];
	const title = session.motion?.title ?? session.storyboard?.title ?? "Guide Studio video";
	const durationSeconds = scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
	const width = session.format === "landscape" ? 1920 : 1080;
	const height = session.format === "vertical" ? 1920 : 1080;
	const sourcePath = session.masterPath ?? session.videoPath;
	const assetSrc = sourcePath ? `file://${encodeURI(path.resolve(sourcePath))}` : "";
	const markers: string[] = [];
	let offsetSeconds = 0;
	for (const scene of scenes) {
		markers.push(
			`<marker start="${seconds(offsetSeconds)}" duration="1s" value="${escapeXml(sceneLabel(scene))}"/>`,
		);
		offsetSeconds += scene.durationSeconds;
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="Guide Studio ${width}x${height}" frameDuration="1/30s" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>
    <asset id="r2" name="${escapeXml(title)} master" src="${escapeXml(assetSrc)}" start="0s" duration="${seconds(durationSeconds)}" hasVideo="1" hasAudio="1" format="r1"/>
  </resources>
  <library>
    <event name="Guide Studio">
      <project name="${escapeXml(title)}">
        <sequence format="r1" duration="${seconds(durationSeconds)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48kHz">
          <spine>
            <asset-clip name="${escapeXml(title)}" ref="r2" offset="0s" start="0s" duration="${seconds(durationSeconds)}">
              ${markers.join("\n              ")}
            </asset-clip>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

export function writeCreatorInterchange(
	workspaceRenderDir: string,
	session: CreatorSession,
): { manifestPath: string; fcpxmlPath: string } {
	fs.mkdirSync(workspaceRenderDir, { recursive: true });
	const baseName =
		(session.motion?.title ?? session.storyboard?.title ?? "guide-video")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "guide-video";
	const manifestPath = path.join(workspaceRenderDir, `${baseName}.guide-project.json`);
	const fcpxmlPath = path.join(workspaceRenderDir, `${baseName}.fcpxml`);
	fs.writeFileSync(manifestPath, buildCreatorProjectManifest(session), {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.writeFileSync(fcpxmlPath, buildCreatorFcpXml(session), { encoding: "utf8", mode: 0o600 });
	return { manifestPath, fcpxmlPath };
}
