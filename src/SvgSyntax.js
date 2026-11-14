const SPACE__ = /[\t\n\r ]*/uy;
const DOCTYPE_PLAIN__ = /[^"'>[]*/uy;
const SUBSET_PLAIN__ = /[^"'<\]]*/uy;
const DECLARATION_PLAIN__ = /[^"'>]*/uy;

/**
 * @description Runs a sticky regex at a position.
 * @param {RegExp} regex - Sticky regex.
 * @param {string} text - String to match.
 * @param {number} index - Where the match must start.
 * @return {?Array} The match, or null.
 */
function stickyAt__(regex, text, index)
{
	regex.lastIndex = index;

	return regex.exec(text);
}

/**
 * @description Skips XML whitespace.
 * @param {string} content - SVG.
 * @param {number} index - Where to start.
 * @return {number} Index of the first other character, or the string's length.
 */
function skipSpace__(content, index)
{
	return index + stickyAt__(SPACE__, content, index)[0].length;
}

/**
 * @description Finds the end of the next occurrence of a terminator.
 * @param {string} content - SVG.
 * @param {string} terminator - Text to find.
 * @param {number} index - Where the search starts.
 * @return {number} Index just after the terminator, or -1.
 */
function afterNext__(content, terminator, index)
{
	const found = content.indexOf(terminator, index);

	return found === -1 ? -1 : found + terminator.length;
}

/**
 * @description Finds the end of a quoted literal.
 * @param {string} content - SVG.
 * @param {number} index - Index of the opening quote.
 * @return {number} Index just after the closing quote, or -1.
 */
function quoteEnd__(content, index)
{
	return afterNext__(content, content[index], index + 1);
}

/**
 * @description Finds the end of a markup declaration in a DOCTYPE's internal subset.
 * @param {string} content - SVG.
 * @param {number} index - Index just after its "<".
 * @return {number} Index just after its ">", or -1.
 */
function declarationEnd__(content, index)
{
	let at = index;

	while (at !== -1)
	{
		at += stickyAt__(DECLARATION_PLAIN__, content, at)[0].length;

		if (content[at] === ">") return at + 1;
		if (content[at] !== "\"" && content[at] !== "'") return -1;

		at = quoteEnd__(content, at);
	}

	return -1;
}

/**
 * @description Finds the end of a DOCTYPE's internal subset.
 * @param {string} content - SVG.
 * @param {number} index - Index just after its "[".
 * @return {number} Index just after its "]", or -1.
 */
function subsetEnd__(content, index)
{
	let at = index;

	while (at !== -1)
	{
		at += stickyAt__(SUBSET_PLAIN__, content, at)[0].length;

		const char = content[at];

		if (char === "]") return at + 1;

		if (char === "\"" || char === "'") at = quoteEnd__(content, at);
		else if (content.startsWith("<!--", at)) at = afterNext__(content, "-->", at + 4);
		else if (content.startsWith("<?", at)) at = afterNext__(content, "?>", at + 2);
		else if (char === "<") at = declarationEnd__(content, at + 1);
		else at = -1;
	}

	return -1;
}

/**
 * @description Finds the end of a DOCTYPE declaration.
 * @param {string} content - SVG.
 * @param {number} index - Index just after "<!DOCTYPE".
 * @return {number} Index just after its ">", or -1.
 */
function doctypeEnd__(content, index)
{
	let at = index;

	while (at !== -1)
	{
		at += stickyAt__(DOCTYPE_PLAIN__, content, at)[0].length;

		const char = content[at];

		if (char === ">") return at + 1;

		if (char === "[") at = subsetEnd__(content, at + 1);
		else if (char === "\"" || char === "'") at = quoteEnd__(content, at);
		else at = -1;
	}

	return -1;
}

export { afterNext__, doctypeEnd__, skipSpace__, stickyAt__ };
