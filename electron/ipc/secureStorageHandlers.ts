import { promises as fs } from "node:fs";
import path from "node:path";
import { app, ipcMain, safeStorage } from "electron";

/**
 * OS-keychain-backed secure key-value store, plus the serialized pro-token
 * refresh. The preload has exposed `secure-store-get/set/delete` and
 * `pro-refresh-token` for a while, but the main-process handlers were never
 * registered — every license check crashed with "No handler registered",
 * which knocked all users (including paying ones) down to the Free tier.
 *
 * Values are encrypted with Electron safeStorage when the OS keychain is
 * available; the ciphertext lives in secure-store.json under userData. On
 * systems with no keychain the value is stored with a `plain:` marker —
 * degraded but functional, and still out of renderer localStorage.
 */

const STORE_FILENAME = "secure-store.json";

function storePath(): string {
	return path.join(app.getPath("userData"), STORE_FILENAME);
}

async function readStore(): Promise<Record<string, string>> {
	try {
		const raw = await fs.readFile(storePath(), "utf8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
	} catch {
		return {};
	}
}

async function writeStore(store: Record<string, string>): Promise<void> {
	const target = storePath();
	const tmp = `${target}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(store), "utf8");
	await fs.rename(tmp, target);
}

function encode(value: string): string {
	if (safeStorage.isEncryptionAvailable()) {
		return `enc:${safeStorage.encryptString(value).toString("base64")}`;
	}
	return `plain:${value}`;
}

function decode(entry: string | undefined): string | null {
	if (entry === undefined) return null;
	if (entry.startsWith("enc:")) {
		try {
			return safeStorage.decryptString(Buffer.from(entry.slice(4), "base64"));
		} catch {
			// Keychain changed or data corrupted — treat as absent.
			return null;
		}
	}
	if (entry.startsWith("plain:")) return entry.slice(6);
	return null;
}

// All store access is funneled through one chain so concurrent set/delete
// calls from the renderer can't interleave their read-modify-write cycles.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
	const next = chain.then(op, op);
	chain = next.catch(() => {
		// Errors surface to the awaiting caller; the chain itself must not break.
	});
	return next;
}

async function secureGet(key: string): Promise<string | null> {
	return serialized(async () => decode((await readStore())[key]));
}

async function secureSet(key: string, value: string): Promise<void> {
	await serialized(async () => {
		const store = await readStore();
		store[key] = encode(value);
		await writeStore(store);
	});
}

async function secureDelete(key: string): Promise<void> {
	await serialized(async () => {
		const store = await readStore();
		if (key in store) {
			delete store[key];
			await writeStore(store);
		}
	});
}

// ── Pro token refresh ──
// Mirrors the renderer's proLoader config: the renderer delegates here so
// refreshes are serialized in one place even with several windows open.
const PRO_TOKEN_KEY = "studio-pro-token";
const PRO_REFRESH_URL = process.env.VITE_DEV_SERVER_URL
	? "http://localhost:4100/refresh"
	: "https://app.guideai.com/api/v1/auth/refresh";

let inFlightRefresh: Promise<{ success: boolean; accessToken: string | null }> | null = null;

async function refreshProToken(): Promise<{ success: boolean; accessToken: string | null }> {
	if (inFlightRefresh) return inFlightRefresh;
	inFlightRefresh = (async () => {
		try {
			const refreshToken = await secureGet(`${PRO_TOKEN_KEY}-refresh`);
			if (!refreshToken) return { success: false, accessToken: null };

			const res = await fetch(PRO_REFRESH_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refreshToken }),
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) return { success: false, accessToken: null };

			const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
			if (!data.accessToken) return { success: false, accessToken: null };

			await secureSet(PRO_TOKEN_KEY, data.accessToken);
			if (data.refreshToken) {
				await secureSet(`${PRO_TOKEN_KEY}-refresh`, data.refreshToken);
			}
			return { success: true, accessToken: data.accessToken };
		} catch {
			return { success: false, accessToken: null };
		} finally {
			inFlightRefresh = null;
		}
	})();
	return inFlightRefresh;
}

export function registerSecureStorageHandlers() {
	ipcMain.handle("secure-store-get", async (_event, key: string) => {
		try {
			return await secureGet(String(key));
		} catch (error) {
			console.error(`Failed to read secure store key ${key}:`, error);
			return null;
		}
	});

	ipcMain.handle("secure-store-set", async (_event, key: string, value: string) => {
		try {
			await secureSet(String(key), String(value));
			return { success: true };
		} catch (error) {
			console.error(`Failed to write secure store key ${key}:`, error);
			return { success: false };
		}
	});

	ipcMain.handle("secure-store-delete", async (_event, key: string) => {
		try {
			await secureDelete(String(key));
			return { success: true };
		} catch (error) {
			console.error(`Failed to delete secure store key ${key}:`, error);
			return { success: false };
		}
	});

	ipcMain.handle("pro-refresh-token", async () => refreshProToken());
}
