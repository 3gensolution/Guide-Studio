import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISettingsDialog } from "./AISettingsDialog";

const aiSaveProviderKey = vi.fn().mockResolvedValue({ success: true });
const aiSaveConfig = vi.fn().mockResolvedValue({ success: true });
const aiSaveServiceKey = vi.fn().mockResolvedValue({ success: true });
const aiAnalyze = vi.fn().mockResolvedValue({ success: true, text: "OK" });
const noop = () => undefined;

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		writable: true,
		value: {
			aiGetConfig: vi.fn().mockResolvedValue({ provider: "openai", ollamaUrl: "" }),
			aiGetAllKeys: vi.fn().mockResolvedValue({
				keys: { openai: "sk-existing" },
				models: { openai: "gpt-5.4" },
				baseUrls: {},
			}),
			aiGetServiceKey: vi.fn().mockResolvedValue({ apiKey: "" }),
			aiSaveProviderKey,
			aiSaveConfig,
			aiSaveServiceKey,
			aiAnalyze,
			openExternalUrl: vi.fn(),
		},
	});
});

describe("AISettingsDialog", () => {
	it("shows the key already stored for the active provider", async () => {
		render(<AISettingsDialog open onOpenChange={noop} />);
		const field = await screen.findByDisplayValue("sk-existing");
		expect(field).toBeInTheDocument();
		expect(await screen.findByDisplayValue("gpt-5.4")).toBeInTheDocument();
	});

	it("saves the user's key against the provider they picked", async () => {
		render(<AISettingsDialog open onOpenChange={noop} />);
		const field = await screen.findByDisplayValue("sk-existing");
		fireEvent.change(field, { target: { value: "sk-new-key" } });

		fireEvent.click(screen.getByRole("button", { name: /save/i }));

		await waitFor(() => {
			expect(aiSaveProviderKey).toHaveBeenCalledWith(
				"openai",
				expect.objectContaining({ apiKey: "sk-new-key" }),
			);
		});
		expect(aiSaveConfig).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openai", apiKey: "sk-new-key" }),
		);
	});

	it("keeps each provider's key when switching between them", async () => {
		render(<AISettingsDialog open onOpenChange={noop} />);
		await screen.findByDisplayValue("sk-existing");

		fireEvent.click(screen.getByRole("button", { name: /groq/i }));
		const groqField = await screen.findByPlaceholderText("gsk_…");
		fireEvent.change(groqField, { target: { value: "gsk_second" } });

		fireEvent.click(screen.getByRole("button", { name: /save/i }));

		await waitFor(() => {
			expect(aiSaveProviderKey).toHaveBeenCalledWith(
				"groq",
				expect.objectContaining({ apiKey: "gsk_second" }),
			);
		});
		// The OpenAI key typed earlier survives the switch.
		expect(aiSaveProviderKey).toHaveBeenCalledWith(
			"openai",
			expect.objectContaining({ apiKey: "sk-existing" }),
		);
		// Picking Groq makes it the active provider for every AI request.
		expect(aiSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ provider: "groq" }));
	});

	it("tests the connection through the selected provider's own key", async () => {
		render(<AISettingsDialog open onOpenChange={noop} />);
		await screen.findByDisplayValue("sk-existing");

		fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

		await waitFor(() => {
			expect(aiAnalyze).toHaveBeenCalledWith(
				expect.any(String),
				undefined,
				expect.objectContaining({ provider: "openai", model: "gpt-5.4" }),
			);
		});
		expect(await screen.findByText(/replied/i)).toBeInTheDocument();
	});

	it("saves a key for DeepSeek, GLM and Qwen", async () => {
		for (const [id, label, placeholder, key] of [
			["deepseek", /deepseek/i, "sk-…", "sk-deepseek"],
			["glm", /glm/i, "…", "glm-key.secret"],
			["qwen", /qwen/i, "sk-…", "sk-qwen"],
		] as const) {
			vi.clearAllMocks();
			const view = render(<AISettingsDialog open onOpenChange={noop} />);
			await screen.findByDisplayValue("sk-existing");

			fireEvent.click(screen.getByRole("button", { name: label }));
			const field = await screen.findByPlaceholderText(placeholder);
			fireEvent.change(field, { target: { value: key } });
			fireEvent.click(screen.getByRole("button", { name: /save/i }));

			await waitFor(() => {
				expect(aiSaveProviderKey).toHaveBeenCalledWith(
					id,
					expect.objectContaining({ apiKey: key }),
				);
			});
			// Picking it also makes it the provider every AI request goes to.
			expect(aiSaveConfig).toHaveBeenCalledWith(
				expect.objectContaining({ provider: id, apiKey: key }),
			);
			await waitFor(() => {
				expect(aiSaveServiceKey).toHaveBeenCalled();
			});
			view.unmount();
		}
	});

	it("stores an endpoint override for providers that allow one", async () => {
		render(<AISettingsDialog open onOpenChange={noop} />);
		await screen.findByDisplayValue("sk-existing");

		fireEvent.click(screen.getByRole("button", { name: /glm/i }));
		const baseUrl = await screen.findByPlaceholderText("Provider default");
		fireEvent.change(baseUrl, {
			target: { value: "https://open.bigmodel.cn/api/paas/v4" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));

		await waitFor(() => {
			expect(aiSaveProviderKey).toHaveBeenCalledWith(
				"glm",
				expect.objectContaining({ baseUrl: "https://open.bigmodel.cn/api/paas/v4" }),
			);
		});
	});
});
