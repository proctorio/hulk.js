import minify__ from "../src/index.js";

// Seeded random inputs through every minifier. The scanners vault protected spans as U+0001 + index + U+0001 and
// restore them at the end, so a span vaulted twice, a marker a rule cut in half, or a marker emitted after the restore
// would show up as a U+0001 in the output that the input never had, or as a marker-shaped run the input never held. Inputs are built from tokens that sit on the
// scanners' state boundaries in all four languages, plus U+0001 itself and text shaped like a marker.
const TOKENS__ = [
	"<", ">", "/", "/>", "</", "=", "\"", "'", "`", "${", "}", "{", "(", ")", "[", "]", ";", ":", ",", "!", "?", "&", "#", "@", "\\",
	" ", "  ", "\n", "\r\n", "\t", "\f", "\u00A0", "\u2028", "→", "😀", "\uD800",
	"<!--", "-->", "--!>", "<![CDATA[", "]]>", "<?xml version=\"1.0\"?>", "<!DOCTYPE html>", "/*", "*/", "//",
	"<pre>", "</pre >", "<code>", "</code>", "<listing>", "<textarea>", "</textarea>", "<script>", "</script>", "<style>",
	"</style>", "<svg>", "</svg>", "<foreignObject>", "<title>", "<select>", "<p>", "<img src=\"a\"/>", "<a href=x/>",
	"<text xml:space=\"preserve\">", "</text>", "<path d=\"M0.5 1.50\"/>", "<rect width=\"1.0\"/>",
	"url(", "#url(", "\\41 ", "\"a\nb", "--x:", "margin:", "0px", "0.5", "1.50", "#aabbcc", "style(", "calc(",
	"return", "yield", "of", "/re/", "x++", "\u0001", "\u00010\u0001", "__PRESERVE_BLOCK_0__", "$&", "$$", "a", "1"
];
const MARK__ = String.fromCharCode(1);
const MARKER__ = new RegExp(`${MARK__}\\d+${MARK__}`, "gu");
const CASES__ = 5000;
const MAX_TOKENS__ = 40;

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

/**
 * @description Counts U+0001 characters.
 * @param {string} text - Text to count in.
 * @return {number} How many U+0001 it holds.
 */
function marks__(text)
{
	return text.split("\u0001").length - 1;
}

describe("minify__ on seeded random inputs", { timeout: 120000 }, () =>
{
	for (const extension of ["html", "css", "svg", "js"])
	{
		it(`${extension}: never throws, never leaks a vault marker`, () =>
		{
			const random = prng__(47101);
			const leaks = [];
			let changed = 0;
			let withMarks = 0;

			for (let i = 0; i < CASES__; i++)
			{
				let input = "";
				const length = 1 + Math.floor(random() * MAX_TOKENS__);

				for (let j = 0; j < length; j++) input += TOKENS__[Math.floor(random() * TOKENS__.length)];

				const output = minify__(input, extension);

				if (output !== input) changed++;
				if (marks__(input) > 0) withMarks++;

				// a leaked marker either adds a U+0001 or, when input U+0001 were dropped with a comment, shows a marker the
				// input never held
				const leaked = marks__(output) > marks__(input) || (output.match(MARKER__) || []).some(marker => !input.includes(marker));

				if (leaked && leaks.length < 5) leaks.push(input);
			}

			expect(leaks).toEqual([]);

			// positive control: the inputs reach the rules (a share is rewritten; random SVG and JS are often malformed or
			// ambiguous and come back as written) and the U+0001 paths
			expect(changed).toBeGreaterThan(CASES__ * 0.1);
			expect(withMarks).toBeGreaterThan(CASES__ * 0.1);
		});
	}
});
