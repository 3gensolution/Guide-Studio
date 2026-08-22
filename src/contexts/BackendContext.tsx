// ── Backend Context (local-only) ─────────────────────────────────────────
//
// Guide Studio runs entirely on the local machine. Nothing in the app talks
// to the Guide Studio backend any more: no health probe, no sign-in, no
// account session. AI runs through the local Electron AI service (Ollama or
// the user's own provider key), configured in Settings.
//
// The HTTP client in `src/lib/api/` is kept in the tree for reference, but
// this provider is the only thing that ever selected it — reporting the
// backend as permanently unavailable is what pins the app to local mode.

import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { User } from "@/lib/api/auth";

interface BackendContextValue {
	/** Always false — the app no longer calls the Guide Studio backend. */
	isBackendAvailable: boolean;
	/** Always false — there is no account session in local mode. */
	isAuthenticated: boolean;
	/** Always null — local mode has no signed-in user. */
	user: User | null;
	/** No-op; kept so callers written against the old contract still compile. */
	showLogin: () => void;
	/** No-op; there is no session to end. */
	logout: () => Promise<void>;
}

const LOCAL_ONLY_VALUE: BackendContextValue = {
	isBackendAvailable: false,
	isAuthenticated: false,
	user: null,
	showLogin: () => {
		/* no sign-in in local mode */
	},
	logout: async () => {
		/* no session to end */
	},
};

const BackendContext = createContext<BackendContextValue>(LOCAL_ONLY_VALUE);

export function BackendProvider({ children }: { children: ReactNode }) {
	const value = useMemo(() => LOCAL_ONLY_VALUE, []);
	return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend() {
	return useContext(BackendContext);
}
