import minify__ from "../src/index.js";
import { vi } from "vitest";

// Oracle: main 45a20ae's HTML, CSS and SVG minifiers, verbatim apart from the names (WI 47095) and one alternation branch:
// the SVG comment regex had `[^-]|[\n\r]|-[^-]`; `[\n\r]` is inside `[^-]`, so dropping it matches the same text with the
// same captures (checked on every string up to 8 characters over 7 symbols and 197k random ones) and removes the
// exponential backtracking on a run of newlines that CodeQL flags (js/redos). They are the spec the
// linear rewrites in src/index.js must match byte for byte on every input they do not throw on.
const ORACLE_VOID_ELEMENTS__ = "area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr";

/**
 * @description Minifies HTML content.
 * @param {string} content - Original HTML content.
 * @return {string} Minified output of the given HTML content.
 */
function oracleHtml__(content)
{
	const preservedBlocks = [];

	// Extract <pre> and <code> blocks.
	const placeholderHtml = content.replaceAll(
		/<(pre|code)(\b[^>]*)>[\s\S]*?<\/\1>/giu,
		match => 
		{
			const key = `__PRESERVE_BLOCK_${preservedBlocks.length}__`;
			preservedBlocks.push(match);
			
			return key;
		}
	);

	// Minify remaining HTML.
	let minified = placeholderHtml
		.replaceAll(/\r\n|\n|\t/giu, " ")

		// drop the self-closing "/" on void elements: always safe, regardless of attribute order
		.replaceAll(new RegExp(`(<(?:${ORACLE_VOID_ELEMENTS__})\\b[^>]*?)\\s*/>`, "giu"), "$1>")

		// don't strip quotes right before a "/": would get absorbed into the value otherwise
		.replaceAll(/(href|src)=('|")(\S+)('|")(?!\s*\/)/giu, "$1=$3")
		.replaceAll(/>\s+</giu, "><").trim()
		.replaceAll(/\s{2,}/giu, " ");

	// Repeat until no comments remain: nested/overlapping "<!--"/"-->" can otherwise survive a
	// single pass by re-forming across a deleted comment's boundary (CodeQL
	// js/incomplete-multi-character-sanitization, e.g. "<!<!---->-->-->" -> "<!-->-->" -> "").
	let previousMinified;
	do
	{
		previousMinified = minified;
		minified = minified.replaceAll(/<!--[\D\d]*?-->/giu, "");
	} while (minified !== previousMinified);

	minified = minified
		.replaceAll(/\s*=\s*/gu, "=")
		.replaceAll(/\s+>/gu, ">")
		.replaceAll(/<script\s+type=(["'])text\/javascript\1/giu, "<script")
		.replaceAll(/<style\s+type=(["'])text\/css\1/giu, "<style")
		.replaceAll(/\s+(checked|disabled|selected|readonly|required|autofocus|autoplay|controls|loop|muted)=(["'])\1\2/giu, " $1")
		.trim();

	// Restore preserved blocks.
	preservedBlocks.forEach((block, i) => 
	{
		minified = minified.replace(`__PRESERVE_BLOCK_${i}__`, block);
	});

	return minified;
}

/**
 * @description Minifies CSS content.
 * @param {string} content - Original CSS content.
 * @return {string} Minified output of the given CSS content.
 */
function oracleCss__(content)
{
	const minified = content
		.replaceAll(/\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\n\t]+/gu, "")
		.replaceAll(/ {2,}/gu, " ")
		.replaceAll(/ ([{:}]) /gu, "$1")
		.replaceAll(/([;,]) /gu, "$1")
		.replaceAll(" !", "!")
		.replaceAll(/(\s|:)0(?:px|em|rem|vh|vw|vmin|vmax|cm|mm|in|pt|pc|ex|ch)/giu, "$10")
		.replaceAll(/(\D)0\.(\d+)/gu, "$1.$2")
		.replaceAll(";}", "}")
		.replaceAll(/#([0-9a-fA-F])\1([0-9a-fA-F])\2([0-9a-fA-F])\3/gu, "#$1$2$3")
		.replaceAll(": ", ":")
		.replaceAll(" {", "{")
		.replaceAll(/\{\s+/gu, "{")
		.replaceAll(/\s+\}/gu, "}");

	return minified;
}

/**
 * @description Minifies SVG content.
 * @param {string} content - Original SVG content.
 * @return {string} Minified output of the given SVG content.
 */
function oracleSvg__(content)
{
	const minified = content.replaceAll(/>\s+</gu, "><")
		.replaceAll(/\s\s+/gu, " ")
		.replaceAll(/<![\t\n\r ]*(--([^-]|-[^-])*--[\t\n\r ]*)>/gu, "")
		.replaceAll(/(\r\n|\n|\r)/gum, "")
		.replaceAll(/\s*=\s*/gu, "=")
		.replaceAll(/(\d)\.0+(\D)/gu, "$1$2")
		.replaceAll(/(\d)\.(\d*?)0+(\D)/gu, "$1.$2$3")
		.replaceAll(/(\D)0\.(\d+)/gu, "$1.$2");

	return minified;
}

const ORACLES__ = {
	html: oracleHtml__,
	css: oracleCss__,
	svg: oracleSvg__
};

// The regexes main overflowed on, per extension, as the oracle writes them, each with the part whose matches count (the
// CSS stage is one alternation and only its comment branch is this change's). The positive control counts their matches
// on the strings the oracle's own stages hand them, not on the raw input: a void tag inside a pre block, say, never
// reaches the void stage.
const STAGES__ = {
	html: {
		preCode: [/<(pre|code)(\b[^>]*)>[\s\S]*?<\/\1>/giu, /<(pre|code)(\b[^>]*)>[\s\S]*?<\/\1>/giu],
		voidSelfClose: [new RegExp(`(<(?:${ORACLE_VOID_ELEMENTS__})\\b[^>]*?)\\s*/>`, "giu"), new RegExp(`(<(?:${ORACLE_VOID_ELEMENTS__})\\b[^>]*?)\\s*/>`, "giu")],
		hrefSrcQuotes: [/(href|src)=('|")(\S+)('|")(?!\s*\/)/giu, /(href|src)=('|")(\S+)('|")(?!\s*\/)/giu],
		htmlComment: [/<!--[\D\d]*?-->/giu, /<!--[\D\d]*?-->/giu]
	},
	css: {
		cssComment: [/\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\n\t]+/gu, /\/\*(?:(?!\*\/)[\s\S])*\*\//gu]
	},
	svg: {
		svgComment: [/<![\t\n\r ]*(--([^-]|-[^-])*--[\t\n\r ]*)>/gu, /<![\t\n\r ]*(--([^-]|-[^-])*--[\t\n\r ]*)>/gu]
	}
};

/**
 * @description Names the watched stages whose regex matched during the calls a RegExp.prototype[Symbol.replace] spy
 * recorded, on the string each call was handed.
 * @param {Object} spy - The spy, holding one oracle call's replaces.
 * @param {Object} stages - Watched stages: name to [the regex as the oracle writes it, the part whose matches count].
 * @return {Set<string>} Names of the stages that matched.
 */
function stagesFired__(spy, stages)
{
	const fired = new Set();

	spy.mock.calls.forEach(([subject], index) =>
	{
		const regex = spy.mock.contexts[index];

		for (const [name, [staged, counted]] of Object.entries(stages))
		{
			if (regex.source === staged.source && regex.flags === staged.flags && subject.search(counted) !== -1) fired.add(name);
		}
	});

	return fired;
}

// Tokens that decide where those regexes match: delimiters, every whitespace class they treat differently, case and
// Unicode case-folding variants (under the iu flags U+017F matches "s" and U+212A matches "k"), two-byte and astral
// characters, a lone surrogate, and CSS/SVG number shapes.
const TOKENS__ = [
	"<", ">", "/", "/>", " /", "*", "-", "--", "!", "=", "'", "\"", " ", "  ", "\n", "\r", "\t", "\u00A0", "\uFEFF", "\u2028",
	"x", "_", "1", "0", ".", "→", "😀", "\uD800", "\uDC00", "$&", "$$", "$1", "$'", "\u017F", "{", "}", ":", ";", ",", "#aabbcc", "0px", "0.5", "1.50",
	"<br", "<BR", "<img", "<Img", "<input", "<linK", "<lin\u212A", "<trac\u212A", "\u212A", "<ba\u017Fe", "<\u017Fource", "<wbr", "<hr", "<area", "<col", "<embed",
	"<meta", "<track", "<link", "<brx", "<br-", "<pre", "<PRE", "<code", "<Code", "<prex", "</pre>", "</PRE>", "</code>",
	"</CODE>", "</pre >", "<!--", "-->", "<!", "/*", "*/", "src=\"", "href='", "\u017Frc=\"", "HREF=\"", "a=\"b\"", "<svg>",
	"</svg>"
];
const CASES__ = 20000;
const MAX_TOKENS__ = 60;

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

// Wall-clock allowance per test, generous because a busy machine can stretch these seconds-long runs several times over;
// what each test checks is its output (and, for the workloads, CPU time), not this.
const TIMEOUT_MS__ = 120000;

describe("minify__ matches main's regex minifiers byte for byte", { timeout: TIMEOUT_MS__ }, () =>
{
	for (const extension of ["html", "css", "svg"])
	{
		it(`${extension}: ${CASES__} seeded random inputs`, () =>
		{
			const random = prng__(47095);
			const stages = STAGES__[extension];
			const fired = Object.fromEntries(Object.keys(stages).map(name => [name, 0]));
			const replaceSpy = vi.spyOn(RegExp.prototype, Symbol.replace);
			const seen = new Set();
			const changed = new Set();
			const mismatches = [];

			for (let i = 0; i < CASES__; i++)
			{
				let input = "";
				const length = Math.floor(random() * MAX_TOKENS__);

				for (let j = 0; j < length; j++) input += TOKENS__[Math.floor(random() * TOKENS__.length)];

				replaceSpy.mockClear();

				// minify__ strips a leading BOM before it minifies; the oracle functions never saw one
				const expected = ORACLES__[extension](input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input);

				for (const name of stagesFired__(replaceSpy, stages)) fired[name]++;
				seen.add(input);
				if (expected !== input) changed.add(input);
				if (minify__(input, extension) !== expected && mismatches.length < 5) mismatches.push(input);
			}

			replaceSpy.mockRestore();

			expect(mismatches).toEqual([]);

			// positive control: the generator does not cycle, the oracle rewrote a good share of distinct inputs, and each
			// regex the change replaced matched often at its own stage
			expect(Object.keys(fired).length).toBeGreaterThan(0);
			expect(seen.size).toBeGreaterThan(CASES__ * 0.9);
			expect(changed.size).toBeGreaterThan(CASES__ * 0.3);
			for (const [name, count] of Object.entries(fired)) expect(count, name).toBeGreaterThan(CASES__ * 0.01);
		});
	}
});
