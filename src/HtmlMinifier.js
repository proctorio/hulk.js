import { dropVoidSelfClose__, replacePreCodeBlocks__, stripHrefSrcQuotes__, stripHtmlCommentsOnce__ } from "./MarkupScanners.js";

/**
 * @description Minifies HTML content.
 * @param {string} content - Original HTML content.
 * @return {string} Minified output of the given HTML content.
 */
function minifyHtml__(content)
{
	const preservedBlocks = [];

	// Extract <pre> and <code> blocks.
	const placeholderHtml = replacePreCodeBlocks__(
		content,
		match => 
		{
			const key = `__PRESERVE_BLOCK_${preservedBlocks.length}__`;
			preservedBlocks.push(match);
			
			return key;
		}
	);

	// Minify remaining HTML.
	let minified = placeholderHtml.replaceAll(/\r\n|\n|\t/giu, " ");

	// drop the self-closing "/" on void elements: always safe, regardless of attribute order
	minified = dropVoidSelfClose__(minified);

	// don't strip quotes right before a "/": would get absorbed into the value otherwise
	minified = stripHrefSrcQuotes__(minified)
		.replaceAll(/>\s+</giu, "><").trim()
		.replaceAll(/\s{2,}/giu, " ");

	// Repeat until no comments remain: nested/overlapping "<!--"/"-->" can otherwise survive a
	// single pass by re-forming across a deleted comment's boundary (CodeQL
	// js/incomplete-multi-character-sanitization, e.g. "<!<!---->-->-->" -> "<!-->-->" -> "").
	let previousMinified;
	do
	{
		previousMinified = minified;
		minified = stripHtmlCommentsOnce__(minified);
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

export { minifyHtml__ };
