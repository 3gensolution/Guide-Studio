import {
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
} from "mediabunny";
import type { ExportConfig } from "./types";

export type ExportAudioMuxerCodec = "aac" | "opus";

/**
 * Maximum in-memory export size (~2 GB). Exports exceeding this threshold
 * should use a streaming/temp-file path to avoid crashes.
 */
export const MAX_IN_MEMORY_EXPORT_BYTES = 0x7fffffff;

export class VideoMuxer {
	private output: Output | null = null;
	private videoSource: EncodedVideoPacketSource | null = null;
	private audioSource: EncodedAudioPacketSource | null = null;
	private hasAudio: boolean;
	private target: BufferTarget | null = null;
	private config: ExportConfig;
	private audioCodec: ExportAudioMuxerCodec;
	/** Running total of bytes written (approximate). */
	private cumulativeBytes = 0;

	constructor(config: ExportConfig, hasAudio = false, audioCodec: ExportAudioMuxerCodec = "aac") {
		this.config = config;
		this.hasAudio = hasAudio;
		this.audioCodec = audioCodec;
	}

	/** Returns the approximate cumulative bytes written so far. */
	getCumulativeBytes(): number {
		return this.cumulativeBytes;
	}

	/** Estimate the total export size from bitrate and duration. */
	static estimateExportSize(bitrate: number, durationSec: number): number {
		return Math.ceil((bitrate * durationSec) / 8);
	}

	/** Returns true if the estimated export will exceed the in-memory cap. */
	static willExceedMemoryCap(bitrate: number, durationSec: number): boolean {
		return VideoMuxer.estimateExportSize(bitrate, durationSec) > MAX_IN_MEMORY_EXPORT_BYTES;
	}

	async initialize(): Promise<void> {
		this.target = new BufferTarget();

		this.output = new Output({
			format: new Mp4OutputFormat({
				fastStart: "in-memory",
			}),
			target: this.target,
		});

		// Codec is deduced from the chunk metadata.
		this.videoSource = new EncodedVideoPacketSource("avc");
		this.output.addVideoTrack(this.videoSource, {
			frameRate: this.config.frameRate,
		});

		if (this.hasAudio) {
			this.audioSource = new EncodedAudioPacketSource(this.audioCodec);
			this.output.addAudioTrack(this.audioSource);
		}

		await this.output.start();
	}

	async addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void> {
		if (!this.videoSource) {
			throw new Error("Muxer not initialized");
		}

		this.cumulativeBytes += chunk.byteLength;
		const packet = EncodedPacket.fromEncodedChunk(chunk);

		await this.videoSource.add(packet, meta);
	}

	async addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): Promise<void> {
		if (!this.audioSource) {
			throw new Error("Audio not configured for this muxer");
		}

		this.cumulativeBytes += chunk.byteLength;
		const packet = EncodedPacket.fromEncodedChunk(chunk);

		await this.audioSource.add(packet, meta);
	}

	async finalize(): Promise<Blob> {
		if (!this.output || !this.target) {
			throw new Error("Muxer not initialized");
		}

		await this.output.finalize();
		const buffer = this.target.buffer;

		if (!buffer) {
			throw new Error("Failed to finalize output");
		}

		return new Blob([buffer], { type: "video/mp4" });
	}
}
