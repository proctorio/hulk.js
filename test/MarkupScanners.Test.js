import { stripHtmlCommentsOnce__, stripSvgComments__ } from "../src/MarkupScanners.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// What src/MarkupScanners.js does and why. The explanation lives here, not in src: src is copied verbatim into the
// published lib/, so it carries only the JSDoc the lint requires.
//
// The HTML and SVG minifiers used regexes that kept one backtrack entry per character of a long run (a big comment) and
// overflowed V8's regexp stack with "RangeError: Maximum call stack size exceeded" (WI 47095). Each helper returns
// exactly what its regex's replaceAll returned at its call site. The pre/code, void-tag, href/src and CSS comment
// helpers of that change are gone: 47101's scanners read those constructs themselves, so no minifier calls them (the
// HTML and CSS linear-time workloads that covered them live in the HTML, CSS and SVG test files).
// - stripHtmlCommentsOnce__: each comment ends at the first "-->" after its "<!--"; an unclosed "<!--" and everything
//   after it stays. No "-->" after one "<!--" means none after any later one, so the scan stops there instead of
//   retrying every later "<!--" (quadratic on "<!--x<!--x..."). One pass; the minifier repeats it until nothing changes.
// - stripSvgComments__: the body can hold no "--" and cannot end in "-", so a comment closes at the first "--" after its
//   opening "--", and only if [\t\n\r ]* and ">" follow; otherwise the next "<!" is tried.

// Oracles: the regexes these helpers replaced, verbatim from src/index.js before the change, except the SVG one, which
// lost its `[\n\r]` branch (inside `[^-]` already: same matches, same captures).
// Each helper must return exactly what its regex's replaceAll returned, on every input the regex did not overflow on.
const ORACLES__ = {
	htmlComments: [stripHtmlCommentsOnce__, /<!--[\D\d]*?-->/giu, ""],
	svgComments: [stripSvgComments__, /<![\t\n\r ]*(--([^-]|-[^-])*--[\t\n\r ]*)>/gu, ""]
};

// Tokens that decide where those regexes match: their delimiters, every whitespace class they treat differently, case
// and Unicode case-folding variants (under the iu flags U+017F matches "s" and U+212A matches "k", and both are word
// characters for \b), a two-byte and an astral character, both lone surrogates, and "$" replacement patterns.
const TOKENS__ = [
	"<", ">", "/", "/>", " /", "*", "-", "--", "!", "=", "'", "\"", " ", "  ", "\n", "\r", "\t", "\r\n", "\u00A0", "\uFEFF",
	"\u2028", "x", "_", "1", "→", "😀", "\uD800", "\uDC00", "$&", "$$", "$1", "$'", "\u017F", "\u212A",
	"<br", "<BR", "<img", "<Img", "<input", "<link", "<lin\u212A", "<trac\u212A", "<ba\u017Fe", "<\u017Fource", "<wbr",
	"<hr", "<area", "<col", "<embed", "<meta", "<brx", "<br-", "<pre", "<PRE", "<code", "<Code", "<prex", "<pre-",
	"</pre>", "</PRE>", "</code>", "</CODE>", "</pre >", "<!--", "-->", "<!", "/*", "*/", "src=\"", "href='", "\u017Frc=\"",
	"HREF=\"", "a=\"b\""
];
const CASES__ = 20000;
const MAX_TOKENS__ = 60;

// Failed-candidate workloads: many starts that each fail inside one long run. A missing stop rescans the run from every
// start (minutes at this size); with it each takes tens of milliseconds.
const REPEAT__ = 524288;
const BOUND_MS__ = 3000;

/**
 * @description Seeded 32-bit PRNG (mulberry32), so every run fuzzes the same inputs.
 * @param {number} seed - Seed.
 * @return {Function} Generator of floats in [0, 1).
 */
function prng__(seed)
{
	let state = seed >>> 0;

	return () =>
	{
		state = (state + 0x6D2B79F5) >>> 0;
		let mixed = state;

		mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * @description Generates the fuzz inputs for one seed.
 * @param {number} seed - Seed.
 * @return {Array<string>} Inputs.
 */
function inputs__(seed)
{
	const random = prng__(seed);
	const generated = [];

	for (let i = 0; i < CASES__; i++)
	{
		let input = "";
		const length = Math.floor(random() * MAX_TOKENS__);

		for (let j = 0; j < length; j++) input += TOKENS__[Math.floor(random() * TOKENS__.length)];

		generated.push(input);
	}

	return generated;
}

// Wall-clock allowance per test, generous because a busy machine can stretch these seconds-long runs several times over;
// what each test checks is its output (and, for the workloads, CPU time), not this.
const TIMEOUT_MS__ = 120000;

describe("MarkupScanners helpers match the regexes they replaced", { timeout: TIMEOUT_MS__ }, () =>
{
	for (const [name, [helper, regex, replacement]] of Object.entries(ORACLES__))
	{
		it(`${name}: ${CASES__} seeded random inputs`, () =>
		{
			const inputs = inputs__(47095);
			const changed = new Set();
			const mismatches = [];

			for (const input of inputs)
			{
				const expected = input.replaceAll(regex, replacement);

				if (expected !== input) changed.add(input);
				if (helper(input) !== expected && mismatches.length < 5) mismatches.push(input);
			}

			expect(mismatches).toEqual([]);

			// positive control: the generator does not cycle, and the regex really fired on a share of distinct inputs
			expect(new Set(inputs).size).toBeGreaterThan(CASES__ * 0.9);
			expect(changed.size).toBeGreaterThan(CASES__ * 0.02);
		});
	}

	it("fixtures the full minifiers would hide", () =>
	{
		const fixtures = [
			["htmlComments", "<!--><!---->x<!-- a --->"],
			["htmlComments", "<!--<!--x-->-->"],
			["svgComments", "<!--->x<!---->y<!-- a --->z<! \n-- b -- \t>"],
			["svgComments", "<!--x--oops<!--y-->"],
			["svgComments", "<!--a-b--c-->"]
		];

		for (const [name, input] of fixtures)
		{
			const [helper, regex, replacement] = ORACLES__[name];

			expect(helper(input), `${name} ${JSON.stringify(input)}`).toBe(input.replaceAll(regex, replacement));
		}
	});
});

describe("MarkupScanners helpers stay linear on failed-candidate workloads", { timeout: TIMEOUT_MS__ }, () =>
{
	const [htmlHelper, htmlRegex] = ORACLES__.htmlComments;
	const [svgHelper, svgRegex, svgReplacement] = ORACLES__.svgComments;

	// [name, helper, old regex, input of size n, expected output of size n]
	const workloads = [
		["html: no \"-->\" after any opener", htmlHelper, text => text.replaceAll(htmlRegex, ""), n => "\u2192" + "<!--x".repeat(n), n => "\u2192" + "<!--x".repeat(n)],
		["svg: every comment fails after its closing \"--\"", svgHelper, text => text.replaceAll(svgRegex, svgReplacement), n => "\u2192" + "<!--a--  x".repeat(n), n => "\u2192" + "<!--a--  x".repeat(n)],
		["svg: nested openers before a long whitespace run", svgHelper, text => text.replaceAll(svgRegex, svgReplacement), n => "\u2192" + "<!--<!--".repeat(n) + " ".repeat(n) + "X-->", n => "\u2192" + "<!--<!--".repeat(n - 1) + "<!--"]
	];

	for (const [name, helper, oracle, input, expected] of workloads)
	{
		it(name, () =>
		{
			// the expected output agrees with the old regex at a size it neither overflows on nor takes long over
			expect(oracle(input(64))).toBe(expected(64));

			const text = input(REPEAT__);
			let output = "";
			const took = cpuMs__(() =>
			{
				output = helper(text);
			});

			expect(difference__(output, expected(REPEAT__))).toBeNull();
			expect(took).toBeLessThan(BOUND_MS__);
		});
	}
});
