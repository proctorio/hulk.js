import minify__ from "../src/index.js";
import { stripJsComments__ } from "../src/JsComments.js";
import { trimLineEnds__ } from "../src/JsMinifier.js";
import { scanJs__ } from "../src/JsLexer.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// WI 47108. minifyJs__'s whitespace step was main's /\s+$/gum, kept by 47091 and by 47101 (which skips the matches
// that start in a protected span). That regex is quadratic on a run of whitespace that does not end a line:
// each start position inside the run scans to its end, fails the $, and the next position scans it again
// ("x;" + 32K spaces + "y();" took 1.2 s, 128K took about 19 s). src/JsMinifier.js now finds the same matches
// in one pass; this file holds the argument and the checks.
//
// What the regex matches. A run is a maximal sequence of \s code units [a, b). The regex tries each start inside
// it, leftmost first, takes the run greedily to b, and backtracks until $ holds. Under the m flag $ holds at the end
// of the string and before \n, \r, U+2028 and U+2029. So, per run:
// - b is the end of the string: the match is the whole run [a, b);
// - otherwise the character at b is not whitespace, so $ fails there, and the match ends before the last line
//   terminator k with a < k < b (a terminator at a itself cannot end a match that needs one character first):
//   it is [a, k), and no match when the run has none. No later start in the run finds a match the first one
//   missed, and the scan resumes at k, where the rest of the run (it starts with that terminator) has no terminator
//   after k. So a run gives at most one match, and a blank-line run keeps its last line break.
// The filter takes the match start, so it asks about a, the same offset the regex handed it.
//
// \s is the same set with or without the u flag: U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A,
// U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Not U+0085 or U+180E, and never a lone surrogate. The
// predicate is checked against the regex over all 65536 code units below. A bare /\s+/gu is no substitute: it
// overflows V8's regexp stack on Node 24.21.0 for an 8 MB run in a two-byte string (Node 26 does not).
//
// The oracle below is 47101's function, verbatim apart from the name. Run against src from before the change,
// the timing tests fail (the 128K run takes about 19 s of CPU); the differential tests pass on both.

const js = content => minify__(content, "js");

// keeps V8 from storing the large inputs one-byte
const TWO_BYTE__ = "→";

// a run that makes /\s+$/gum take about 19 s of CPU here, far past the bound
const RUN__ = 131072;

// CPU-time bound of every scaling test, as in the markup and JS tests
const CPU_MS__ = 3000;

// generous per-test limit: v8 coverage slows the large inputs down several times over
const SLOW_TEST_MS__ = 60000;

const MAIN_TRIM__ = /\s+$/gum;
const OPEN_SLOT__ = "${";

/**
 * @description Removes trailing whitespace with main's regex, except where a run starts in a protected span (47101's function).
 * @param {string} content - JS source.
 * @param {Array<number>} protectedSpans - Protected [start, end) pairs, flat and in order.
 * @return {string} The source without its unprotected trailing whitespace.
 */
function oracleTrim__(content, protectedSpans)
{
	let span = 0;

	return content.replaceAll(MAIN_TRIM__, (run, offset) =>
	{
		while (span < protectedSpans.length && protectedSpans[span + 1] <= offset)
		{
			span += 2;
		}

		return span < protectedSpans.length && protectedSpans[span] <= offset ? run : "";
	});
}

/**
 * @description Minifies JS the way minifyJs__ did before this item: the same steps with the regex in place.
 * @param {string} content - JS source.
 * @return {string} Minified JS.
 */
function oracleMinify__(content)
{
	const scan = scanJs__(content);
	const stripped = scan === null ? null : stripJsComments__(content, scan.commentStarts);
	const rescan = stripped === null ? null : scanJs__(stripped);
	const minified = rescan === null ? content.trim() : oracleTrim__(stripped, rescan.protectedSpans).trim();

	return minified.startsWith("#!") && !content.startsWith("#!") ? content : minified;
}

// the 25 code units \s matches
const SPACE_UNITS__ = [
	0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
	0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF
];

/**
 * @description Seeded 32-bit PRNG (mulberry32), so every run fuzzes the same inputs.
 * @param {number} seed - Seed.
 * @return {function(): number} Generator of floats in [0, 1).
 */
function prng__(seed)
{
	let state = seed >>> 0;

	return () =>
	{
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("trimLineEnds__ finds the matches of /\\s+$/gum", () =>
{
	it("treats exactly the 25 \\s code units as whitespace, as the regex does, over all 65536 code units", () =>
	{
		const spaces = [];
		const differences = [];

		for (let code = 0; code < 0x10000; code++)
		{
			const unit = String.fromCharCode(code);

			if (trimLineEnds__(`a${unit}`, []) === "a") spaces.push(code);

			// at the end of the string, before a line end, mid-line, after a line end
			for (const input of [`a${unit}`, `a${unit}\nb`, `a${unit}b`, `a\n${unit}b`, `a${unit}${unit}\r\nb`])
			{
				if (trimLineEnds__(input, []) !== oracleTrim__(input, [])) differences.push(code.toString(16));
			}
		}

		expect(spaces).toEqual(SPACE_UNITS__);
		expect(differences).toEqual([]);
	});

	// expected outputs written by hand from the rules in the header, not taken from either implementation
	it.each([
		["a  ", [], "a"],
		["a  \nb", [], "a\nb"],
		["a \t b", [], "a \t b"],
		["a \r\n b", [], "a\n b"],
		["a \n\n\n", [], "a"],
		["a \n\n\nb", [], "a\nb"],
		["a \u2028 b", [], "a\u2028 b"],
		["a \u2029\u2029 b", [], "a\u2029 b"],
		["a\n  b", [], "a\n  b"],
		["a\u0085 \nb", [], "a\u0085\nb"],
		["a\u180E", [], "a\u180E"],
		["a\uD800 b", [], "a\uD800 b"],
		["a\uFEFF\n\uFEFFb", [], "a\n\uFEFFb"],
		["\n\n", [], ""],
		["", [], ""],
		["a ", [0, 2], "a "],
		["a \nb", [1, 3], "a \nb"],
		["a \nb", [0, 1], "a\nb"],
		["a \nb", [2, 3], "a\nb"],
		["a  \n  b  \nc", [7, 8], "a\n  b  \nc"],
		["a  \n  b  \nc", [1, 2, 7, 8], "a  \n  b  \nc"],
		["x  \ny  \nz  ", [5, 6], "x\ny  \nz"]
	])("trims %j with spans %j to %j", (input, spans, expected) =>
	{
		expect(trimLineEnds__(input, spans)).toBe(expected);
		expect(oracleTrim__(input, spans)).toBe(expected);
	});

	it("matches the regex on 40000 seeded inputs with random protected spans", () =>
	{
		const random = prng__(47108);
		const pick = list => list[Math.floor(random() * list.length)];
		const alphabet = [
			...SPACE_UNITS__.map(code => String.fromCharCode(code)), " ", " ", " ", "\n", "\n", "\r", "\r\n", "\t", "\u0085", "\u180E", "\u200B",
			"x", "y", "a", ";", TWO_BYTE__, "😀", "\uD800", "\uDC00"
		];
		const seen = new Set();
		let withSpans = 0;
		let changed = 0;
		let heldBySpan = 0;
		let failure = null;

		for (let run = 0; run < 40000 && failure === null; run++)
		{
			let input = "";
			const length = 1 + Math.floor(random() * 40);

			for (let index = 0; index < length; index++)
			{
				input += pick(alphabet);
			}

			const spans = [];

			if (random() < 0.6)
			{
				let at = 0;

				while (at < input.length && spans.length < 8)
				{
					const start = at + Math.floor(random() * 6);
					const end = Math.min(start + 1 + Math.floor(random() * 8), input.length + 1);

					if (start >= input.length) break;

					spans.push(start, end);
					at = end;
				}
			}

			seen.add(`${input}|${spans.join(",")}`);
			withSpans += spans.length === 0 ? 0 : 1;

			const expected = oracleTrim__(input, spans);

			changed += expected === input ? 0 : 1;
			heldBySpan += spans.length > 0 && expected !== oracleTrim__(input, []) ? 1 : 0;

			const actual = trimLineEnds__(input, spans);

			if (actual !== expected) failure = `${JSON.stringify(input)} ${JSON.stringify(spans)}: ${difference__(actual, expected)}`;
		}

		expect(failure).toBeNull();

		// premises: the generator does not cycle, the regex rewrote most inputs, and spans really held matches back
		expect(seen.size).toBeGreaterThan(36000);
		expect(withSpans).toBeGreaterThan(20000);
		expect(changed).toBeGreaterThan(20000);
		expect(heldBySpan).toBeGreaterThan(2000);
	}, SLOW_TEST_MS__);
});

describe("minifyJs__ gives the output it gave with the regex", () =>
{
	it.each([
		["x = 1;  \ny = 2;\t\n", "x = 1;\ny = 2;"],
		["x = 1;   y = 2;", "x = 1;   y = 2;"],
		["x = 1;\r\n\r\n\r\ny = 2;  \r\n", "x = 1;\ny = 2;"],
		["x = `a  \nb  \n`;  \n", "x = `a  \nb  \n`;"],
		[`x = \`a${OPEN_SLOT__}1  }  \nb\`;`, `x = \`a${OPEN_SLOT__}1  }  \nb\`;`],
		["x = '\\  \n  b';  \n", "x = '\\  \n  b';"],
		["x = /a  /;  \ny();", "x = /a  /;\ny();"],
		["x = 1;\u2028\u2028y = 2;\u00A0", "x = 1;\u2028y = 2;"],
		["\uFEFF\n\nx = 1;", "x = 1;"],
		["x = 1;\n  y = 2;  ", "x = 1;\n  y = 2;"]
	])("minifies %j to %j", (input, expected) =>
	{
		expect(js(input)).toBe(expected);
		expect(oracleMinify__(input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input)).toBe(expected);
	});

	it("matches the old pipeline on 20000 seeded inputs built from tokens at the scan's boundaries", () =>
	{
		const random = prng__(471080);
		const pick = list => list[Math.floor(random() * list.length)];
		const statements = [
			"x = 1;", "f(a);", "y = 'a  b';", "z = `t  \n  u`;", "w = /a /;", "/* c */", "// c", "if (a) { b(); }", "return;", `x = \`${OPEN_SLOT__}a  }  \`;`
		];
		const spacing = [" ", "  ", "   ", "\t", "\n", "\n\n", "\r\n", " \n", "  \n  ", "\u00A0", "\u2028", "\u3000", "\uFEFF", ""];
		const tokens = [
			"x", "a", "1", ";", "(", ")", "{", "}", "[", "]", ",", "=", "+", "/", "*", "\\", "\\\n", "'", "\"", "`", "${", "/*", "*/", "//",
			"/a/", "if (a) ", "return ", "#!", " ", "  ", "   ", "\t", "\n", "\n\n", "\r\n", "\r", "\u2028", "\u2029", "\u00A0", "\u3000", "\uFEFF",
			TWO_BYTE__, "😀", "\uD800", " \n", "  \n  ", "-->", "<!--"
		];
		const seen = new Set();
		let scanned = 0;
		let trimmed = 0;
		let failure = null;

		for (let run = 0; run < 20000 && failure === null; run++)
		{
			let input = "";
			const soup = run % 2 === 0;
			const length = 1 + Math.floor(random() * 30);

			for (let index = 0; index < length; index++)
			{
				input += soup ? pick(tokens) : `${pick(statements)}${pick(spacing)}`;
			}

			seen.add(input);

			const first = scanJs__(input);
			const second = first === null ? null : scanJs__(stripJsComments__(input, first.commentStarts));
			const stripped = first === null ? null : stripJsComments__(input, first.commentStarts);
			const expected = oracleMinify__(input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input);

			scanned += second === null ? 0 : 1;
			trimmed += second !== null && oracleTrim__(stripped, second.protectedSpans) !== stripped ? 1 : 0;

			const actual = js(input);

			if (actual !== expected) failure = `${JSON.stringify(input)}: ${difference__(actual, expected)}`;
		}

		expect(failure).toBeNull();

		// premises: no cycling, the scan accepted a share of the inputs (else the trim never ran), and the whitespace step itself changed some
		expect(seen.size).toBeGreaterThan(19000);
		expect(scanned).toBeGreaterThan(4000);
		expect(trimmed).toBeGreaterThan(1500);
	}, SLOW_TEST_MS__);
});

describe("the whitespace step runs in linear time", () =>
{
	/**
	 * @description Minifies JS under the CPU bound and checks the output exactly.
	 * @param {string} input - JS with a character above U+00FF.
	 * @param {string} expected - Expected output.
	 */
	function expectLinear(input, expected)
	{
		expect(input).toContain(TWO_BYTE__);

		let output = "";
		expect(cpuMs__(() =>
		{
			output = js(input);
		})).toBeLessThan(CPU_MS__);
		expect(difference__(output, expected)).toBeNull();
	}

	it("minify JS keeps a long run of spaces that does not end a line (1.2 s at 32K, 19 s at 128K on main)", () =>
	{
		const input = `x = '${TWO_BYTE__}';${" ".repeat(RUN__)}y();`;

		expectLinear(input, input);
	}, SLOW_TEST_MS__);

	it("minify JS keeps a long mixed run, and one of non-breaking and ideographic spaces", () =>
	{
		const mixed = `x = '${TWO_BYTE__}';${" \t\u00A0\u3000\uFEFF".repeat(RUN__ / 5)}y();`;
		const wide = `x = '${TWO_BYTE__}';${"\u00A0\u3000".repeat(RUN__ / 2)}y();`;

		expectLinear(mixed, mixed);
		expectLinear(wide, wide);
	}, SLOW_TEST_MS__);

	it("minify JS trims the part of a long run before its last line break, and keeps the indent after it", () =>
	{
		const spaces = " ".repeat(RUN__);

		expectLinear(`x = '${TWO_BYTE__}';${spaces}\n${spaces}y();`, `x = '${TWO_BYTE__}';\n${spaces}y();`);
		expectLinear(`x = '${TWO_BYTE__}';${spaces}\u2028${spaces}y();`, `x = '${TWO_BYTE__}';\u2028${spaces}y();`);
		expectLinear(`x = '${TWO_BYTE__}';${spaces}\u2028${spaces}\r\n${spaces}y();`, `x = '${TWO_BYTE__}';\n${spaces}y();`);
	}, SLOW_TEST_MS__);

	it("minify JS drops a long run at the end of the file, and a long run of blank lines", () =>
	{
		expectLinear(`x = '${TWO_BYTE__}';${" ".repeat(RUN__)}`, `x = '${TWO_BYTE__}';`);
		expectLinear(`x = '${TWO_BYTE__}';${" \n".repeat(RUN__ / 2)}y();`, `x = '${TWO_BYTE__}';\ny();`);
	}, SLOW_TEST_MS__);

	it("minify JS keeps a long run inside a template, after the line break that starts in a protected span", () =>
	{
		const spaces = " ".repeat(RUN__);
		const template = `x = \`${TWO_BYTE__}${spaces}\n${spaces}\`;`;

		expectLinear(`${template}${spaces}\ny();`, `${template}\ny();`);
	}, SLOW_TEST_MS__);

	it("trimLineEnds__ takes 8 MB runs in a two-byte string (a bare /\\s+/gu overflows on Node 24.21.0)", () =>
	{
		const size = 8 << 20;
		const spaces = " ".repeat(size);
		const cases = [
			[`${TWO_BYTE__}a${spaces}b`, [], `${TWO_BYTE__}a${spaces}b`],
			[`${TWO_BYTE__}a${spaces}`, [], `${TWO_BYTE__}a`],
			[`${TWO_BYTE__}a${spaces}\nb`, [], `${TWO_BYTE__}a\nb`],
			[`${TWO_BYTE__}a${spaces}\nb`, [2, size + 4], `${TWO_BYTE__}a${spaces}\nb`],
			[`${TWO_BYTE__}${"a  \n".repeat(size / 4)}`, [], `${TWO_BYTE__}${"a\n".repeat((size / 4) - 1)}a`]
		];

		for (const [input, spans, expected] of cases)
		{
			let output = "";

			expect(cpuMs__(() =>
			{
				output = trimLineEnds__(input, spans);

				// a concatenation is a rope until something reads it: read it inside the timed call
				output.charCodeAt(0);
			})).toBeLessThan(CPU_MS__);
			expect(difference__(output, expected)).toBeNull();
		}
	}, SLOW_TEST_MS__);

	it("minify SVG takes a number with a long run of zeros in linear time (495 ms at 32K on main, fixed by 47101)", () =>
	{
		const input = `<svg><path d="M1.${"0".repeat(RUN__)}5 2"/>${TWO_BYTE__}</svg>`;
		let output = "";

		expect(cpuMs__(() =>
		{
			output = minify__(input, "svg");
		})).toBeLessThan(CPU_MS__);
		expect(output).toBe(minify__(`<svg><path d="M1.${"0".repeat(8)}5 2"/>${TWO_BYTE__}</svg>`, "svg").replace("0".repeat(8), "0".repeat(RUN__)));
	}, SLOW_TEST_MS__);
});
