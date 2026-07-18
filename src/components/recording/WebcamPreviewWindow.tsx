import { VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Content of the floating webcam self-view bubble (windowType=webcam-preview).
 * Opens its own camera stream — Chromium shares the device with the recorder's
 * stream in the HUD renderer. The whole window is a drag region so the user can
 * park the bubble anywhere; it is content-protected in the main process so it
 * never shows up in the screen capture.
 */
export function WebcamPreviewWindow() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [deviceId, setDeviceId] = useState(
		() => new URLSearchParams(window.location.search).get("deviceId") || "",
	);
	const [failed, setFailed] = useState(false);

	// The HUD re-shows the preview when the user picks a different camera.
	useEffect(() => {
		return window.electronAPI?.onWebcamPreviewDeviceChanged?.((id) => {
			setDeviceId(id);
		});
	}, []);

	useEffect(() => {
		let cancelled = false;
		let stream: MediaStream | null = null;
		setFailed(false);

		const acquire = async () => {
			try {
				const acquired = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: deviceId ? { deviceId: { exact: deviceId } } : true,
				});
				if (cancelled) {
					acquired.getTracks().forEach((track) => track.stop());
					return;
				}
				stream = acquired;
				const video = videoRef.current;
				if (video) {
					video.srcObject = acquired;
					video.play().catch(() => {
						/* autoplay may fail */
					});
				}
			} catch {
				if (!cancelled) setFailed(true);
			}
		};
		void acquire();

		return () => {
			cancelled = true;
			stream?.getTracks().forEach((track) => track.stop());
			if (videoRef.current) videoRef.current.srcObject = null;
		};
	}, [deviceId]);

	return (
		<div
			className="flex h-screen w-full items-center justify-center bg-transparent"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			<div className="h-[200px] w-[200px] overflow-hidden rounded-full border-2 border-white/20 bg-black shadow-[0_18px_42px_rgba(0,0,0,0.4)]">
				{failed ? (
					<div className="flex h-full w-full items-center justify-center text-white/30">
						<VideoOff size={28} />
					</div>
				) : (
					<video
						ref={videoRef}
						muted
						playsInline
						className="h-full w-full scale-x-[-1] object-cover"
					/>
				)}
			</div>
		</div>
	);
}
