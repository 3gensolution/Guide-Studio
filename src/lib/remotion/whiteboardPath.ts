// ── Path sampling for the whiteboard's drawn artwork ─────────────────────
//
// The pen has to sit on the line it is drawing, which means knowing where a
// path is at a given fraction of its length. `SVGPathElement.getPointAtLength`
// would answer that, but only against a laid-out DOM: it does not exist under
// jsdom, and depending on it would make the pen untestable and tie a Remotion
// frame to element measurement it otherwise never needs.
//
// So paths are flattened here instead, in plain arithmetic. The doodle catalog
// is authored against this parser, which is why it uses only the command subset
// below — anything else throws rather than silently drawing a broken figure.

export interface Point {
	x: number;
	y: number;
}

export interface SampledPath {
	/** The flattened polyline, in path order. */
	points: Point[];
	/** Cumulative length at each point; the last entry is the total. */
	lengths: number[];
	length: number;
}

/** Curves are flattened into this many segments each. */
const CURVE_STEPS = 20;

// Every letter is captured, not just the supported ones, so an arc or any
// other command reaches the `default` below and throws by name instead of
// being skipped and having its arguments swallowed by the previous command.
const TOKENS = /([A-Za-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/**
 * Flattens a path into a polyline with cumulative lengths.
 *
 * Supports M/L/H/V/C/Q/S/T/Z in both cases. Arcs are deliberately unsupported:
 * every round shape in the catalog is built from beziers by the helpers in
 * `whiteboardDoodles`, so an `A` in a path means the path was written by hand
 * and has not been through them.
 */
export function samplePath(d: string): SampledPath {
	const points: Point[] = [];
	const lengths: number[] = [0];
	let total = 0;

	const push = (x: number, y: number) => {
		const previous = points[points.length - 1];
		if (previous) {
			total += Math.hypot(x - previous.x, y - previous.y);
			lengths.push(total);
		}
		points.push({ x, y });
	};

	let command = "";
	let cursor: Point = { x: 0, y: 0 };
	let start: Point = { x: 0, y: 0 };
	// Reflection point for the shorthand S/T curves.
	let lastControl: Point | null = null;
	const numbers: number[] = [];

	const take = (count: number): number[] => {
		if (numbers.length < count) {
			throw new Error(`Whiteboard path "${d}": ${command} is missing arguments`);
		}
		return numbers.splice(0, count);
	};

	const relative = () => command === command.toLowerCase();
	const at = (x: number, y: number): Point =>
		relative() ? { x: cursor.x + x, y: cursor.y + y } : { x, y };

	const flush = () => {
		while (numbers.length) {
			switch (command.toUpperCase()) {
				case "M": {
					const [x, y] = take(2) as [number, number];
					cursor = at(x, y);
					start = cursor;
					push(cursor.x, cursor.y);
					// A second coordinate pair after a moveto is an implicit lineto.
					command = relative() ? "l" : "L";
					lastControl = null;
					break;
				}
				case "L": {
					const [x, y] = take(2) as [number, number];
					cursor = at(x, y);
					push(cursor.x, cursor.y);
					lastControl = null;
					break;
				}
				case "H": {
					const [x] = take(1) as [number];
					cursor = { x: relative() ? cursor.x + x : x, y: cursor.y };
					push(cursor.x, cursor.y);
					lastControl = null;
					break;
				}
				case "V": {
					const [y] = take(1) as [number];
					cursor = { x: cursor.x, y: relative() ? cursor.y + y : y };
					push(cursor.x, cursor.y);
					lastControl = null;
					break;
				}
				case "C":
				case "S": {
					const shorthand = command.toUpperCase() === "S";
					const args = take(shorthand ? 4 : 6);
					const c1 = shorthand
						? reflect(lastControl, cursor)
						: at(args[0] as number, args[1] as number);
					const rest = shorthand ? args : args.slice(2);
					const c2 = at(rest[0] as number, rest[1] as number);
					const end = at(rest[2] as number, rest[3] as number);
					for (let step = 1; step <= CURVE_STEPS; step++) {
						const t = step / CURVE_STEPS;
						const p = cubicAt(cursor, c1, c2, end, t);
						push(p.x, p.y);
					}
					cursor = end;
					lastControl = c2;
					break;
				}
				case "Q":
				case "T": {
					const shorthand = command.toUpperCase() === "T";
					const args = take(shorthand ? 2 : 4);
					const control = shorthand
						? reflect(lastControl, cursor)
						: at(args[0] as number, args[1] as number);
					const tail = shorthand ? args : args.slice(2);
					const end = at(tail[0] as number, tail[1] as number);
					for (let step = 1; step <= CURVE_STEPS; step++) {
						const t = step / CURVE_STEPS;
						const p = quadraticAt(cursor, control, end, t);
						push(p.x, p.y);
					}
					cursor = end;
					lastControl = control;
					break;
				}
				default:
					throw new Error(`Whiteboard path "${d}": unsupported command ${command}`);
			}
		}
	};

	TOKENS.lastIndex = 0;
	for (let match = TOKENS.exec(d); match; match = TOKENS.exec(d)) {
		if (match[1]) {
			flush();
			command = match[1];
			if (command.toUpperCase() === "Z") {
				// A closed subpath draws the closing edge, so the pen follows it.
				if (points.length) push(start.x, start.y);
				cursor = start;
				lastControl = null;
				command = "";
			}
			continue;
		}
		if (!command) throw new Error(`Whiteboard path "${d}": a number before any command`);
		numbers.push(Number(match[2]));
	}
	flush();

	if (!points.length) throw new Error(`Whiteboard path "${d}": drew nothing`);
	return { points, lengths, length: total };
}

function reflect(control: Point | null, cursor: Point): Point {
	// With no previous curve the reflection is the cursor itself, per the spec.
	if (!control) return cursor;
	return { x: cursor.x * 2 - control.x, y: cursor.y * 2 - control.y };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
}

function quadraticAt(p0: Point, p1: Point, p2: Point, t: number): Point {
	const u = 1 - t;
	return {
		x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
		y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
	};
}

/**
 * The point a given fraction along a sampled path. Used to pin the pen tip to
 * the leading edge of the ink, exactly as it is pinned to the end of a
 * half-written line of text.
 */
export function pointAt(path: SampledPath, progress: number): Point {
	const first = path.points[0] as Point;
	if (progress <= 0 || path.length <= 0) return first;
	const last = path.points[path.points.length - 1] as Point;
	if (progress >= 1) return last;

	const target = path.length * progress;
	// Binary search the cumulative lengths: a doodle stroke flattens to a few
	// hundred points and this runs once per rendered frame.
	let low = 0;
	let high = path.lengths.length - 1;
	while (low < high - 1) {
		const mid = (low + high) >> 1;
		if ((path.lengths[mid] as number) <= target) low = mid;
		else high = mid;
	}
	const from = path.points[low] as Point;
	const to = path.points[low + 1] as Point;
	const span = (path.lengths[low + 1] as number) - (path.lengths[low] as number);
	const t = span > 0 ? (target - (path.lengths[low] as number)) / span : 0;
	return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
