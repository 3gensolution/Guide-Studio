import { getLocalFilePathFromResource } from "./mediaResource";

function normalizeSourceAudioFallbackPath(resourceOrPath: string): string | null {
	if (typeof resourceOrPath !== "string") {
		return null;
	}

	const resolvedPath = getLocalFilePathFromResource(resourceOrPath) ?? resourceOrPath;
	const trimmedPath = resolvedPath.trim();
	if (!trimmedPath) {
		return null;
	}

	const isWindowsPath =
		/^[A-Za-z]:[\\/]/.test(trimmedPath) || /^\\\\[^\\]+\\[^\\]+/.test(trimmedPath);
	if (isWindowsPath) {
		return trimmedPath.replace(/\//g, "\\").toLowerCase();
	}

	return trimmedPath.replace(/\\/g, "/");
}

export function resolveSourceAudioFallbackPaths(
	videoResource: string | null | undefined,
	sourceAudioFallbackPaths: string[] | null | undefined,
) {
	const normalizedPaths = (sourceAudioFallbackPaths ?? [])
		.filter((audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0)
		.map((audioPath) => ({
			audioPath,
			normalizedPath: normalizeSourceAudioFallbackPath(audioPath),
		}));
	const localVideoSourcePath = videoResource
		? normalizeSourceAudioFallbackPath(videoResource)
		: null;
	const hasEmbeddedSourceAudio =
		Boolean(localVideoSourcePath) &&
		normalizedPaths.some(({ normalizedPath }) => normalizedPath === localVideoSourcePath);

	return {
		hasEmbeddedSourceAudio,
		externalAudioPaths: hasEmbeddedSourceAudio
			? normalizedPaths
					.filter(({ normalizedPath }) => normalizedPath !== localVideoSourcePath)
					.map(({ audioPath }) => audioPath)
			: normalizedPaths.map(({ audioPath }) => audioPath),
	};
}
