import {
	dropVoidSelfClose__,
	replacePreCodeBlocks__,
	stripCssComments__,
	stripHrefSrcQuotes__,
	stripHtmlCommentsOnce__,
	stripSvgComments__
} from "../src/MarkupScanners.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// What src/MarkupScanners.js does and why. The explanation lives here, not in src: src is copied verbatim into the
// published lib/, so it carries only the JSDoc the lint requires.
//
// The HTML, CSS and SVG minifiers used regexes that kept one backtrack entry per character of a long run (a big comment,
// data: URI or pre block) and overflowed V8's regexp stack with "RangeError: Maximum call stack size exceeded" (WI
// 47095). Each helper returns exactly what its regex's replaceAll returned at its call site:
// - stripCssComments__: each comment ends at the first "*/" after its "/*" (so "/*/" does not close itself); an unclosed
//   "/*" and everything after it stays. No "*/" after one "/*" means none after any later one, so the scan stops there
//   instead of retrying every later "/*" (quadratic on "/*x/*x...").
// - stripHtmlCommentsOnce__: the same for "<!--" and "-->", one pass; the minifier repeats it until nothing changes.
// - replacePreCodeBlocks__: the opening tag ends at the first ">", the block at the first closing tag of the same name in
//   any case; an opener with no closing tag is skipped and a later block can still match.
// - dropVoidSelfClose__: a void tag matches when the character before its first ">" is "/"; the whitespace before that
//   "/" goes too, back to the end of the tag name at most.
// - stripHrefSrcQuotes__: the value runs from the opening quote to the last quote in the same non-whitespace run that is
//   not followed by "/" (or, for a quote that ends the run, by whitespace and then "/"). A value right before a
//   self-closing "/" keeps its quotes; unquoted, the "/" would be read as part of it.
// - stripSvgComments__: the body can hold no "--" and cannot end in "-", so a comment closes at the first "--" after its
//   opening "--", and only if [\t\n\r ]* and ">" follow; otherwise the next "<!" is tried.
//
// Bounded prefixes stay quantifier-free regexes with the original flags, so the iu case folding (U+017F matches "s",
// U+212A matches "k", and both count as word characters for \b) is unchanged; only the unbounded runs are scanned by
// hand. Every lastIndex the helpers set is just after an ASCII character or at a whitespace index, never inside a
// surrogate pair, where a /u search would step back to the pair's start. Searches that many failed candidates would
// repeat over the same text (the first ">", the pre and code closers, the next whitespace, the closing quote of a run)
// are cached: a miss from an index is a miss from every later index, and a hit at k answers every search up to k.

// Oracles: the regexes these helpers replaced, verbatim from src/index.js before the change. Each helper must return
// exactly what its regex's replaceAll returned, on every input the regex did not overflow on.
// The void elements: their self-closing "/" before ">" is never meaningful (browsers treat "<img ... />" and
// "<img ...>" identically), unlike svg/mathml foreign content elements (e.g. <path/>, <circle/>), where the "/" is what
// tells the parser the element has no children.
const VOID_ELEMENTS__ = "area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr";
const ORACLES__ = {
	cssComments: [stripCssComments__, /\/\*(?:(?!\*\/)[\s\S])*\*\//gu, ""],
	htmlComments: [stripHtmlCommentsOnce__, /<!--[\D\d]*?-->/giu, ""],
	voidSelfClose: [dropVoidSelfClose__, new RegExp(`(<(?:${VOID_ELEMENTS__})\\b[^>]*?)\\s*/>`, "giu"), "$1>"],
	hrefSrcQuotes: [stripHrefSrcQuotes__, /(href|src)=('|")(\S+)('|")(?!\s*\/)/giu, "$1=$3"],
	svgComments: [stripSvgComments__, /<![\t\n\r ]*(--([^-]|[\n\r]|-[^-])*--[\t\n\r ]*)>/gu, ""]
};
const PRE_CODE_ORACLE__ = /<(pre|code)(\b[^>]*)>[\s\S]*?<\/\1>/giu;
const CSS_FULL_ORACLE__ = /\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\n\t]+/gu;

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

// Failed-candidate workloads: many starts that each fail inside one long run. A missing cache rescans the run from every
// start (minutes at this size); with the caches each takes tens of milliseconds.
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

	it(`preCode: ${CASES__} seeded random inputs, same blocks to the replacer in the same order`, () =>
	{
		const inputs = inputs__(47096);
		const changed = new Set();
		const mismatches = [];

		for (const input of inputs)
		{
			const expectedBlocks = [];
			const actualBlocks = [];
			const expected = input.replaceAll(PRE_CODE_ORACLE__, match =>
			{
				expectedBlocks.push(match);

				return `[${expectedBlocks.length}]`;
			});
			const actual = replacePreCodeBlocks__(input, match =>
			{
				actualBlocks.push(match);

				return `[${actualBlocks.length}]`;
			});

			if (expected !== input) changed.add(input);
			if ((actual !== expected || actualBlocks.join("\u0000") !== expectedBlocks.join("\u0000")) && mismatches.length < 5) mismatches.push(input);
		}

		expect(mismatches).toEqual([]);
		expect(new Set(inputs).size).toBeGreaterThan(CASES__ * 0.9);
		expect(changed.size).toBeGreaterThan(CASES__ * 0.02);
	});

	it(`cssComments then the newline strip: ${CASES__} inputs match the original single alternation`, () =>
	{
		const inputs = inputs__(47097);
		const mismatches = [];

		for (const input of inputs)
		{
			const expected = input.replaceAll(CSS_FULL_ORACLE__, "");

			if (stripCssComments__(input).replaceAll(/[\r\n\t]+/gu, "") !== expected && mismatches.length < 5) mismatches.push(input);
		}

		expect(mismatches).toEqual([]);
	});

	it("fixtures the full minifiers would hide", () =>
	{
		const fixtures = [
			["hrefSrcQuotes", "<!--src=\"x\"/>-->"],
			["hrefSrcQuotes", "<a src=\"x\" />"],
			["hrefSrcQuotes", "<a src=\"x\"/"],
			["hrefSrcQuotes", "src=\"a\"/src=\"b\""],
			["hrefSrcQuotes", "src=\"\" x"],
			["hrefSrcQuotes", "src=\"\"\""],
			["hrefSrcQuotes", "src=\"😀\" src='a😀' src=\"😀\"😀/"],
			["hrefSrcQuotes", "\u017Frc=\"a\" HREF='b'"],
			["hrefSrcQuotes", "src=\"a\"\u2028/"],
			["cssComments", "/*/ a */b/*/"],
			["cssComments", "a/**/b/*"],
			["htmlComments", "<!--><!---->x<!-- a --->"],
			["htmlComments", "<!--<!--x-->-->"],
			["svgComments", "<!--->x<!---->y<!-- a --->z<! \n-- b -- \t>"],
			["svgComments", "<!--x--oops<!--y-->"],
			["svgComments", "<!--a-b--c-->"],
			["voidSelfClose", "<br/><brx/><br-/><BR \t/><lin\u212A/><ba\u017Fe />"],
			["voidSelfClose", "<br <img/>"],
			["voidSelfClose", "<br / x/>"],
			["voidSelfClose", "<img src=\"a😀\" \uD800 \u00A0/>"]
		];

		for (const [name, input] of fixtures)
		{
			const [helper, regex, replacement] = ORACLES__[name];

			expect(helper(input), `${name} ${JSON.stringify(input)}`).toBe(input.replaceAll(regex, replacement));
		}

		for (const input of ["<pre>a<code>b</code>c<PRE x>d</pre>e<pre-1>f</Pre>", "<pre\u017F>a</pre><prex>b</prex>", "<pre>x<code>y</code>", "<code a>b</CODE>"])
		{
			const expectedBlocks = [];
			const actualBlocks = [];
			const expected = input.replaceAll(PRE_CODE_ORACLE__, match =>
			{
				expectedBlocks.push(match);

				return "#";
			});

			expect(replacePreCodeBlocks__(input, match =>
			{
				actualBlocks.push(match);

				return "#";
			}), input).toBe(expected);
			expect(actualBlocks, input).toEqual(expectedBlocks);
		}
	});
});

describe("MarkupScanners helpers stay linear on failed-candidate workloads", { timeout: TIMEOUT_MS__ }, () =>
{
	const preCode = text => replacePreCodeBlocks__(text, () => "#");
	const preCodeOracle = text => text.replaceAll(PRE_CODE_ORACLE__, () => "#");
	const [cssHelper, cssRegex] = ORACLES__.cssComments;
	const [htmlHelper, htmlRegex] = ORACLES__.htmlComments;
	const [voidHelper, voidRegex, voidReplacement] = ORACLES__.voidSelfClose;
	const [hrefHelper, hrefRegex, hrefReplacement] = ORACLES__.hrefSrcQuotes;
	const [svgHelper, svgRegex, svgReplacement] = ORACLES__.svgComments;

	// [name, helper, old regex, input of size n, expected output of size n]
	const workloads = [
		["css: no \"*/\" after any opener", cssHelper, text => text.replaceAll(cssRegex, ""), n => "\u2192" + "/*x".repeat(n), n => "\u2192" + "/*x".repeat(n)],
		["html: no \"-->\" after any opener", htmlHelper, text => text.replaceAll(htmlRegex, ""), n => "\u2192" + "<!--x".repeat(n), n => "\u2192" + "<!--x".repeat(n)],
		["pre/code: one \">\" shared by every opener", preCode, preCodeOracle, n => "\u2192" + "<pre ".repeat(n) + ">", n => "\u2192" + "<pre ".repeat(n) + ">"],
		["pre/code: no </pre> for any opener", preCode, preCodeOracle, n => "\u2192" + "<pre>".repeat(n), n => "\u2192" + "<pre>".repeat(n)],
		["pre/code: no </code> for any opener", preCode, preCodeOracle, n => "\u2192" + "<code>".repeat(n), n => "\u2192" + "<code>".repeat(n)],
		["void: one \">\" shared by every tag", voidHelper, text => text.replaceAll(voidRegex, voidReplacement), n => "\u2192" + "<br ".repeat(n) + ">", n => "\u2192" + "<br ".repeat(n) + ">"],
		["href/src: every quote followed by \"/\"", hrefHelper, text => text.replaceAll(hrefRegex, hrefReplacement), n => "\u2192<p><!--" + "src=\"/".repeat(n) + "--></p>", n => "\u2192<p><!--" + "src=\"/".repeat(n) + "--></p>"],
		["href/src: one run, no closing quote for any opener", hrefHelper, text => text.replaceAll(hrefRegex, hrefReplacement), n => "\u2192" + "src=\"/".repeat(n) + "'/ ", n => "\u2192" + "src=\"/".repeat(n) + "'/ "],
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
