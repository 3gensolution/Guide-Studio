/**
 * IntroBuilderSection — template-based intro builder for the AI sidebar.
 * Lets users pick a template, customize fields, and insert the intro as a clip.
 */
import { Check, Clapperboard, Link2Off, Palette, Type } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { INTRO_TEMPLATES } from "@/lib/intro/introTemplates";
import type { IntroEditableField, IntroTemplate } from "@/lib/intro/introTypes";
import type { VideoClip } from "./types";

interface IntroBuilderSectionProps {
	onInsertIntro?: (clip: VideoClip) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
	"product-launch": "Launch",
	tutorial: "Tutorial",
	demo: "Demo",
	"brand-reveal": "Brand",
	custom: "Custom",
};

function FieldEditor({
	field,
	value,
	onChange,
}: {
	field: IntroEditableField;
	value: string;
	onChange: (value: string) => void;
}) {
	if (field.type === "color") {
		return (
			<div>
				<label className="text-[10px] text-white/50 block mb-1">
					<Palette size={10} className="inline mr-1" />
					{field.label}
				</label>
				<div className="flex items-center gap-2">
					<input
						type="color"
						value={value}
						onChange={(e) => onChange(e.target.value)}
						className="w-7 h-7 rounded border border-white/10 bg-transparent cursor-pointer"
					/>
					<span className="text-[10px] text-white/40 font-mono">{value}</span>
				</div>
			</div>
		);
	}

	if (field.type === "select" && field.options) {
		return (
			<div>
				<label className="text-[10px] text-white/50 block mb-1">{field.label}</label>
				<select
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 focus:outline-none focus:border-[#14b8a6]/40"
				>
					{field.options.map((opt) => (
						<option key={opt} value={opt} className="bg-[#09090b]">
							{opt}
						</option>
					))}
				</select>
			</div>
		);
	}

	return (
		<div>
			<label className="text-[10px] text-white/50 block mb-1">
				<Type size={10} className="inline mr-1" />
				{field.label}
			</label>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={field.defaultValue}
				className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder-white/30 focus:outline-none focus:border-[#14b8a6]/40"
			/>
		</div>
	);
}

export function IntroBuilderSection({ onInsertIntro }: IntroBuilderSectionProps) {
	const [selectedTemplate, setSelectedTemplate] = useState<IntroTemplate | null>(null);
	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
	const [isInserting, setIsInserting] = useState(false);

	const initFieldValues = useCallback((template: IntroTemplate) => {
		const values: Record<string, string> = {};
		for (const field of template.editableFields) {
			values[field.key] = field.defaultValue;
		}
		return values;
	}, []);

	const handleSelectTemplate = useCallback(
		(template: IntroTemplate) => {
			setSelectedTemplate(template);
			setFieldValues(initFieldValues(template));
		},
		[initFieldValues],
	);

	const handleFieldChange = useCallback((key: string, value: string) => {
		setFieldValues((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleInsertIntro = useCallback(async () => {
		if (!selectedTemplate || !onInsertIntro) return;
		setIsInserting(true);

		try {
			const clip: VideoClip = {
				id: `intro-${Date.now()}`,
				sourceVideoPath: "",
				startMs: 0,
				endMs: selectedTemplate.defaultDurationMs,
				offsetMs: 0,
				durationMs: selectedTemplate.defaultDurationMs,
				label: selectedTemplate.name,
				sourceType: "intro",
			};
			onInsertIntro(clip);
		} finally {
			setIsInserting(false);
		}
	}, [selectedTemplate, fieldValues, onInsertIntro]);

	const previewLabel = useMemo(() => {
		if (!selectedTemplate) return "";
		const mainField = selectedTemplate.editableFields[0];
		return mainField ? fieldValues[mainField.key] || mainField.defaultValue : selectedTemplate.name;
	}, [selectedTemplate, fieldValues]);

	return (
		<div className="flex flex-col gap-3">
			{/* Template grid */}
			{!selectedTemplate ? (
				<div className="grid grid-cols-2 gap-1.5">
					{INTRO_TEMPLATES.map((template) => (
						<button
							key={template.id}
							type="button"
							onClick={() => handleSelectTemplate(template)}
							className="flex flex-col items-start gap-1 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#14b8a6]/30 transition-colors text-left"
						>
							<div className="flex items-center gap-1">
								<Clapperboard size={10} className="text-[#14b8a6]" />
								<span className="text-[10px] font-medium text-white/80">
									{template.name}
								</span>
							</div>
							<span className="text-[9px] text-white/40 leading-tight">
								{template.description}
							</span>
							<span className="text-[8px] px-1 py-0.5 rounded bg-white/5 text-white/30 mt-0.5">
								{CATEGORY_LABELS[template.category]}
							</span>
						</button>
					))}
				</div>
			) : (
				<>
					{/* Back button and template info */}
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setSelectedTemplate(null)}
							className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
						>
							&larr; Back
						</button>
						<span className="text-[10px] font-medium text-white/70">
							{selectedTemplate.name}
						</span>
					</div>

					{/* Preview box */}
					<div className="rounded-lg bg-gradient-to-br from-[#14b8a6]/10 to-[#2563eb]/10 border border-white/10 p-3 text-center">
						<div className="text-[13px] font-semibold text-white/90">{previewLabel}</div>
						<div className="text-[9px] text-white/40 mt-1">
							{(selectedTemplate.defaultDurationMs / 1000).toFixed(1)}s intro
						</div>
					</div>

					{/* Editable fields */}
					<div className="flex flex-col gap-2">
						{selectedTemplate.editableFields.map((field) => (
							<FieldEditor
								key={field.key}
								field={field}
								value={fieldValues[field.key] || field.defaultValue}
								onChange={(value) => handleFieldChange(field.key, value)}
							/>
						))}
					</div>

					{/* Insert button */}
					<button
						type="button"
						onClick={handleInsertIntro}
						disabled={isInserting}
						className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#14b8a6]/20 to-[#14b8a6]/10 hover:from-[#14b8a6]/30 hover:to-[#14b8a6]/20 text-[#14b8a6] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
					>
						<Check size={14} />
						{isInserting ? "Inserting..." : "Insert as Intro Clip"}
					</button>
				</>
			)}

			{/* Hyperframe connection placeholder */}
			<div className="mt-1 p-2 rounded-lg border border-white/10 bg-white/[0.02]">
				<div className="flex items-center gap-2 mb-1">
					<Link2Off size={12} className="text-white/40" />
					<span className="text-[10px] font-medium text-white/60">
						Connect to Hyperframe
					</span>
					<span className="text-[8px] px-1 py-0.5 rounded bg-white/10 text-white/40">
						Coming Soon
					</span>
				</div>
				<p className="text-[9px] text-white/30">
					Generate professional intros with AI-powered templates from Hyperframe.
				</p>
			</div>
		</div>
	);
}
