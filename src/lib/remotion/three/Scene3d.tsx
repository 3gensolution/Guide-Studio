import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import React from "react";
import {
	continueRender,
	delayRender,
	Easing,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { SRGBColorSpace, type Texture, TextureLoader } from "three";
import type { DataTower, DeviceKind, Scene3dId, Scene3dParams } from "./scenes";

// ── 3D scene renderer ────────────────────────────────────────────────────
//
// Six audited scenes. Each is a pure function of the current frame, so any two
// frames rendered in different browser instances agree; see `scenes.ts` for why
// that matters here specifically.
//
// Textures are loaded from bundle-relative sources the privileged renderer
// staged, exactly like the 2D image frames. Nothing here fetches.

export interface Scene3dProps {
	scene: Scene3dId;
	params: Scene3dParams;
	/** Bundle-relative sources for the assets the scene names, in order. */
	textures: string[];
	durationInFrames: number;
	accentHex: string;
	softHex: string;
	width: number;
	height: number;
}

/** 0→1 over the shot, eased so entrances and exits are not linear. */
function useShotProgress(durationInFrames: number) {
	const frame = useCurrentFrame();
	return interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
}

function useEntrance(durationInFrames: number) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return interpolate(frame, [0, Math.min(durationInFrames, Math.round(fps * 0.9))], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing: Easing.bezier(0.22, 1, 0.36, 1),
	});
}

export const Scene3d: React.FC<Scene3dProps> = (props) => {
	return (
		<ThreeCanvas
			width={props.width}
			height={props.height}
			// A fixed clear colour, matching the 2D canvas, so a 3D frame does not
			// flash a different background than the frames either side of it.
			gl={{ antialias: true, alpha: false }}
			camera={{ fov: 40, position: [0, 0, 6] }}
			style={{ backgroundColor: "#0B0F14" }}
		>
			<SceneLights accentHex={props.accentHex} />
			<SceneBody {...props} />
		</ThreeCanvas>
	);
};

const SceneLights: React.FC<{ accentHex: string }> = ({ accentHex }) => (
	<>
		<ambientLight intensity={0.55} />
		<directionalLight position={[4, 6, 6]} intensity={1.5} />
		{/* The brand colour arrives as light rather than as paint, so a scene
		    reads as themed without every material having to know about it. */}
		<pointLight position={[-5, 2, 3]} intensity={2.4} color={accentHex} distance={18} />
	</>
);

const SceneBody: React.FC<Scene3dProps> = (props) => {
	switch (props.scene) {
		case "logo_extrude":
			return <LogoExtrudeScene {...props} />;
		case "product_orbit":
			return <ProductOrbitScene {...props} />;
		case "data_towers":
			return <DataTowersScene {...props} />;
		case "particle_field":
			return <ParticleFieldScene {...props} />;
		case "card_stack":
			return <CardStackScene {...props} />;
		default:
			return <DeviceMockupScene {...props} />;
	}
};

// ── device_mockup ────────────────────────────────────────────────────────

const DEVICE_GEOMETRY: Record<DeviceKind, { width: number; height: number; bezel: number }> = {
	laptop: { width: 4.4, height: 2.75, bezel: 0.12 },
	phone: { width: 1.6, height: 3.3, bezel: 0.09 },
	tablet: { width: 3.0, height: 4.0, bezel: 0.1 },
};

const DeviceMockupScene: React.FC<Scene3dProps> = ({
	params,
	textures,
	durationInFrames,
	accentHex,
}) => {
	const progress = useShotProgress(durationInFrames);
	const entrance = useEntrance(durationInFrames);
	const geometry = DEVICE_GEOMETRY[params.device ?? "laptop"];
	const spin = ((params.spinDegrees ?? 40) * Math.PI) / 180;
	// Starts turned away and settles toward the viewer, so the shot resolves.
	const rotationY = -spin / 2 + spin * progress;
	const texture = textures[0];
	return (
		<group
			rotation={[-0.08, rotationY, 0]}
			position={[0, 0, -1 + entrance]}
			scale={0.85 + entrance * 0.15}
		>
			<mesh>
				<boxGeometry args={[geometry.width, geometry.height, 0.16]} />
				<meshStandardMaterial color="#232C38" metalness={0.2} roughness={0.5} />
			</mesh>
			<ScreenSurface
				src={texture}
				width={geometry.width - geometry.bezel * 2}
				height={geometry.height - geometry.bezel * 2}
				accentHex={accentHex}
			/>
			{/* A plinth, so the device is standing on something rather than floating. */}
			<mesh position={[0, -geometry.height / 2 - 0.5, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
				<circleGeometry args={[geometry.width * 0.75, 48]} />
				<meshStandardMaterial color="#12181F" metalness={0.2} roughness={0.9} />
			</mesh>
		</group>
	);
};

/** The lit surface an image is mapped onto. Missing texture, plain panel. */
const ScreenSurface: React.FC<{
	src?: string;
	width: number;
	height: number;
	accentHex: string;
}> = ({ src, width, height, accentHex }) =>
	src ? (
		<TexturedPlane
			src={src}
			width={width}
			height={height}
			position={[0, 0, 0.085]}
			fallbackHex={accentHex}
		/>
	) : (
		<mesh position={[0, 0, 0.085]}>
			<planeGeometry args={[width, height]} />
			<meshStandardMaterial color={accentHex} emissive={accentHex} emissiveIntensity={0.25} />
		</mesh>
	);

// ── logo_extrude ─────────────────────────────────────────────────────────

const LogoExtrudeScene: React.FC<Scene3dProps> = ({
	params,
	textures,
	durationInFrames,
	accentHex,
}) => {
	const progress = useShotProgress(durationInFrames);
	const entrance = useEntrance(durationInFrames);
	const depth = params.depth ?? 0.35;
	const spin = ((params.spinDegrees ?? 300) * Math.PI) / 180;
	const src = textures[0];
	return (
		<group rotation={[0.1, spin * progress - spin / 2, 0]} scale={0.7 + entrance * 0.3}>
			{/* A slab carries the depth; the logo is mapped onto its front face.
			    Extruding the artwork itself would need its silhouette, which an
			    arbitrary raster logo does not give us. */}
			<mesh>
				<boxGeometry args={[2.6, 2.6, depth]} />
				{/* Metalness without an environment map to reflect renders black, so
				    these stay mostly dielectric. Learned by rendering it. */}
				<meshStandardMaterial color="#243244" metalness={0.2} roughness={0.5} />
			</mesh>
			{src ? (
				<TexturedPlane
					src={src}
					width={2.2}
					height={2.2}
					position={[0, 0, depth / 2 + 0.01]}
					fallbackHex={accentHex}
				/>
			) : (
				<mesh position={[0, 0, depth / 2 + 0.01]}>
					<planeGeometry args={[2.2, 2.2]} />
					<meshStandardMaterial color={accentHex} />
				</mesh>
			)}
		</group>
	);
};

// ── product_orbit ────────────────────────────────────────────────────────

const ProductOrbitScene: React.FC<Scene3dProps> = ({
	params,
	textures,
	durationInFrames,
	accentHex,
}) => {
	const progress = useShotProgress(durationInFrames);
	const entrance = useEntrance(durationInFrames);
	const orbit = ((params.spinDegrees ?? 90) * Math.PI) / 180;
	const angle = -orbit / 2 + orbit * progress;
	const src = textures[0];
	return (
		<group>
			<group
				rotation={[0, angle, 0]}
				position={[0, 0.35 + (1 - entrance) * 0.6, 0]}
				scale={0.8 + entrance * 0.2}
			>
				{src ? (
					<TexturedPlane
						src={src}
						width={4.2}
						height={2.4}
						position={[0, 0, 0]}
						fallbackHex={accentHex}
					/>
				) : (
					<mesh>
						<planeGeometry args={[4.2, 2.4]} />
						<meshStandardMaterial color={accentHex} />
					</mesh>
				)}
			</group>
			<mesh position={[0, -1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<planeGeometry args={[14, 14]} />
				<meshStandardMaterial color="#0E141B" metalness={0.6} roughness={0.4} />
			</mesh>
		</group>
	);
};

// ── data_towers ──────────────────────────────────────────────────────────

const DataTowersScene: React.FC<Scene3dProps> = ({
	params,
	durationInFrames,
	accentHex,
	softHex,
}) => {
	const progress = useShotProgress(durationInFrames);
	const bars: DataTower[] = params.bars?.length ? params.bars : [{ label: "", value: 1 }];
	const peak = Math.max(...bars.map((bar) => Math.abs(bar.value)), 1);
	const spacing = 1.15;
	const offset = ((bars.length - 1) * spacing) / 2;
	return (
		<group rotation={[0.12, -0.5, 0]} position={[0, -1.1, 0]}>
			{bars.map((bar, index) => {
				// Each tower starts a little after the one before it, which reads as
				// the chart being drawn. Staggering is derived from the index, so it
				// stays a pure function of the frame.
				const start = index * 0.08;
				const grown = Math.max(
					0,
					Math.min(1, (progress - start) / Math.max(0.2, 1 - start - 0.15)),
				);
				const height = Math.max(0.02, (Math.abs(bar.value) / peak) * 3.4 * grown);
				return (
					<mesh key={`${bar.label}-${index}`} position={[index * spacing - offset, height / 2, 0]}>
						<boxGeometry args={[0.7, height, 0.7]} />
						<meshStandardMaterial
							color={index % 2 === 0 ? accentHex : softHex}
							metalness={0.35}
							roughness={0.4}
						/>
					</mesh>
				);
			})}
			<mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<planeGeometry args={[16, 16]} />
				<meshStandardMaterial color="#0E141B" roughness={0.95} />
			</mesh>
		</group>
	);
};

// ── particle_field ───────────────────────────────────────────────────────

/**
 * A lattice, not a random cloud. Positions come from the index through a
 * deterministic hash, so the field is identical on every render pass — a
 * `Math.random()` here would make each parallel frame a different field.
 */
function latticePosition(index: number): [number, number, number] {
	const golden = 2.399963229728653;
	const radius = 1.2 + ((index * 37) % 100) / 22;
	const angle = index * golden;
	const depth = -4 + ((index * 61) % 100) / 12;
	return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.62, depth];
}

const ParticleFieldScene: React.FC<Scene3dProps> = ({
	params,
	durationInFrames,
	accentHex,
	softHex,
}) => {
	const progress = useShotProgress(durationInFrames);
	const count = Math.round(params.density ?? 260);
	const drift = progress * 0.6;
	return (
		<group rotation={[0, drift, 0]}>
			{Array.from({ length: count }, (_, index) => {
				const [x, y, z] = latticePosition(index);
				const size = 0.02 + ((index * 13) % 7) / 190;
				return (
					<mesh key={index} position={[x, y + Math.sin(index + progress * 3) * 0.05, z]}>
						<sphereGeometry args={[size, 6, 6]} />
						<meshStandardMaterial
							color={index % 3 === 0 ? softHex : accentHex}
							emissive={accentHex}
							emissiveIntensity={0.45}
						/>
					</mesh>
				);
			})}
		</group>
	);
};

// ── card_stack ───────────────────────────────────────────────────────────

const CardStackScene: React.FC<Scene3dProps> = ({ textures, durationInFrames, accentHex }) => {
	const progress = useShotProgress(durationInFrames);
	const entrance = useEntrance(durationInFrames);
	const cards = textures.length ? textures : [undefined];
	return (
		<group rotation={[0.05, -0.35 + progress * 0.5, 0]}>
			{cards.map((src, index) => {
				const spread = (index - (cards.length - 1) / 2) * 0.9;
				return (
					<group
						key={`${src ?? "blank"}-${index}`}
						position={[spread * entrance, -spread * 0.18, index * -0.7]}
						rotation={[0, spread * 0.12, spread * 0.03]}
					>
						{src ? (
							<TexturedPlane
								src={src}
								width={3.1}
								height={1.95}
								position={[0, 0, 0]}
								fallbackHex={accentHex}
							/>
						) : (
							<mesh>
								<planeGeometry args={[3.1, 1.95]} />
								<meshStandardMaterial color={accentHex} />
							</mesh>
						)}
					</group>
				);
			})}
		</group>
	);
};

// ── Texture plumbing ─────────────────────────────────────────────────────

/**
 * Loads one image into a texture, holding the frame until it is ready.
 *
 * The `delayRender` is not optional. Remotion captures a frame as soon as the
 * component has painted, and it renders frames in parallel across separate
 * browser instances — without the hold, whether a texture had finished loading
 * would vary per frame, and the shot would flicker between textured and blank.
 * A load failure calls `continueRender` too: a missing texture should cost one
 * plane, not the whole video.
 *
 * A supplied GIF shows its first frame only. Animating one would mean decoding
 * it per frame, which is not worth the render cost for a texture on a spinning
 * card.
 */
interface TextureLoad {
	texture?: Texture;
	failed?: boolean;
	/** Remotion hold, released only once the scene has repainted with the result. */
	handle: number;
	released: boolean;
	settled: Promise<void>;
}

/** Safety net so a texture that never settles cannot hang a render forever. */
const TEXTURE_HOLD_CEILING_MS = 20_000;

/**
 * One load per source, for the lifetime of the tab.
 *
 * Ownership matters more than caching here. `delayRender` has to be called
 * during the render phase — from an effect it runs after Remotion has already
 * decided the frame is ready, and the capture happens without waiting. But a
 * handle tied to a component *mount* gets released the moment React remounts
 * that component, which it does routinely. Tying the handle to the load instead
 * satisfies both: registered during render, continued exactly once when the
 * load settles, and immune to remounts.
 *
 * Textures are immutable per source, so sharing them across frames in the same
 * tab is also the fast path.
 */
const textureLoads = new Map<string, TextureLoad>();

function loadTextureOnce(src: string): TextureLoad {
	const existing = textureLoads.get(src);
	if (existing) return existing;

	// The renderer stages assets as bundle-relative paths. Resolving against the
	// document explicitly rather than letting the loader guess is what makes this
	// work regardless of the page URL the bundle is served at.
	const absolute =
		typeof window === "undefined" ? src : new URL(src, window.location.href).toString();
	const handle = delayRender(`Loading 3D texture: ${src.slice(0, 80)}`);
	const entry: TextureLoad = {
		handle,
		released: false,
		settled: new Promise<void>((resolve) => {
			new TextureLoader().load(
				absolute,
				(loaded) => {
					loaded.colorSpace = SRGBColorSpace;
					entry.texture = loaded;
					resolve();
				},
				undefined,
				() => {
					// Logged, not swallowed: a silently missing texture used to render a
					// black frame with nothing in the render output to explain it.
					console.warn(`[Scene3d] Could not load texture: ${absolute}`);
					entry.failed = true;
					resolve();
				},
			);
		}),
	};
	// The load deliberately does *not* release the hold. Releasing it here tells
	// Remotion the frame is ready while React has yet to re-render with the
	// texture and the canvas has yet to repaint — the capture then gets the
	// previous, empty paint. `releaseAfterPaint` does it at the right moment.
	setTimeout(() => releaseTextureHold(entry), TEXTURE_HOLD_CEILING_MS);
	textureLoads.set(src, entry);
	return entry;
}

function releaseTextureHold(entry: TextureLoad) {
	if (entry.released) return;
	entry.released = true;
	continueRender(entry.handle);
}

function useImageTexture(src: string): { texture: Texture | null; failed: boolean } {
	// Started during render, not in an effect — see `loadTextureOnce`.
	const entry = loadTextureOnce(src);
	const [, bumpVersion] = React.useState(0);
	// React-three-fiber renders on demand, and Remotion only invalidates once per
	// video frame — before an async texture has arrived. Without an explicit
	// invalidate, setting the texture updates the scene graph but never repaints,
	// so the capture gets the first (empty) paint and the frame comes out black.
	const invalidate = useThree((state) => state.invalidate);

	const settledHere = Boolean(entry.texture || entry.failed);

	// Step one: when the load settles, re-render so the material picks it up.
	React.useEffect(() => {
		if (settledHere) return;
		let active = true;
		void entry.settled.then(() => {
			if (active) bumpVersion((version) => version + 1);
		});
		return () => {
			active = false;
		};
	}, [entry, settledHere]);

	// Step two: this render has the result, so repaint and only then let Remotion
	// capture. `invalidate` queues a paint for the next animation frame, so the
	// hold is released a frame later — after the canvas actually shows the
	// texture rather than merely knowing about it.
	React.useEffect(() => {
		if (!settledHere || entry.released) return;
		invalidate();
		const raf = requestAnimationFrame(() => {
			requestAnimationFrame(() => releaseTextureHold(entry));
		});
		return () => cancelAnimationFrame(raf);
	}, [entry, settledHere, invalidate]);

	return { texture: entry.texture ?? null, failed: entry.failed ?? false };
}

/**
 * An image on a plane, with a visible fallback.
 *
 * The fallback is the important part. Rendering nothing when a texture fails
 * leaves only the near-black slab behind it, which looks exactly like a broken
 * render — and because nothing throws, the 2D fallback in `renderHyperFrameDemo`
 * never fires either. A branded panel is an obviously-degraded frame instead of
 * a mysteriously empty one.
 */
const TexturedPlane: React.FC<{
	src: string;
	width: number;
	height: number;
	position: [number, number, number];
	fallbackHex: string;
}> = ({ src, width, height, position, fallbackHex }) => {
	const { texture, failed } = useImageTexture(src);
	if (!texture) {
		if (!failed) return null;
		return (
			<mesh position={position}>
				<planeGeometry args={[width, height]} />
				<meshStandardMaterial color={fallbackHex} emissive={fallbackHex} emissiveIntensity={0.2} />
			</mesh>
		);
	}
	return (
		<mesh position={position}>
			<planeGeometry args={[width, height]} />
			<meshBasicMaterial map={texture} toneMapped={false} />
		</mesh>
	);
};
