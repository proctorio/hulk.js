import { scanJs__ } from "./JsLexer.js";
import { stripJsComments__ } from "./JsComments.js";

/**
 * @description Tells whether a UTF-16 code unit is one the regex class \s matches.
 * @param {number} code - Code unit.
 * @return {boolean} True for a whitespace or line terminator code unit.
 */
function isSpace__(code)
{
	if (code < 0x80) return code === 0x20 || (code >= 0x09 && code <= 0x0D);

	return code === 0xA0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200A) || code === 0x2028 || code === 0x2029 ||
		code === 0x202F || code === 0x205F || code === 0x3000 || code === 0xFEFF;
}

/**
 * @description Removes trailing whitespace and blank lines, except where a run starts in a protected span; one pass, same
 * matches as /\s+$/gum.
 * @param {string} content - JS source.
 * @param {Array<number>} protectedSpans - Protected [start, end) pairs, flat and in order.
 * @return {string} The source without its unprotected trailing whitespace.
 */
function trimLineEnds__(content, protectedSpans)
{
	const length = content.length;
	let span = 0;
	let copied = 0;
	let index = 0;
	let output = "";

	while (index < length)
	{
		if (isSpace__(content.charCodeAt(index)))
		{
			const start = index;
			let lineEnd = -1;

			while (index < length && isSpace__(content.charCodeAt(index)))
			{
				const code = content.charCodeAt(index);

				if (code === 0x0A || code === 0x0D || code === 0x2028 || code === 0x2029) lineEnd = index;

				index++;
			}

			const cut = index === length ? length : lineEnd;

			if (cut > start)
			{
				while (span < protectedSpans.length && protectedSpans[span + 1] <= start)
				{
					span += 2;
				}

				if (span >= protectedSpans.length || protectedSpans[span] > start)
				{
					output += content.slice(copied, start);
					copied = cut;
				}
			}
		}
		else
		{
			index++;
		}
	}

	return output + content.slice(copied);
}

/**
 * @description Minifies JS content; one that would start with "#!" only once minified stays as written (no hashbang then).
 * @param {string} content - Original JS content.
 * @return {string} Minified output of the given JS content.
 */
function minifyJs__(content)
{
	const scan = scanJs__(content);
	const stripped = scan === null ? null : stripJsComments__(content, scan.commentStarts);
	const rescan = stripped === null ? null : scanJs__(stripped);
	const minified = rescan === null ? content.trim() : trimLineEnds__(stripped, rescan.protectedSpans).trim();

	return minified.startsWith("#!") && !content.startsWith("#!") ? content : minified;
}

export { minifyJs__, trimLineEnds__ };
