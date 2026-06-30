const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

function ensureTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toDirectoryFileUrl(directoryPath: string): URL {
	const normalized = directoryPath.replace(/\\/g, "/");

	if (normalized.startsWith("file://")) {
		return new URL(ensureTrailingSlash(normalized));
	}

	if (normalized.startsWith("/")) {
		return new URL(`file://${ensureTrailingSlash(normalized)}`);
	}

	if (WINDOWS_ABSOLUTE_PATH.test(normalized)) {
		return new URL(`file:///${ensureTrailingSlash(normalized)}`);
	}

	return new URL(`file://${ensureTrailingSlash(normalized)}`);
}

export function resolveExtensionRelativeFileUrl(
	extensionPath: string,
	relativePath: string,
): string {
	const baseUrl = toDirectoryFileUrl(extensionPath);
	const basePath = trimTrailingSlash(baseUrl.pathname);
	const resolvedUrl = new URL(relativePath, baseUrl);
	const resolvedPath = trimTrailingSlash(resolvedUrl.pathname);

	if (resolvedPath !== basePath && !resolvedPath.startsWith(`${basePath}/`)) {
		throw new Error(`Invalid extension path: ${relativePath}`);
	}

	return resolvedUrl.toString();
}

export function createExtensionModuleUrl(extensionPath: string, entryPoint: string): string {
	const base = resolveExtensionRelativeFileUrl(extensionPath, entryPoint);
	// Cache-bust so re-installs / updates load the fresh module
	return `${base}?v=${Date.now()}`;
}
