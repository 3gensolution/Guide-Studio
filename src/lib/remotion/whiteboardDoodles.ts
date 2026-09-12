// ── Whiteboard doodle catalog ────────────────────────────────────────────
//
// The pictures a scribe video draws next to its copy: people, business
// imagery, objects, marker shapes, animals. Everything is line art authored on
// a 200×200 grid as plain path data, for the same reason the pen hand is inline
// SVG — a render happens in headless Chrome with no asset resolution and no
// network, and must produce the identical picture every time.
//
// Geometry is built by the helpers below rather than written out as bezier
// numbers. A circle spelled as four curves is unreadable and unrevisable; a
// call to `circle(100, 100, 40)` is neither. The helpers emit only the command
// subset `samplePath` understands, so every stroke can be flattened and the pen
// can ride along it.

export type DoodleCategory = "people" | "business" | "objects" | "shapes" | "animals";

export interface DoodleStroke {
	/** Path data on the 200×200 grid. */
	d: string;
	/** Drawn in the frame's accent colour instead of pen ink. */
	accent?: boolean;
	/** Line weight relative to the doodle's base stroke width. */
	weight?: number;
	/** Flood the closed path with a wash of the accent once it is drawn. */
	fill?: boolean;
}

export interface Doodle {
	id: string;
	/** Shown in the picker, and how the planner is told to think about it. */
	label: string;
	category: DoodleCategory;
	strokes: DoodleStroke[];
}

/** Every doodle is authored inside this square. */
export const DOODLE_GRID = 200;

// ── Geometry helpers ─────────────────────────────────────────────────────

const n = (value: number) => Math.round(value * 100) / 100;

/** Kappa: the bezier control offset that approximates a quarter circle. */
const K = 0.5522847498;

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
	const ox = rx * K;
	const oy = ry * K;
	return [
		`M ${n(cx - rx)} ${n(cy)}`,
		`C ${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}`,
		`C ${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)}`,
		`C ${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}`,
		`C ${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)}`,
		"Z",
	].join(" ");
}

export function circle(cx: number, cy: number, r: number): string {
	return ellipse(cx, cy, r, r);
}

export function roundRect(x: number, y: number, w: number, h: number, r = 0): string {
	const radius = Math.min(r, w / 2, h / 2);
	if (radius <= 0) {
		return `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`;
	}
	return [
		`M ${n(x + radius)} ${n(y)}`,
		`L ${n(x + w - radius)} ${n(y)}`,
		`Q ${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + radius)}`,
		`L ${n(x + w)} ${n(y + h - radius)}`,
		`Q ${n(x + w)} ${n(y + h)} ${n(x + w - radius)} ${n(y + h)}`,
		`L ${n(x + radius)} ${n(y + h)}`,
		`Q ${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - radius)}`,
		`L ${n(x)} ${n(y + radius)}`,
		`Q ${n(x)} ${n(y)} ${n(x + radius)} ${n(y)}`,
		"Z",
	].join(" ");
}

export function poly(points: Array<[number, number]>, close = false): string {
	const [head, ...tail] = points;
	if (!head) throw new Error("poly() needs at least one point");
	const body = tail.map(([x, y]) => `L ${n(x)} ${n(y)}`).join(" ");
	return `M ${n(head[0])} ${n(head[1])} ${body}${close ? " Z" : ""}`.trim();
}

/**
 * An arc from one point to another, bowed sideways by `bulge` pixels. Positive
 * bulges bow to the left of the direction of travel. Most organic lines in the
 * catalog — smiles, whiskers, sound waves — are one of these.
 */
export function bow(x1: number, y1: number, x2: number, y2: number, bulge: number): string {
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.hypot(dx, dy) || 1;
	// The control point is pushed twice the bulge out, because a quadratic only
	// reaches halfway to its control.
	const cx = mx + (dy / len) * bulge * 2;
	const cy = my - (dx / len) * bulge * 2;
	return `M ${n(x1)} ${n(y1)} Q ${n(cx)} ${n(cy)} ${n(x2)} ${n(y2)}`;
}

/** An arrowhead at (x, y), opening back along `angle` degrees. */
export function arrowHead(x: number, y: number, angle: number, size = 22): string {
	const rad = (angle * Math.PI) / 180;
	const spread = (26 * Math.PI) / 180;
	const left: [number, number] = [
		x - Math.cos(rad - spread) * size,
		y - Math.sin(rad - spread) * size,
	];
	const right: [number, number] = [
		x - Math.cos(rad + spread) * size,
		y - Math.sin(rad + spread) * size,
	];
	return poly([left, [x, y], right]);
}

/** A regular star, first point straight up. */
export function star(cx: number, cy: number, outer: number, inner: number, points = 5): string {
	const coords: Array<[number, number]> = [];
	for (let index = 0; index < points * 2; index++) {
		const r = index % 2 === 0 ? outer : inner;
		const angle = (Math.PI * index) / points - Math.PI / 2;
		coords.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
	}
	return poly(coords, true);
}

/** The toothed rim of a gear, as one closed path. */
function gearRim(cx: number, cy: number, root: number, tip: number, teeth: number): string {
	const coords: Array<[number, number]> = [];
	const step = (Math.PI * 2) / teeth;
	for (let index = 0; index < teeth; index++) {
		const base = index * step;
		const flank = step * 0.22;
		const crest = step * 0.14;
		coords.push([cx + Math.cos(base - flank) * root, cy + Math.sin(base - flank) * root]);
		coords.push([cx + Math.cos(base - crest) * tip, cy + Math.sin(base - crest) * tip]);
		coords.push([cx + Math.cos(base + crest) * tip, cy + Math.sin(base + crest) * tip]);
		coords.push([cx + Math.cos(base + flank) * root, cy + Math.sin(base + flank) * root]);
	}
	return poly(coords, true);
}

/** A stick figure: head, spine, arms, legs — the staple of every scribe video. */
function stickFigure(
	cx: number,
	headY: number,
	scale: number,
	arms: [number, number],
): DoodleStroke[] {
	const s = (value: number) => value * scale;
	const shoulder = headY + s(38);
	const hip = headY + s(84);
	return [
		{ d: circle(cx, headY, s(22)) },
		{
			d: poly([
				[cx, headY + s(22)],
				[cx, hip],
			]),
		},
		{
			d: poly([
				[cx - s(38), arms[0]],
				[cx, shoulder],
				[cx + s(38), arms[1]],
			]),
		},
		{
			d: poly([
				[cx - s(30), hip + s(50)],
				[cx, hip],
				[cx + s(30), hip + s(50)],
			]),
		},
	];
}

// ── The catalog ──────────────────────────────────────────────────────────

export const DOODLES: Doodle[] = [
	// People ───────────────────────────────────────────────────────────────
	{
		id: "person",
		label: "a single person, standing",
		category: "people",
		strokes: stickFigure(100, 46, 1, [102, 102]),
	},
	{
		id: "team",
		label: "a group of three people",
		category: "people",
		strokes: [
			{ d: circle(48, 82, 20) },
			{ d: bow(18, 156, 78, 156, 40) },
			{ d: circle(152, 82, 20) },
			{ d: bow(122, 156, 182, 156, 40) },
			{ d: circle(100, 62, 24) },
			{ d: bow(62, 156, 138, 156, 48) },
		],
	},
	{
		id: "presenter",
		label: "a person presenting at a board",
		category: "people",
		strokes: [
			{ d: roundRect(16, 28, 116, 88, 6) },
			{
				d: poly([
					[32, 96],
					[62, 70],
					[84, 84],
					[114, 50],
				]),
				accent: true,
			},
			{ d: arrowHead(114, 50, -48, 18), accent: true },
			{ d: circle(164, 62, 16) },
			{
				d: poly([
					[164, 78],
					[164, 126],
				]),
			},
			{
				d: poly([
					[164, 92],
					[134, 78],
				]),
			},
			{
				d: poly([
					[150, 168],
					[164, 126],
					[178, 168],
				]),
			},
		],
	},
	{
		id: "handshake",
		label: "two people shaking hands on a deal",
		category: "people",
		strokes: [
			{ d: circle(40, 52, 18) },
			{
				d: poly([
					[40, 70],
					[40, 124],
				]),
			},
			{
				d: poly([
					[40, 86],
					[18, 112],
				]),
			},
			{
				d: poly([
					[24, 168],
					[40, 124],
					[54, 168],
				]),
			},
			{ d: circle(160, 52, 18) },
			{
				d: poly([
					[160, 70],
					[160, 124],
				]),
			},
			{
				d: poly([
					[160, 86],
					[182, 112],
				]),
			},
			{
				d: poly([
					[146, 168],
					[160, 124],
					[176, 168],
				]),
			},
			{
				d: poly([
					[40, 86],
					[100, 108],
					[160, 86],
				]),
			},
			{ d: circle(100, 108, 11), accent: true },
		],
	},
	{
		id: "idea",
		label: "a person having an idea",
		category: "people",
		strokes: [
			{ d: circle(84, 126, 42) },
			{ d: circle(72, 118, 4) },
			{ d: circle(96, 118, 4) },
			{ d: bow(68, 142, 100, 142, -10) },
			{ d: circle(150, 54, 24), accent: true },
			{
				d: poly([
					[138, 76],
					[162, 76],
				]),
				accent: true,
			},
			{
				d: poly([
					[141, 86],
					[159, 86],
				]),
				accent: true,
			},
			{
				d: poly([
					[150, 16],
					[150, 4],
				]),
				accent: true,
			},
			{
				d: poly([
					[184, 30],
					[193, 22],
				]),
				accent: true,
			},
			{
				d: poly([
					[116, 30],
					[107, 22],
				]),
				accent: true,
			},
		],
	},
	{
		id: "audience",
		label: "an audience of people watching",
		category: "people",
		strokes: [
			{ d: circle(42, 92, 16) },
			{ d: bow(16, 152, 68, 152, 34) },
			{ d: circle(100, 84, 18) },
			{ d: bow(70, 152, 130, 152, 38) },
			{ d: circle(158, 92, 16) },
			{ d: bow(132, 152, 184, 152, 34) },
			{
				d: poly([
					[12, 172],
					[188, 172],
				]),
				accent: true,
			},
		],
	},

	// Business ─────────────────────────────────────────────────────────────
	{
		id: "growth",
		label: "a bar chart growing, with a rising trend line",
		category: "business",
		strokes: [
			{
				d: poly([
					[34, 26],
					[34, 162],
					[176, 162],
				]),
			},
			{ d: roundRect(52, 116, 26, 46, 3) },
			{ d: roundRect(92, 92, 26, 70, 3) },
			{ d: roundRect(132, 62, 26, 100, 3) },
			{
				d: poly([
					[52, 104],
					[100, 80],
					[140, 52],
					[166, 36],
				]),
				accent: true,
			},
			{ d: arrowHead(166, 36, -32, 20), accent: true },
		],
	},
	{
		id: "lineChart",
		label: "a line chart trending upward",
		category: "business",
		strokes: [
			{
				d: poly([
					[34, 26],
					[34, 162],
					[176, 162],
				]),
			},
			{
				d: poly([
					[50, 132],
					[82, 96],
					[112, 114],
					[154, 52],
				]),
				accent: true,
			},
			{ d: arrowHead(154, 52, -56, 20), accent: true },
			{ d: circle(82, 96, 5) },
			{ d: circle(112, 114, 5) },
		],
	},
	{
		id: "pieChart",
		label: "a pie chart split into shares",
		category: "business",
		strokes: [
			{ d: circle(100, 100, 66) },
			{
				d: poly([
					[100, 100],
					[100, 34],
				]),
			},
			{
				d: poly([
					[100, 100],
					[158, 132],
				]),
			},
			{
				d: poly([
					[100, 100],
					[40, 126],
				]),
				accent: true,
			},
		],
	},
	{
		id: "briefcase",
		label: "a briefcase, for business or work",
		category: "business",
		strokes: [
			{ d: roundRect(28, 62, 144, 100, 10) },
			{
				d: "M 78 62 L 78 46 Q 78 38 86 38 L 114 38 Q 122 38 122 46 L 122 62",
			},
			{
				d: poly([
					[28, 106],
					[86, 106],
				]),
			},
			{
				d: poly([
					[114, 106],
					[172, 106],
				]),
			},
			{ d: roundRect(86, 96, 28, 20, 4), accent: true },
		],
	},
	{
		id: "target",
		label: "a target with an arrow in the bullseye",
		category: "business",
		strokes: [
			{ d: circle(96, 104, 64) },
			{ d: circle(96, 104, 40) },
			{ d: circle(96, 104, 16), accent: true },
			{
				d: poly([
					[178, 24],
					[104, 96],
				]),
				accent: true,
			},
			{ d: arrowHead(104, 96, 136, 20), accent: true },
			{
				d: poly([
					[178, 24],
					[156, 28],
					[174, 46],
				]),
			},
		],
	},
	{
		id: "money",
		label: "a stack of coins, for money or revenue",
		category: "business",
		strokes: [
			{ d: ellipse(92, 152, 52, 15) },
			{
				d: poly([
					[40, 152],
					[40, 128],
				]),
			},
			{
				d: poly([
					[144, 152],
					[144, 128],
				]),
			},
			{ d: ellipse(92, 128, 52, 15) },
			{
				d: poly([
					[40, 128],
					[40, 104],
				]),
			},
			{
				d: poly([
					[144, 128],
					[144, 104],
				]),
			},
			{ d: ellipse(92, 104, 52, 15) },
			{ d: circle(148, 54, 34), accent: true },
			{
				d: poly([
					[148, 30],
					[148, 78],
				]),
				accent: true,
			},
			{
				d: "M 162 42 C 150 34 136 38 136 46 C 136 56 160 54 160 64 C 160 72 146 76 134 68",
				accent: true,
			},
		],
	},
	{
		id: "rocket",
		label: "a rocket launching, for a launch or fast growth",
		category: "business",
		strokes: [
			{
				d: "M 100 16 C 128 48 140 94 136 132 L 64 132 C 60 94 72 48 100 16 Z",
			},
			{ d: circle(100, 70, 16), accent: true },
			{
				d: poly([
					[64, 98],
					[36, 142],
					[64, 132],
				]),
			},
			{
				d: poly([
					[136, 98],
					[164, 142],
					[136, 132],
				]),
			},
			{
				d: poly([
					[80, 136],
					[88, 172],
				]),
				accent: true,
			},
			{
				d: poly([
					[100, 138],
					[100, 186],
				]),
				accent: true,
			},
			{
				d: poly([
					[120, 136],
					[112, 172],
				]),
				accent: true,
			},
		],
	},
	{
		id: "trophy",
		label: "a trophy, for winning or a milestone",
		category: "business",
		strokes: [
			{
				d: "M 60 38 L 140 38 L 134 94 C 132 116 118 130 100 130 C 82 130 68 116 66 94 Z",
			},
			{ d: "M 60 50 C 36 50 32 84 62 88" },
			{ d: "M 140 50 C 164 50 168 84 138 88" },
			{
				d: poly([
					[100, 130],
					[100, 152],
				]),
			},
			{ d: roundRect(66, 152, 68, 18, 4) },
			{ d: star(100, 74, 22, 9), accent: true },
		],
	},
	{
		id: "office",
		label: "office buildings, for a company or workplace",
		category: "business",
		strokes: [
			{
				d: poly([
					[36, 168],
					[36, 48],
					[118, 48],
					[118, 168],
				]),
			},
			{
				d: poly([
					[118, 168],
					[118, 86],
					[168, 86],
					[168, 168],
				]),
			},
			{
				d: poly([
					[18, 168],
					[184, 168],
				]),
				accent: true,
			},
			{ d: roundRect(52, 66, 18, 18, 2) },
			{ d: roundRect(86, 66, 18, 18, 2) },
			{ d: roundRect(52, 104, 18, 18, 2) },
			{ d: roundRect(86, 104, 18, 18, 2) },
			{ d: roundRect(132, 104, 18, 18, 2) },
			{ d: roundRect(70, 140, 24, 28, 2), accent: true },
		],
	},
	{
		id: "checklist",
		label: "a checklist on a clipboard, for steps or tasks",
		category: "business",
		strokes: [
			{ d: roundRect(40, 30, 120, 148, 8) },
			{ d: roundRect(82, 20, 36, 22, 5) },
			{
				d: poly([
					[56, 76],
					[66, 86],
					[82, 62],
				]),
				accent: true,
			},
			{
				d: poly([
					[92, 80],
					[142, 80],
				]),
			},
			{
				d: poly([
					[56, 116],
					[66, 126],
					[82, 102],
				]),
				accent: true,
			},
			{
				d: poly([
					[92, 120],
					[142, 120],
				]),
			},
			{
				d: poly([
					[92, 158],
					[142, 158],
				]),
			},
			{ d: roundRect(56, 148, 20, 20, 3) },
		],
	},
	{
		id: "calendar",
		label: "a calendar, for dates, planning or a deadline",
		category: "business",
		strokes: [
			{ d: roundRect(26, 42, 148, 132, 8) },
			{
				d: poly([
					[26, 80],
					[174, 80],
				]),
			},
			{
				d: poly([
					[64, 30],
					[64, 56],
				]),
			},
			{
				d: poly([
					[136, 30],
					[136, 56],
				]),
			},
			{ d: circle(62, 106, 7) },
			{ d: circle(100, 106, 7) },
			{ d: circle(138, 106, 7) },
			{ d: circle(62, 142, 7) },
			{ d: circle(100, 142, 7), accent: true },
			{ d: circle(138, 142, 7) },
		],
	},
	{
		id: "cart",
		label: "a shopping cart, for buying or e-commerce",
		category: "business",
		strokes: [
			{
				d: poly([
					[26, 40],
					[50, 40],
					[74, 124],
					[150, 124],
					[168, 66],
					[62, 66],
				]),
			},
			{ d: circle(84, 148, 14) },
			{ d: circle(144, 148, 14) },
			{
				d: poly([
					[112, 80],
					[112, 110],
				]),
				accent: true,
			},
			{
				d: poly([
					[97, 95],
					[127, 95],
				]),
				accent: true,
			},
		],
	},
	{
		id: "megaphone",
		label: "a megaphone, for marketing or an announcement",
		category: "business",
		strokes: [
			{
				d: poly(
					[
						[42, 84],
						[126, 44],
						[126, 138],
						[42, 116],
					],
					true,
				),
			},
			{
				d: poly([
					[60, 120],
					[52, 158],
				]),
			},
			{ d: bow(142, 70, 142, 112, -12), accent: true },
			{ d: bow(162, 54, 162, 128, -20), accent: true },
			{ d: bow(182, 40, 182, 142, -28), accent: true },
		],
	},

	// Objects ──────────────────────────────────────────────────────────────
	{
		id: "lightbulb",
		label: "a lightbulb, for an idea or insight",
		category: "objects",
		strokes: [
			{ d: circle(100, 84, 44) },
			{
				d: "M 78 122 L 78 144 C 78 154 86 160 100 160 C 114 160 122 154 122 144 L 122 122",
			},
			{
				d: poly([
					[86, 92],
					[94, 76],
					[102, 92],
					[110, 76],
				]),
				accent: true,
			},
			{
				d: poly([
					[100, 22],
					[100, 6],
				]),
				accent: true,
			},
			{
				d: poly([
					[152, 40],
					[163, 30],
				]),
				accent: true,
			},
			{
				d: poly([
					[48, 40],
					[37, 30],
				]),
				accent: true,
			},
			{
				d: poly([
					[86, 148],
					[114, 148],
				]),
			},
		],
	},
	{
		id: "gear",
		label: "a gear, for settings, process or automation",
		category: "objects",
		strokes: [{ d: gearRim(100, 100, 58, 78, 8) }, { d: circle(100, 100, 26), accent: true }],
	},
	{
		id: "search",
		label: "a magnifying glass, for search, research or review",
		category: "objects",
		strokes: [
			{ d: circle(86, 82, 48) },
			{
				d: poly([
					[120, 116],
					[166, 164],
				]),
				weight: 1.6,
			},
			{ d: bow(58, 68, 76, 50, 6), accent: true },
		],
	},
	{
		id: "shield",
		label: "a shield with a tick, for security, trust or safety",
		category: "objects",
		strokes: [
			{
				d: "M 100 20 L 166 48 C 166 118 138 158 100 180 C 62 158 34 118 34 48 Z",
			},
			{
				d: poly([
					[72, 96],
					[93, 118],
					[130, 72],
				]),
				accent: true,
			},
		],
	},
	{
		id: "cloud",
		label: "a cloud, for the cloud, hosting or the internet",
		category: "objects",
		strokes: [
			{
				d: "M 58 144 C 32 144 22 124 32 108 C 40 96 54 92 64 96 C 66 64 96 48 120 62 C 134 70 142 86 140 98 C 164 94 180 114 170 132 C 164 142 152 144 144 144 Z",
			},
		],
	},
	{
		id: "laptop",
		label: "a laptop, for software, a demo or working",
		category: "objects",
		strokes: [
			{ d: roundRect(38, 40, 124, 84, 6) },
			{
				d: poly(
					[
						[22, 140],
						[178, 140],
						[166, 124],
						[34, 124],
					],
					true,
				),
			},
			{
				d: poly([
					[86, 134],
					[114, 134],
				]),
			},
			{
				d: poly([
					[56, 66],
					[110, 66],
				]),
				accent: true,
			},
			{
				d: poly([
					[56, 88],
					[92, 88],
				]),
				accent: true,
			},
		],
	},
	{
		id: "phone",
		label: "a phone, for mobile or an app",
		category: "objects",
		strokes: [
			{ d: roundRect(62, 18, 76, 164, 14) },
			{ d: roundRect(74, 46, 52, 108, 4) },
			{
				d: poly([
					[88, 32],
					[112, 32],
				]),
			},
			{ d: circle(100, 168, 7) },
			{
				d: poly([
					[86, 74],
					[114, 74],
				]),
				accent: true,
			},
			{
				d: poly([
					[86, 98],
					[114, 98],
				]),
				accent: true,
			},
		],
	},
	{
		id: "mail",
		label: "an envelope, for email or a message",
		category: "objects",
		strokes: [
			{ d: roundRect(24, 54, 152, 98, 6) },
			{
				d: poly([
					[24, 60],
					[100, 114],
					[176, 60],
				]),
				accent: true,
			},
		],
	},
	{
		id: "clock",
		label: "a clock, for time, speed or a schedule",
		category: "objects",
		strokes: [
			{ d: circle(100, 102, 68) },
			{
				d: poly([
					[100, 102],
					[100, 58],
				]),
				accent: true,
			},
			{
				d: poly([
					[100, 102],
					[134, 120],
				]),
				accent: true,
			},
			{
				d: poly([
					[100, 34],
					[100, 44],
				]),
			},
			{
				d: poly([
					[168, 102],
					[158, 102],
				]),
			},
			{
				d: poly([
					[100, 170],
					[100, 160],
				]),
			},
			{
				d: poly([
					[32, 102],
					[42, 102],
				]),
			},
		],
	},
	{
		id: "globe",
		label: "a globe, for the world, languages or going global",
		category: "objects",
		strokes: [
			{ d: circle(100, 100, 68) },
			{ d: ellipse(100, 100, 28, 68) },
			{
				d: poly([
					[32, 100],
					[168, 100],
				]),
			},
			{ d: bow(44, 64, 156, 64, -14) },
			{ d: bow(44, 136, 156, 136, 14) },
		],
	},
	{
		id: "book",
		label: "an open book, for learning, docs or a guide",
		category: "objects",
		strokes: [
			{
				d: "M 100 52 C 78 36 46 34 26 42 L 26 152 C 46 144 78 146 100 162 C 122 146 154 144 174 152 L 174 42 C 154 34 122 36 100 52 Z",
			},
			{
				d: poly([
					[100, 52],
					[100, 162],
				]),
			},
			{ d: bow(44, 74, 84, 78, -4), accent: true },
			{ d: bow(44, 100, 84, 104, -4), accent: true },
			{ d: bow(116, 78, 156, 74, 4), accent: true },
			{ d: bow(116, 104, 156, 100, 4), accent: true },
		],
	},

	// Shapes ───────────────────────────────────────────────────────────────
	{
		id: "arrowRight",
		label: "an arrow pointing right, for a next step or a result",
		category: "shapes",
		strokes: [
			{
				d: poly([
					[24, 100],
					[158, 100],
				]),
				weight: 1.4,
			},
			{ d: arrowHead(164, 100, 0, 34), weight: 1.4 },
		],
	},
	{
		id: "arrowUp",
		label: "an arrow pointing up, for growth or improvement",
		category: "shapes",
		strokes: [
			{
				d: poly([
					[100, 176],
					[100, 44],
				]),
				weight: 1.4,
			},
			{ d: arrowHead(100, 38, -90, 34), weight: 1.4 },
		],
	},
	{
		id: "tick",
		label: "a big tick, for done, correct or approved",
		category: "shapes",
		strokes: [
			{
				d: poly([
					[34, 108],
					[82, 156],
					[166, 46],
				]),
				accent: true,
				weight: 1.8,
			},
		],
	},
	{
		id: "cross",
		label: "a big cross, for wrong, a problem or a thing to avoid",
		category: "shapes",
		strokes: [
			{
				d: poly([
					[52, 52],
					[148, 148],
				]),
				weight: 1.8,
			},
			{
				d: poly([
					[148, 52],
					[52, 148],
				]),
				weight: 1.8,
			},
		],
	},
	{
		id: "star",
		label: "a star, for a favourite, quality or a highlight",
		category: "shapes",
		strokes: [{ d: star(100, 100, 82, 34), accent: true, fill: true }],
	},
	{
		id: "heart",
		label: "a heart, for something people love",
		category: "shapes",
		strokes: [
			{
				d: "M 100 170 C 40 128 26 92 40 66 C 54 40 88 42 100 72 C 112 42 146 40 160 66 C 174 92 160 128 100 170 Z",
				accent: true,
				fill: true,
			},
		],
	},
	{
		id: "speechBubble",
		label: "a speech bubble, for a quote, feedback or a conversation",
		category: "shapes",
		strokes: [
			{ d: roundRect(24, 32, 152, 98, 16) },
			{
				d: poly([
					[66, 130],
					[58, 168],
					[100, 130],
				]),
			},
			{
				d: poly([
					[52, 66],
					[148, 66],
				]),
				accent: true,
			},
			{
				d: poly([
					[52, 94],
					[116, 94],
				]),
				accent: true,
			},
		],
	},
	{
		id: "circleIt",
		label: "a hand-drawn circle around something, to call it out",
		category: "shapes",
		strokes: [
			{
				d: "M 152 42 C 96 18 24 46 26 96 C 28 150 108 180 158 154 C 192 136 194 72 148 48 L 132 42",
				accent: true,
				weight: 1.5,
			},
		],
	},
	{
		id: "underline",
		label: "a double underline swoosh, to stress the words above it",
		category: "shapes",
		strokes: [
			{ d: bow(20, 88, 180, 96, -14), accent: true, weight: 1.6 },
			{ d: bow(30, 118, 170, 124, -12), accent: true, weight: 1.2 },
		],
	},
	{
		id: "bolt",
		label: "a lightning bolt, for speed, energy or an instant result",
		category: "shapes",
		strokes: [
			{
				d: poly(
					[
						[112, 16],
						[58, 112],
						[94, 112],
						[84, 184],
						[142, 84],
						[104, 84],
					],
					true,
				),
				accent: true,
				fill: true,
			},
		],
	},
	{
		id: "question",
		label: "a question mark, for a problem or an open question",
		category: "shapes",
		strokes: [
			{ d: circle(100, 100, 78) },
			{
				d: "M 74 74 C 74 50 124 44 128 70 C 131 92 100 96 100 124",
				accent: true,
				weight: 1.4,
			},
			{ d: circle(100, 146, 7), accent: true },
		],
	},

	// Animals ──────────────────────────────────────────────────────────────
	{
		id: "cat",
		label: "a sitting cat",
		category: "animals",
		strokes: [
			{
				d: poly([
					[46, 52],
					[40, 16],
					[74, 38],
				]),
			},
			{
				d: poly([
					[110, 38],
					[142, 16],
					[136, 52],
				]),
			},
			{ d: circle(91, 68, 44) },
			{ d: circle(76, 62, 5) },
			{ d: circle(106, 62, 5) },
			{
				d: poly(
					[
						[85, 80],
						[97, 80],
						[91, 88],
					],
					true,
				),
			},
			{ d: "M 77 94 C 83 102 99 102 105 94" },
			{
				d: poly([
					[34, 68],
					[62, 74],
				]),
			},
			{
				d: poly([
					[34, 88],
					[62, 88],
				]),
			},
			{
				d: poly([
					[148, 68],
					[120, 74],
				]),
			},
			{
				d: poly([
					[148, 88],
					[120, 88],
				]),
			},
			{ d: "M 56 104 C 38 126 38 164 56 176 L 124 176 C 142 164 142 126 126 104" },
			{ d: "M 124 176 C 176 182 194 144 166 114", accent: true },
		],
	},
	{
		id: "dog",
		label: "a dog",
		category: "animals",
		strokes: [
			{ d: circle(100, 86, 46) },
			{ d: "M 58 60 C 30 58 24 108 44 122 C 58 130 66 110 64 96" },
			{ d: "M 142 60 C 170 58 176 108 156 122 C 142 130 134 110 136 96" },
			{ d: circle(84, 78, 5) },
			{ d: circle(116, 78, 5) },
			{ d: ellipse(100, 104, 13, 9) },
			{
				d: poly([
					[100, 113],
					[100, 124],
				]),
			},
			{ d: "M 100 124 C 92 134 80 130 78 120" },
			{ d: "M 100 124 C 108 134 120 130 122 120" },
			{ d: "M 62 130 C 52 150 54 172 66 178 L 134 178 C 146 172 148 150 138 130" },
			{ d: "M 138 156 C 166 152 174 128 164 112", accent: true },
		],
	},
	{
		id: "bird",
		label: "a bird",
		category: "animals",
		strokes: [
			{ d: ellipse(94, 112, 48, 36) },
			{ d: circle(146, 76, 22) },
			{
				d: poly(
					[
						[164, 70],
						[188, 78],
						[164, 88],
					],
					true,
				),
				accent: true,
			},
			{ d: circle(152, 70, 4) },
			{ d: "M 76 104 C 98 96 122 108 128 128" },
			{
				d: poly([
					[84, 146],
					[78, 176],
				]),
			},
			{
				d: poly([
					[112, 146],
					[118, 176],
				]),
			},
			{
				d: poly(
					[
						[58, 104],
						[14, 88],
						[22, 126],
					],
					true,
				),
				accent: true,
			},
		],
	},
];

const BY_ID = new Map(DOODLES.map((doodle) => [doodle.id, doodle]));

export const DOODLE_IDS = DOODLES.map((doodle) => doodle.id);

export function getDoodle(id: string | undefined): Doodle | undefined {
	return id ? BY_ID.get(id) : undefined;
}

export function isDoodleId(value: unknown): value is string {
	return typeof value === "string" && BY_ID.has(value);
}

/**
 * The catalog as the planner sees it: grouped by category so the model reads a
 * short menu rather than forty unrelated ids.
 */
export function describeDoodles(): string[] {
	const categories: DoodleCategory[] = ["people", "business", "objects", "shapes", "animals"];
	return categories.map((category) => {
		const entries = DOODLES.filter((doodle) => doodle.category === category)
			.map((doodle) => `${doodle.id} (${doodle.label})`)
			.join(", ");
		return `- ${category}: ${entries}`;
	});
}
