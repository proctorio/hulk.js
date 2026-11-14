import { scanJs__ } from "./JsLexer.js";
import { stripJsComments__ } from "./JsComments.js";

const TRAILING_WHITESPACE__ = /\s+$/gum;

/**
 * @description Removes trailing whitespace and blank lines, except where a run starts in a protected span.
 * @param {string} content - JS source.
 * @param {Array<number>} protectedSpans - Protected [start, end) pairs, flat and in order.
 * @return {string} The source without its unprotected trailing whitespace.
 */
function _trimLineEnds__(content, protectedSpans)
{
	let span = 0;

	return content.replaceAll(TRAILING_WHITESPACE__, (run, offset) =>
	{
		while (span < protectedSpans.length && protectedSpans[span + 1] <= offset)
		{
			span += 2;
		}

		return span < protectedSpans.length && protectedSpans[span] <= offset ? run : "";
	});
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
	const minified = rescan === null ? content.trim() : _trimLineEnds__(stripped, rescan.protectedSpans).trim();

	return minified.startsWith("#!") && !content.startsWith("#!") ? content : minified;
}

export { minifyJs__ };
