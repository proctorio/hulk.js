import minify__ from "../src/index.js";
import { stripJsComments__ } from "../src/JsComments.js";

// How stripJsComments__ (src/JsComments.js) works. The notes live here, not in the helper: src
// keeps only the JSDoc the lint requires, and the build strips even that from the published copy.
//
// It gives the same output as content.replaceAll(OLD_STRIP__, "$1") below, in linear time and
// without backtracking. In V8 as measured (Node 24 and 26), once the string holds a character
// above U+00FF (kept two-byte), that regex overflows the regexp stack on a comment of a few
// megabytes (an inline source map); the 8 MB tests below assert it before testing the scan.
//
// Semantics kept from the regex:
// - A match starts only at a line start: position 0, or after \n, \r, U+2028 or U+2029.
// - After the leading whitespace (\s, which may span lines), a block comment with a closing "*/"
//   is removed and its leading whitespace kept.
// - A line comment is removed with its leading whitespace (the regex's $1 is empty there).
// - An unclosed "/*" is not removed, and it does not hide what follows: comments that start
//   later lines are still matched (see "/*\n//x\n/*" below).
//
// Why the scan is exact and linear:
// - Whitespace is tested one code unit at a time with the engine's own /\s/u, so the whitespace
//   set is exactly the regex's.
// - Every line start before the first non-whitespace character reaches that same character, so
//   the scan resumes there, or past the removed comment, and finds the next line start from it.
// - Once one search finds no "*/", none after it can (later searches start further right), so
//   closerLeft stops the searches: without it, each unclosed "/*" line rescans to the end.
// - Line ends are found with a one-character class, which has nothing to backtrack into.

// The comment strip that stripJsComments__ replaced: the oracle for every comparison below.
const OLD_STRIP__ = /(^\s*|^)\/\*[\S\s]*?\*\/|(^\s*|^)\/\/.*$/gum;
const oldStrip = content => content.replaceAll(OLD_STRIP__, "$1");

// The shape of a rollup inline source map line, as in Gab's build:develop bundle.
const MAP_PREFIX__ = "//# sourceMappingURL=data:application/json;charset=utf-8;base64,";

// A character above U+00FF makes V8 keep the string two-byte, which is what made the old regex
// overflow: the same inputs without it pass on main. Every large input below carries one.
const TWO_BYTE_CODE__ = "const arrow = \"→\";\n";

const EIGHT_MB__ = 8 * 1024 * 1024;

// Generous per-test limit for the multi-megabyte and many-input tests: v8 coverage slows them
// down several times over and CI agents are slower than a laptop.
const SLOW_TEST_MS__ = 60000;

/**
 * @description Deterministic 32-bit PRNG (mulberry32), uniform in [0, 1).
 * @param {number} seed - Initial state.
 * @return {function(): number} Generator.
 */
function prng(seed)
{
	let state = seed;

	return () =>
	{
		state = (state + 0x6D2B79F5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);

		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * @description Base64-alphabet text of the given length (a stand-in for an inline map payload).
 * @param {number} length - Number of characters.
 * @return {string} The payload.
 */
function base64Payload(length)
{
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const random = prng(47091);
	let chunk = "";
	for (let index = 0; index < 65536; index++)
	{
		chunk += alphabet[Math.floor(random() * alphabet.length)];
	}

	return chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);
}

describe("JS comment strip on large inputs (47091)", () =>
{
	it("minify JS keeps going past an 8.6 MB inline source map line", () =>
	{
		const code = `${TWO_BYTE_CODE__}function f(a)\n{\n\treturn a;\n}\n`;
		const input = `${code}${MAP_PREFIX__}${base64Payload(8638676)}\n`;

		// premise: this is an input the old regex cannot process
		expect(() => oldStrip(input)).toThrow(RangeError);

		expect(minify__(input, "js")).toBe(`${TWO_BYTE_CODE__}function f(a)\n{\n\treturn a;\n}`);
	}, SLOW_TEST_MS__);

	it("minify JS removes an 8 MB block comment", () =>
	{
		const input = `${TWO_BYTE_CODE__}/*${"A".repeat(EIGHT_MB__)}*/\nconst b = 1;`;

		expect(() => oldStrip(input)).toThrow(RangeError);
		expect(minify__(input, "js")).toBe(`${TWO_BYTE_CODE__}const b = 1;`);
	}, SLOW_TEST_MS__);

	it("minify JS keeps an unclosed 8 MB block comment as is", () =>
	{
		const input = `${TWO_BYTE_CODE__}/*${"A".repeat(EIGHT_MB__)}`;

		expect(() => oldStrip(input)).toThrow(RangeError);
		expect(minify__(input, "js")).toBe(input);
	}, SLOW_TEST_MS__);

	it("minify JS removes an indented 8 MB line comment", () =>
	{
		const input = `${TWO_BYTE_CODE__}\t\t//${"A".repeat(EIGHT_MB__)}\nconst b = 1;`;

		expect(() => oldStrip(input)).toThrow(RangeError);
		expect(minify__(input, "js")).toBe(`${TWO_BYTE_CODE__}const b = 1;`);
	}, SLOW_TEST_MS__);
});

describe("stripJsComments__ matches the regex it replaced", () =>
{
	it("strip edge cases exactly like the regex", () =>
	{
		const cases = [
			["", ""],
			[" \n ", " \n "],
			["/*a*/\n/*b*/", "\n"],
			["/*a*//*b*/", "/*b*/"],
			["/*a*/*/", "*/"],
			["/*a*/ //b\nx", " //b\nx"],
			["/*\n//x\n/*", "/*\n\n/*"],
			["/*a\n/*b", "/*a\n/*b"],
			["a\r\n//x\r\nb", "a\r\r\nb"],
			["a\r//x\rb", "a\r\rb"],
			["a\u2028//x\u2029b", "a\u2028\u2029b"],
			["a\n\u00A0\uFEFF\u3000//x\nb", "a\n\nb"],
			["a\n\t /*x*/b", "a\n\t b"],
			["a\n\n  \n\t//x\nb", "a\n\nb"],
			["/*/x", "/*/x"],
			["/*/x*/y", "y"],
			["/**/x", "x"],
			["a; // x\nb; /* y */", "a; // x\nb; /* y */"],
			["a\n//", "a\n"],
			["→\n//😀\n\uD800//x", "→\n\n\uD800//x"]
		];

		for (const [input, expected] of cases)
		{
			expect(oldStrip(input)).toBe(expected);
			expect(stripJsComments__(input)).toBe(expected);
		}
	});

	it("strip searches for a closing */ only once when none is left", () =>
	{
		// the regex rescanned to the end from every unclosed "/*" (quadratic); the scan stops looking
		const text = "/*a\n".repeat(2000);
		const closerSearches = [];

		// counts the scan's searches without patching String.prototype for the whole worker
		class CountingString extends String
		{
			indexOf(needle, from)
			{
				if (needle === "*/")
				{
					closerSearches.push(from);
				}

				return super.indexOf(needle, from);
			}
		}

		expect(stripJsComments__(new CountingString(text))).toBe(oldStrip(text));
		expect(closerSearches).toEqual([2]);
	});

	it("strip every string up to length 6 over 8 symbols exactly like the regex", () =>
	{
		const symbols = ["/", "*", "\n", "\r", "\u2028", " ", "a", "→"];
		const mismatches = [];
		let compared = 0;
		let changed = 0;

		const visit = (input, depth) =>
		{
			compared++;
			const expected = oldStrip(input);
			if (expected !== input)
			{
				changed++;
			}

			if (stripJsComments__(input) !== expected && mismatches.length < 5)
			{
				mismatches.push(input);
			}

			if (depth < 6)
			{
				for (const symbol of symbols)
				{
					visit(input + symbol, depth + 1);
				}
			}
		};
		visit("", 0);

		expect(mismatches).toEqual([]);
		expect(compared).toBe(299593);
		expect(changed).toBeGreaterThanOrEqual(10000);
	}, SLOW_TEST_MS__);

	it("strip random strings up to length 40 over a wide alphabet exactly like the regex", () =>
	{
		const alphabet = [
			"/", "/", "*", "*", "\n", "\r", "\u2028", "\u2029", " ", " ", "\t", "\v", "\f", "\u00A0", "\uFEFF",
			"\u3000", "\u180E", "\u0085", "a", "\"", "`", "→", "😀", "\uD800", "\uDC00"
		];
		const random = prng(0x9E3779B9);
		const distinct = new Set();
		const distinctChanged = new Set();
		const mismatches = [];

		for (let round = 0; round < 200000; round++)
		{
			const length = Math.floor(random() * 41);
			let input = "";
			for (let index = 0; index < length; index++)
			{
				input += alphabet[Math.floor(random() * alphabet.length)];
			}

			distinct.add(input);
			const expected = oldStrip(input);
			if (expected !== input)
			{
				distinctChanged.add(input);
			}

			if (stripJsComments__(input) !== expected && mismatches.length < 5)
			{
				mismatches.push(input);
			}
		}

		expect(mismatches).toEqual([]);

		// premise: the generator covers many distinct inputs, and many of them hold a comment
		expect(distinct.size).toBeGreaterThanOrEqual(150000);
		expect(distinctChanged.size).toBeGreaterThanOrEqual(5000);
	}, SLOW_TEST_MS__);
});
