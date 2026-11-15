const VOID_ELEMENTS__ = "area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr";

const PRE_CODE_OPEN__ = /<(pre|code)\b/giu;
const PRE_CLOSE__ = /<\/pre>/giu;
const CODE_CLOSE__ = /<\/code>/giu;
const VOID_OPEN__ = new RegExp(`<(?:${VOID_ELEMENTS__})\\b`, "giu");
const HREF_SRC_OPEN__ = /(href|src)=('|")/giu;
const WHITESPACE__ = /\s/u;
const WHITESPACE_SEARCH__ = /\s/gu;
const NON_WHITESPACE_SEARCH__ = /\S/gu;
const SVG_SPACE__ = "\t\n\r ";

/**
 * @description Runs a global, quantifier-free regex from an index.
 * @param {RegExp} regex - Global regex.
 * @param {string} content - String to search.
 * @param {number} index - Where the search starts.
 * @return {?Array} The match, or null.
 */
function execFrom__(regex, content, index)
{
	regex.lastIndex = index;

	return regex.exec(content);
}

/**
 * @description Finds the next match of a global, quantifier-free regex.
 * @param {RegExp} regex - Global regex.
 * @param {string} content - String to search.
 * @param {number} index - Where the search starts.
 * @return {number} Index of the match, or -1.
 */
function searchFrom__(regex, content, index)
{
	const match = execFrom__(regex, content, index);

	return match === null ? -1 : match.index;
}

/**
 * @description Caches a forward search.
 * @param {Function} find - Forward search: index of the first hit at or after its argument, or -1.
 * @return {Function} The same search, cached.
 */
function cachedSearch__(find)
{
	let from = -1;
	let at = -1;

	return index =>
	{
		if (from === -1 || index < from || (at !== -1 && at < index))
		{
			from = index;
			at = find(index);
		}

		return at;
	};
}

/**
 * @description Strips CSS comments.
 * @param {string} content - CSS.
 * @return {string} The CSS without comments.
 */
function stripCssComments__(content)
{
	let output = "";
	let copied = 0;
	let start = content.indexOf("/*");

	while (start !== -1)
	{
		const end = content.indexOf("*/", start + 2);

		if (end === -1) break;

		output += content.slice(copied, start);
		copied = end + 2;
		start = content.indexOf("/*", copied);
	}

	return output + content.slice(copied);
}

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
 * @description Replaces each pre or code block.
 * @param {string} content - HTML.
 * @param {Function} replacer - Called with each block, in order; returns its replacement.
 * @return {string} The HTML with each block replaced.
 */
function replacePreCodeBlocks__(content, replacer)
{
	const nextGt = cachedSearch__(index => content.indexOf(">", index));
	const nextPreClose = cachedSearch__(index => searchFrom__(PRE_CLOSE__, content, index));
	const nextCodeClose = cachedSearch__(index => searchFrom__(CODE_CLOSE__, content, index));
	let output = "";
	let copied = 0;
	let from = 0;

	for (let open = execFrom__(PRE_CODE_OPEN__, content, from); open !== null; open = execFrom__(PRE_CODE_OPEN__, content, from))
	{
		const tagEnd = nextGt(open.index + open[0].length);

		if (tagEnd === -1) break;

		const name = open[1];
		const close = name.length === 3 ? nextPreClose(tagEnd + 1) : nextCodeClose(tagEnd + 1);

		if (close === -1)
		{
			from = open.index + 1;
		}
		else
		{
			const end = close + name.length + 3;

			output += content.slice(copied, open.index) + String(replacer(content.slice(open.index, end)));
			copied = end;
			from = end;
		}
	}

	return output + content.slice(copied);
}

/**
 * @description Drops the self-closing slash on HTML void elements.
 * @param {string} content - HTML.
 * @return {string} The HTML with void elements' self-closing "/" dropped.
 */
function dropVoidSelfClose__(content)
{
	const nextGt = cachedSearch__(index => content.indexOf(">", index));
	let output = "";
	let copied = 0;
	let from = 0;

	for (let open = execFrom__(VOID_OPEN__, content, from); open !== null; open = execFrom__(VOID_OPEN__, content, from))
	{
		const nameEnd = open.index + open[0].length;
		const tagEnd = nextGt(nameEnd);

		if (tagEnd === -1) break;

		if (content[tagEnd - 1] === "/")
		{
			let keep = tagEnd - 1;

			while (keep > nameEnd && WHITESPACE__.test(content[keep - 1])) keep--;

			output += content.slice(copied, keep) + ">";
			copied = tagEnd + 1;
			from = tagEnd + 1;
		}
		else
		{
			from = open.index + 1;
		}
	}

	return output + content.slice(copied);
}

/**
 * @description Finds the closing quote of an href or src value in one non-whitespace run.
 * @param {string} content - HTML.
 * @param {number} low - Lowest index the closing quote may have.
 * @param {number} end - End of the run (the first whitespace, or the string's length).
 * @return {number} Index of the closing quote, or -1.
 */
function lastClosingQuote__(content, low, end)
{
	for (let index = end - 1; index >= low; index--)
	{
		const char = content[index];

		if (char === "'" || char === "\"")
		{
			let next = "";

			if (index + 1 < end)
			{
				next = content[index + 1];
			}
			else
			{
				const after = searchFrom__(NON_WHITESPACE_SEARCH__, content, end);

				if (after !== -1) next = content[after];
			}

			if (next !== "/") return index;
		}
	}

	return -1;
}

/**
 * @description Unquotes href and src values.
 * @param {string} content - HTML.
 * @return {string} The HTML with those href and src values unquoted.
 */
function stripHrefSrcQuotes__(content)
{
	const nextWhitespace = cachedSearch__(index => searchFrom__(WHITESPACE_SEARCH__, content, index));
	let output = "";
	let copied = 0;
	let from = 0;

	let runEnd = -1;
	let runQuote = -1;

	for (let open = execFrom__(HREF_SRC_OPEN__, content, from); open !== null; open = execFrom__(HREF_SRC_OPEN__, content, from))
	{
		const quote = open.index + open[0].length - 1;
		const whitespace = nextWhitespace(quote + 1);
		const end = whitespace === -1 ? content.length : whitespace;

		if (end !== runEnd)
		{
			runEnd = end;
			runQuote = lastClosingQuote__(content, quote + 2, end);
		}

		if (runQuote >= quote + 2)
		{
			output += content.slice(copied, open.index) + open[1] + "=" + content.slice(quote + 1, runQuote);
			copied = runQuote + 1;
			from = runQuote + 1;
		}
		else
		{
			from = open.index + 1;
		}
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

export { dropVoidSelfClose__, replacePreCodeBlocks__, stripCssComments__, stripHrefSrcQuotes__, stripHtmlCommentsOnce__, stripSvgComments__ };
