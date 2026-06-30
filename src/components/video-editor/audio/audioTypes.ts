/** Audio waveform peaks data for visualization. */
export interface AudioPeaksData {
	peaks: Float32Array;
	sampleRate: number;
	length: number;
}

export type SourceAudioTrackId = "mixed" | "system" | "mic" | (string & {});

export interface SourceAudioTrackSetting {
	volume: number;
	normalize: boolean;
}

export type SourceAudioTrackSettings = Record<string, SourceAudioTrackSetting>;

export interface SourceAudioTrackMetaItem {
	id: SourceAudioTrackId;
	label: string;
}

export type SourceAudioTrackMeta = SourceAudioTrackMetaItem[];

export interface SourceAudioTrackWithPeaks extends SourceAudioTrackMetaItem {
	peaks: AudioPeaksData;
}

export const SOURCE_AUDIO_FALLBACK_TOAST_ID = "source-audio-fallback-error";
export const SOURCE_AUDIO_NORMALIZE_GAIN = 1.35;
