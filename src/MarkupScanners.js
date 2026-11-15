const SVG_SPACE__ = "\t\n\r ";

/**
 * @description Strips HTML comments in one pass.
 * @param {string} content - HTML.
 * @return {string} The HTML without the comments this pass finds.
 */
function stripHtmlCommentsOnce__(content)
{
	let output = "";
	let copied = 0;
	let start = content.indexOf("<!--");

	while (start !== -1)
	{
		const end = content.indexOf("-->", start + 4);

		if (end === -1) break;

		output += content.slice(copied, start);
		copied = end + 3;
		start = content.indexOf("<!--", copied);
	}

	return output + content.slice(copied);
}

/**
 * @description Skips SVG whitespace.
 * @param {string} content - SVG.
 * @param {number} index - Where to start.
 * @return {number} Index of the first other character, or the string's length.
 */
function skipSvgSpace__(content, index)
{
	let end = index;

	while (end < content.length && SVG_SPACE__.includes(content[end])) end++;

	return end;
}

/**
 * @description Strips SVG comments.
 * @param {string} content - SVG.
 * @return {string} The SVG without comments.
 */
function stripSvgComments__(content)
{
	let output = "";
	let copied = 0;
	let start = content.indexOf("<!");

	while (start !== -1)
	{
		const open = skipSvgSpace__(content, start + 2);
		let next = start + 1;

		if (content.startsWith("--", open))
		{
			const close = content.indexOf("--", open + 2);

			if (close === -1) break;

			const gt = skipSvgSpace__(content, close + 2);

			if (content[gt] === ">")
			{
				output += content.slice(copied, start);
				copied = gt + 1;
				next = gt + 1;
			}
		}

		start = content.indexOf("<!", next);
	}

	return output + content.slice(copied);
}

export { stripHtmlCommentsOnce__, stripSvgComments__ };
