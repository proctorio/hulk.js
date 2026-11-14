const WHITESPACE__ = /\s/u;
const LINE_TERMINATOR__ = /[\n\r\u2028\u2029]/gu;

/**
 * @description Finds the next line end.
 * @param {string} content - Text to scan.
 * @param {number} from - First index to check.
 * @return {number} Index of the next line terminator, or content.length.
 */
function _lineEnd__(content, from)
{
	LINE_TERMINATOR__.lastIndex = from;
	const found = LINE_TERMINATOR__.exec(content);

	return found === null ? content.length : found.index;
}

/**
 * @description Removes line-leading JS comments.
 * @param {string} content - JS source.
 * @return {string} The source without its line-leading comments.
 */
function stripJsComments__(content)
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
				pieces.push(content.slice(copiedTo, first));
				copiedTo = close + 2;
				resumeAt = copiedTo;
			}
		}
		else if (content.startsWith("//", first))
		{
			pieces.push(content.slice(copiedTo, lineStart));
			copiedTo = _lineEnd__(content, first + 2);
			resumeAt = copiedTo;
		}

		lineStart = _lineEnd__(content, resumeAt) + 1;
	}

	pieces.push(content.slice(copiedTo));

	return pieces.join("");
}

export { stripJsComments__ };
