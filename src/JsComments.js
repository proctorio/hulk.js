const WHITESPACE__ = /\s/u;
const LINE_TERMINATOR__ = /[\n\r\u2028\u2029]/gu;

/**
 * @description Finds the next line end.
 * @param {string} content - Text to scan.
 * @param {number} from - First index to check.
 * @return {number} Index of the next line terminator, or content.length.
 */
function lineEnd__(content, from)
{
	LINE_TERMINATOR__.lastIndex = from;
	const found = LINE_TERMINATOR__.exec(content);

	return found === null ? content.length : found.index;
}

/**
 * @description Tells whether a comment at an index may be removed.
 * @param {?Set<number>} commentStarts - Indexes where a comment starts, or null for every index.
 * @param {number} index - Where the comment-like text starts.
 * @return {boolean} True when it may be removed.
 */
function _removable__(commentStarts, index)
{
	return commentStarts === null || commentStarts.has(index);
}

/**
 * @description Removes line-leading JS comments.
 * @param {string} content - JS source.
 * @param {?Set<number>} [commentStarts] - When given, only comments starting here are removed; others are kept and skipped.
 * @return {string} The source without its line-leading comments.
 */
function stripJsComments__(content, commentStarts = null)
{
	const pieces = [];
	let copiedTo = 0;
	let lineStart = 0;
	let closerLeft = true;

	while (lineStart < content.length)
	{
		let first = lineStart;
		while (first < content.length && WHITESPACE__.test(content[first]))
		{
			first++;
		}

		let resumeAt = first;
		if (closerLeft && content.startsWith("/*", first))
		{
			const close = content.indexOf("*/", first + 2);
			if (close === -1)
			{
				closerLeft = false;
			}
			else
			{
				resumeAt = close + 2;
				if (_removable__(commentStarts, first))
				{
					pieces.push(content.slice(copiedTo, first));
					copiedTo = resumeAt;
				}
			}
		}
		else if (content.startsWith("//", first))
		{
			resumeAt = lineEnd__(content, first + 2);
			if (_removable__(commentStarts, first))
			{
				pieces.push(content.slice(copiedTo, lineStart));
				copiedTo = resumeAt;
			}
		}

		lineStart = lineEnd__(content, resumeAt) + 1;
	}

	pieces.push(content.slice(copiedTo));

	return pieces.join("");
}

export { lineEnd__, stripJsComments__ };
