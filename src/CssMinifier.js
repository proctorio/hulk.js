import { MARK__, restoreVault__, vault__ } from "./Vault.js";

const ZERO_UNITS__ = new Set(["px", "em", "rem", "vh", "vw", "vmin", "vmax", "cm", "mm", "in", "pt", "pc", "ex", "ch"]);
const ZERO_PROPERTIES__ = new Set([
	"margin",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"padding",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"top",
	"right",
	"bottom",
	"left",
	"inset",
	"width",
	"height",
	"min-width",
	"min-height",
	"max-width",
	"max-height",
	"border",
	"border-top",
	"border-right",
	"border-bottom",
	"border-left",
	"border-width",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-radius",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-right-radius",
	"border-bottom-left-radius",
	"border-spacing",
	"outline",
	"outline-width",
	"outline-offset",
	"gap",
	"row-gap",
	"column-gap",
	"grid-gap",
	"letter-spacing",
	"word-spacing",
	"text-indent",
	"font-size",
	"vertical-align",
	"background",
	"background-position",
	"box-shadow",
	"text-shadow",
	"flex-basis"
]);
const ASCII_NAME__ = /^[-A-Za-z]+$/u;
const CHARSET__ = /^@charset "[^"]*";/u;
const UNIT_NAME__ = /^[A-Za-z]{2,4}$/u;

/**
 * @description Tells whether a code unit continues a CSS name.
 * @param {number} code - Code unit.
 * @return {boolean} True for letters, digits, "_", "-", NUL and everything from U+0080 up.
 */
function isNameCode__(code)
{
	return (code >= 0x61 && code <= 0x7A) || (code >= 0x41 && code <= 0x5A) || (code >= 0x30 && code <= 0x39) || code === 0x5F || code === 0x2D || code >= 0x80 || code === 0;
}

/**
 * @description Tells whether a code unit starts a CSS name.
 * @param {number} code - Code unit.
 * @return {boolean} True for letters, "_", NUL and everything from U+0080 up.
 */
function isNameStartCode__(code)
{
	return (code >= 0x61 && code <= 0x7A) || (code >= 0x41 && code <= 0x5A) || code === 0x5F || code >= 0x80 || code === 0;
}

/**
 * @description Tells whether a code unit is a decimal digit.
 * @param {number} code - Code unit.
 * @return {boolean} True for 0-9.
 */
function isDigitCode__(code)
{
	return code >= 0x30 && code <= 0x39;
}

/**
 * @description Tells whether a code unit is a hex digit.
 * @param {number} code - Code unit.
 * @return {boolean} True for 0-9, a-f and A-F.
 */
function isHexCode__(code)
{
	return isDigitCode__(code) || (code >= 0x61 && code <= 0x66) || (code >= 0x41 && code <= 0x46);
}

/**
 * @description Tells whether a code unit is CSS whitespace.
 * @param {number} code - Code unit.
 * @return {boolean} True for space, tab, LF, FF and CR.
 */
function isWhitespaceCode__(code)
{
	return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0C || code === 0x0D;
}

/**
 * @description Tells whether a code unit is a CSS newline.
 * @param {number} code - Code unit.
 * @return {boolean} True for LF, FF and CR.
 */
function isNewlineCode__(code)
{
	return code === 0x0A || code === 0x0C || code === 0x0D;
}

/**
 * @description Tells whether a backslash starts a valid CSS escape.
 * @param {string} content - CSS.
 * @param {number} index - Index to test.
 * @return {boolean} True when the index holds a backslash not followed by a newline.
 */
function isEscape__(content, index)
{
	return content.charCodeAt(index) === 0x5C && !isNewlineCode__(content.charCodeAt(index + 1));
}

/**
 * @description Tells whether an identifier starts at an index.
 * @param {string} content - CSS.
 * @param {number} index - Index to test.
 * @return {boolean} True when a name start, an escape, or "-" followed by either or by "-" is there.
 */
function startsIdentifier__(content, index)
{
	const code = content.charCodeAt(index);

	if (code === 0x2D)
	{
		const next = content.charCodeAt(index + 1);

		return isNameStartCode__(next) || next === 0x2D || isEscape__(content, index + 1);
	}

	return isNameStartCode__(code) || isEscape__(content, index);
}

/**
 * @description Tells whether a number token starts at an index.
 * @param {string} content - CSS.
 * @param {number} index - Index to test.
 * @return {boolean} True for a digit, or a sign or "." that a digit completes.
 */
function startsNumber__(content, index)
{
	const code = content.charCodeAt(index);
	const next = content.charCodeAt(index + 1);

	if (code === 0x2B || code === 0x2D) return isDigitCode__(next) || (next === 0x2E && isDigitCode__(content.charCodeAt(index + 2)));

	return isDigitCode__(code) || (code === 0x2E && isDigitCode__(next));
}

/**
 * @description Finds the end of a run of digits.
 * @param {string} content - CSS.
 * @param {number} index - First index to test.
 * @return {number} Index of the first non-digit.
 */
function digitsEnd__(content, index)
{
	let end = index;

	while (isDigitCode__(content.charCodeAt(end))) end++;

	return end;
}

/**
 * @description Finds the end of the numeric part of a number token.
 * @param {string} content - CSS.
 * @param {number} index - Where the number starts.
 * @return {number} Index after its sign, digits, fraction and exponent.
 */
function numberEnd__(content, index)
{
	const sign = content.charCodeAt(index);
	let end = digitsEnd__(content, sign === 0x2B || sign === 0x2D ? index + 1 : index);

	if (content.charCodeAt(end) === 0x2E && isDigitCode__(content.charCodeAt(end + 1))) end = digitsEnd__(content, end + 1);

	const exponent = content.charCodeAt(end);

	if (exponent === 0x45 || exponent === 0x65)
	{
		const exponentSign = content.charCodeAt(end + 1);
		const digits = exponentSign === 0x2B || exponentSign === 0x2D ? end + 2 : end + 1;

		if (isDigitCode__(content.charCodeAt(digits))) end = digitsEnd__(content, digits);
	}

	return end;
}

/**
 * @description Finds the end of an escape.
 * @param {string} content - CSS.
 * @param {number} index - Index of the backslash.
 * @return {number} Index after 1-6 hex digits and one optional whitespace (CRLF as one), or after the escaped character.
 */
function escapeEnd__(content, index)
{
	const first = content.charCodeAt(index + 1);
	let end = index + 1;

	if (isHexCode__(first))
	{
		while (end < index + 7 && isHexCode__(content.charCodeAt(end))) end++;

		const after = content.charCodeAt(end);

		if (after === 0x0D && content.charCodeAt(end + 1) === 0x0A) return end + 2;

		return isWhitespaceCode__(after) ? end + 1 : end;
	}

	const second = content.charCodeAt(index + 2);

	if ((first === 0x0D && second === 0x0A) || (first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF)) return index + 3;

	return Math.min(index + 2, content.length);
}

/**
 * @description Finds the end of a string token.
 * @param {string} content - CSS.
 * @param {number} index - Index of the opening quote.
 * @return {number} Index after the closing quote, after the newline that ends a bad string (CRLF as one), or the length.
 */
function stringEnd__(content, index)
{
	const quote = content.charCodeAt(index);
	let end = index + 1;

	while (end < content.length)
	{
		const code = content.charCodeAt(end);

		if (code === quote) return end + 1;

		if (code === 0x5C)
		{
			end += content.charCodeAt(end + 1) === 0x0D && content.charCodeAt(end + 2) === 0x0A ? 3 : 2;
		}
		else if (isNewlineCode__(code))
		{
			return code === 0x0D && content.charCodeAt(end + 1) === 0x0A ? end + 2 : end + 1;
		}
		else
		{
			end++;
		}
	}

	return content.length;
}

/**
 * @description Finds the end of an unquoted url( body.
 * @param {string} content - CSS.
 * @param {number} index - Index after the "(".
 * @return {number} Index after the first unescaped ")", or the length.
 */
function urlEnd__(content, index)
{
	let end = index;

	while (end < content.length)
	{
		const code = content.charCodeAt(end);

		if (code === 0x29) return end + 1;

		end += isEscape__(content, end) ? 2 : 1;
	}

	return content.length;
}

/**
 * @description Tells whether a url( argument is a quoted string.
 * @param {string} content - CSS.
 * @param {number} index - Index after the "(".
 * @return {boolean} True when the first non-whitespace character is a quote.
 */
function isQuotedUrl__(content, index)
{
	let end = index;

	while (isWhitespaceCode__(content.charCodeAt(end))) end++;

	const code = content.charCodeAt(end);

	return code === 0x22 || code === 0x27;
}

/**
 * @description Lowercases an ASCII name.
 * @param {string} text - Name.
 * @return {string} The name in lowercase, or "" when it is not letters and "-" only.
 */
function asciiLower__(text)
{
	return ASCII_NAME__.test(text) ? text.toLowerCase() : "";
}

/**
 * @description Strips CSS whitespace from both ends.
 * @param {string} text - Text.
 * @return {string} The text without leading or trailing CSS whitespace.
 */
function trimCss__(text)
{
	let start = 0;
	let end = text.length;

	while (start < end && isWhitespaceCode__(text.charCodeAt(start))) start++;
	while (end > start && isWhitespaceCode__(text.charCodeAt(end - 1))) end--;

	return text.slice(start, end);
}

/**
 * @description Tells whether a "0" + unit dimension may lose its unit, by what follows it.
 * @param {string} content - CSS.
 * @param {number} index - Index after the unit.
 * @return {boolean} True for the end of the input, CSS whitespace, ";", "}", ",", "!", or a "/" that does not open a comment.
 */
function endsZeroUnit__(content, index)
{
	const code = content.charCodeAt(index);

	if (code === 0x2F) return content.charCodeAt(index + 1) !== 0x2A;

	return index >= content.length || isWhitespaceCode__(code) || code === 0x3B || code === 0x7D || code === 0x2C || code === 0x21;
}

/**
 * @description Tells whether a hash name is six hex digits in pairs that may become three.
 * @param {string} content - CSS.
 * @param {number} start - Index after the "#".
 * @param {number} end - Index after the name.
 * @return {boolean} True when the name is exactly six hex digits in equal pairs and no comment or backslash follows.
 */
function isShortHex__(content, start, end)
{
	if (end - start !== 6 || content.charCodeAt(end) === 0x5C || content.startsWith("/*", end)) return false;

	for (let index = start; index < end; index += 2)
	{
		if (!isHexCode__(content.charCodeAt(index)) || content[index] !== content[index + 1]) return false;
	}

	return true;
}

/**
 * @description Creates the scanner state.
 * @param {string} content - CSS.
 * @param {Array<string>} spans - The vault.
 * @return {Object} The state.
 */
function createState__(content, spans)
{
	return {
		content,
		spans,
		parts: [],
		index: 0,
		copied: 0,
		last: "",
		pending: false,
		stack: [],
		top: "",
		blocks: [],
		block: "",
		parens: 0,
		noHex: 0,
		verbatim: -1,
		verbatimBase: 0,
		verbatimValue: false,
		verbatimLast: 0,
		valuePending: false,
		segmentStart: 0,
		colon: false,
		hexOk: false,
		zeroOk: false,
		candidates: [],
		spaces: [],
		runEnd: 0,
		runEscaped: false
	};
}

/**
 * @description Copies the uncopied input up to an index into the output.
 * @param {Object} state - Scanner state.
 * @param {number} upTo - End of the copy.
 */
function flush__(state, upTo)
{
	if (upTo > state.copied) state.parts.push(state.content.slice(state.copied, upTo));
	state.copied = upTo;
}

/**
 * @description Vaults an input span and emits its marker.
 * @param {Object} state - Scanner state.
 * @param {number} start - Start of the span.
 * @param {number} end - End of the span.
 */
function emitVault__(state, start, end)
{
	flush__(state, start);
	state.parts.push(vault__(state.spans, state.content.slice(start, end)));
	state.copied = end;
	state.index = end;
	state.last = MARK__;
}

/**
 * @description Passes a token through: vaulted in normal mode, skipped inside a verbatim span.
 * @param {Object} state - Scanner state.
 * @param {number} end - End of the token.
 */
function opaque__(state, end)
{
	if (state.verbatim === -1) emitVault__(state, state.index, end);
	state.index = end;
}

/**
 * @description Emits a name run as it is, with each escape in it vaulted.
 * @param {Object} state - Scanner state.
 * @param {number} start - Start of the run.
 * @param {number} end - End of the run.
 * @param {boolean} escaped - Whether the run holds an escape.
 */
function emitRun__(state, start, end, escaped)
{
	let index = start;

	if (!escaped)
	{
		if (end > start) state.last = state.content[end - 1];
		state.index = end;

		return;
	}

	while (index < end)
	{
		if (state.content.charCodeAt(index) === 0x5C)
		{
			const escapeEnd = escapeEnd__(state.content, index);

			emitVault__(state, index, escapeEnd);
			index = escapeEnd;
		}
		else
		{
			index++;
			state.last = state.content[index - 1];
		}
	}

	state.index = end;
}

/**
 * @description Reads a name run (name characters and escapes) into state.runEnd and state.runEscaped.
 * @param {Object} state - Scanner state.
 * @param {number} start - Start of the run.
 */
function readRun__(state, start)
{
	const content = state.content;
	let end = start;
	let escaped = false;

	while (end < content.length)
	{
		if (isNameCode__(content.charCodeAt(end)))
		{
			end++;
		}
		else if (isEscape__(content, end))
		{
			end = escapeEnd__(content, end);
			escaped = true;
		}
		else
		{
			break;
		}
	}

	state.runEnd = end;
	state.runEscaped = escaped;
}

/**
 * @description Opens a bracket frame.
 * @param {Object} state - Scanner state.
 * @param {string} frame - "(" "[" "{", "E" for a paren whose hashes are never shortened, "B" for a rule block.
 */
function push__(state, frame)
{
	state.stack.push(state.top);
	state.top = frame;
	if (frame !== "B") state.parens++;
	if (frame === "E") state.noHex++;
}

/**
 * @description Closes the innermost bracket frame.
 * @param {Object} state - Scanner state.
 */
function pop__(state)
{
	const frame = state.top;

	state.top = state.stack.pop();
	if (frame !== "B") state.parens--;
	if (frame === "E") state.noHex--;
	if (frame === "B") state.block = state.blocks.pop();
}

/**
 * @description Starts a span that is vaulted verbatim when it ends.
 * @param {Object} state - Scanner state.
 * @param {boolean} value - True for a declaration value (ends before its top-level ";" or "}"), false for a bracket group.
 */
function startVerbatim__(state, value)
{
	flush__(state, state.index);
	state.verbatim = state.index;
	state.verbatimBase = state.stack.length;
	state.verbatimValue = value;
	state.verbatimLast = state.index;
}

/**
 * @description Ends a verbatim bracket group after its closer, or at the end of the input.
 * @param {Object} state - Scanner state.
 */
function endGroup__(state)
{
	state.parts.push(vault__(state.spans, state.content.slice(state.verbatim, state.index)));
	state.verbatim = -1;
	state.copied = state.index;
	state.last = MARK__;
}

/**
 * @description Ends a verbatim declaration value after its last token; the whitespace after it is scanned again.
 * @param {Object} state - Scanner state.
 */
function endValue__(state)
{
	const end = state.verbatimLast;

	state.parts.push(vault__(state.spans, state.content.slice(state.verbatim, end)));
	state.verbatim = -1;
	state.copied = end;
	state.index = end;
	state.last = MARK__;
}

/**
 * @description Starts a new segment (the text after an unescaped "{", "}" or ";" outside parens).
 * @param {Object} state - Scanner state.
 */
function resetSegment__(state)
{
	flush__(state, state.index);
	state.segmentStart = state.parts.length;
	state.colon = false;
	state.hexOk = false;
	state.zeroOk = false;
	state.candidates = [];
	state.spaces = [];
	state.valuePending = false;
}

/**
 * @description Turns the whitespace and comments recorded after a ":" of the current segment into one space.
 * @param {Object} state - Scanner state.
 * @param {boolean} all - Whether runs recorded outside a block, or inside brackets, count too.
 */
function dropSpaces__(state, all)
{
	for (const [part, topLevel] of state.spaces) if (all || topLevel) state.parts[part] = " ";
	state.spaces = [];
}

/**
 * @description Applies the hex, zero-unit and colon-space edits recorded in a segment that ended as a declaration in a block.
 * @param {Object} state - Scanner state.
 */
function commit__(state)
{
	for (const [part, text] of state.candidates) state.parts[part] = text;
	state.candidates = [];
	dropSpaces__(state, false);
}

/**
 * @description After a ":", vaults the whitespace and comments up to the next token; a declaration, outside brackets, drops them.
 * @param {Object} state - Scanner state, just after the ":".
 */
function colonSpace__(state)
{
	const { content } = state;
	let end = state.index;

	for (;;)
	{
		while (end < content.length && isWhitespaceCode__(content.charCodeAt(end))) end++;

		const close = content.startsWith("/*", end) ? content.indexOf("*/", end + 2) : -1;

		if (close === -1) break;
		end = close + 2;
	}

	if (end === state.index) return;

	flush__(state, state.index);
	state.spaces.push([state.parts.length, state.block !== "" && state.parens === 0]);
	state.parts.push(vault__(state.spans, content.slice(state.index, end)));
	state.copied = end;
	state.index = end;
}

/**
 * @description Returns the output text of the current segment so far.
 * @param {Object} state - Scanner state.
 * @return {string} The segment's text, trimmed of CSS whitespace.
 */
function segmentText__(state)
{
	flush__(state, state.index);

	return trimCss__(state.parts.slice(state.segmentStart).join(""));
}

/**
 * @description Classifies a declaration at its first ":" outside parens.
 * @param {Object} state - Scanner state.
 */
function colon__(state)
{
	const name = segmentText__(state);

	state.colon = true;
	if (state.block === "") return;

	if (name.includes(MARK__) || name.startsWith("--") || (state.block === "P" && asciiLower__(name) === "initial-value"))
	{
		state.valuePending = true;
	}
	else if (state.block === "S")
	{
		state.hexOk = true;
		state.zeroOk = ZERO_PROPERTIES__.has(asciiLower__(name));
	}
}

/**
 * @description Finds where a rule prelude starts once the CDO and CDC tokens a stylesheet ignores are skipped.
 * @param {string} prelude - Trimmed prelude text.
 * @return {number} Index of the prelude's first significant character.
 */
function preludeStart__(prelude)
{
	let index = 0;

	for (;;)
	{
		while (index < prelude.length && isWhitespaceCode__(prelude.charCodeAt(index))) index++;

		if (prelude.startsWith("<!--", index)) index += 4;
		else if (prelude.startsWith("-->", index)) index += 3;
		else return index;
	}
}

/**
 * @description Reads an at-rule's name, escape markers included.
 * @param {string} prelude - Trimmed prelude text, escapes vaulted.
 * @param {number} start - Index after the "@".
 * @return {string} The name as written.
 */
function atRuleName__(prelude, start)
{
	let end = start;

	while (end < prelude.length && (isNameCode__(prelude.charCodeAt(end)) || prelude.charCodeAt(end) === 1)) end++;

	return prelude.slice(start, end);
}

/**
 * @description Handles "{": a rule block, or a {} group inside brackets (vaulted verbatim).
 * @param {Object} state - Scanner state.
 */
function openBrace__(state)
{
	if (state.verbatim === -1 && state.parens > 0) startVerbatim__(state, false);

	if (state.verbatim !== -1)
	{
		push__(state, "{");
		state.index++;

		return;
	}

	const prelude = segmentText__(state);
	const at = preludeStart__(prelude);
	const name = prelude.startsWith("@", at) ? atRuleName__(prelude, at + 1) : null;
	let kind = "S";

	if (name !== null) kind = asciiLower__(name) === "property" || name.includes(MARK__) ? "P" : "A";
	if (name !== null && asciiLower__(name) === "media") dropSpaces__(state, true);
	state.blocks.push(state.block);
	state.block = kind;
	push__(state, "B");
	state.index++;
	state.last = "{";
	resetSegment__(state);
}

/**
 * @description Tells whether a closer matches the innermost frame.
 * @param {string} top - Innermost frame.
 * @param {number} code - Closer: ")", "]" or "}".
 * @return {boolean} True when the closer closes that frame.
 */
function closes__(top, code)
{
	if (code === 0x29) return top === "(" || top === "E";
	if (code === 0x5D) return top === "[";

	return top === "{" || top === "B";
}

/**
 * @description Handles ")", "]" and "}".
 * @param {Object} state - Scanner state.
 * @param {number} code - The closer.
 */
function close__(state, code)
{
	const inVerbatim = state.verbatim !== -1;

	if (inVerbatim && state.verbatimValue && code === 0x7D && state.stack.length === state.verbatimBase)
	{
		endValue__(state);

		return;
	}

	const ends = code === 0x7D && state.parens === 0;

	if (closes__(state.top, code)) pop__(state);
	state.index++;
	state.last = state.content[state.index - 1];

	if (inVerbatim)
	{
		if (!state.verbatimValue && state.stack.length === state.verbatimBase) endGroup__(state);
	}
	else if (ends)
	{
		commit__(state);
		resetSegment__(state);
	}
}

/**
 * @description Handles ";".
 * @param {Object} state - Scanner state.
 */
function semicolon__(state)
{
	if (state.verbatim !== -1 && state.verbatimValue && state.stack.length === state.verbatimBase)
	{
		endValue__(state);

		return;
	}

	state.index++;
	state.last = ";";

	if (state.verbatim === -1 && state.parens === 0)
	{
		commit__(state);
		resetSegment__(state);
	}
}

/**
 * @description Handles every other single character.
 * @param {Object} state - Scanner state.
 * @param {number} code - The character.
 */
function punct__(state, code)
{
	if (code === 0x7B)
	{
		openBrace__(state);
	}
	else if (code === 0x7D || code === 0x29 || code === 0x5D)
	{
		close__(state, code);
	}
	else if (code === 0x3B)
	{
		semicolon__(state);
	}
	else
	{
		if (code === 0x3A && state.verbatim === -1 && state.parens === 0 && !state.colon) colon__(state);
		if (code === 0x28) push__(state, "(");
		if (code === 0x5B) push__(state, "[");
		state.index++;
		state.last = state.content[state.index - 1];
		if (code === 0x3A && state.verbatim === -1 && !state.valuePending) colonSpace__(state);
	}
}

/**
 * @description Handles a number token with its unit: leading-zero and zero-unit edits.
 * @param {Object} state - Scanner state.
 */
function number__(state)
{
	const content = state.content;
	const start = state.index;
	const end = numberEnd__(content, start);
	let unitEnd = end;

	state.runEscaped = false;
	if (content.charCodeAt(end) === 0x25)
	{
		unitEnd = end + 1;
	}
	else if (startsIdentifier__(content, end))
	{
		readRun__(state, end);
		unitEnd = state.runEnd;
	}

	if (state.verbatim !== -1)
	{
		state.index = unitEnd;

		return;
	}

	const sign = content.charCodeAt(start) === 0x2B || content.charCodeAt(start) === 0x2D ? 1 : 0;
	const unit = content.slice(end, unitEnd);

	if (content.charCodeAt(start + sign) === 0x30 && content.charCodeAt(start + sign + 1) === 0x2E && end > start + sign + 1)
	{
		flush__(state, start);
		state.parts.push(content.slice(start, start + sign));
		state.copied = start + sign + 1;
		emitRun__(state, start + sign + 1, unitEnd, state.runEscaped);
	}
	else if (state.zeroOk && state.parens === 0 && end === start + 1 && content.charCodeAt(start) === 0x30 && !state.runEscaped && UNIT_NAME__.test(unit) && ZERO_UNITS__.has(unit.toLowerCase()) && endsZeroUnit__(content, unitEnd) && (isWhitespaceCode__(state.last.charCodeAt(0)) || state.last === ":"))
	{
		flush__(state, start);
		state.candidates.push([state.parts.length, "0"]);
		state.parts.push(content.slice(start, unitEnd));
		state.copied = unitEnd;
		emitRun__(state, start, unitEnd, false);
	}
	else
	{
		emitRun__(state, start, unitEnd, state.runEscaped);
	}
}

/**
 * @description Handles "#" and "@" with the name after them: hash tokens get the hex edit.
 * @param {Object} state - Scanner state.
 * @param {number} code - "#" or "@".
 */
function hash__(state, code)
{
	const content = state.content;
	const start = state.index;
	const named = code === 0x23 ? isNameCode__(content.charCodeAt(start + 1)) || isEscape__(content, start + 1) : startsIdentifier__(content, start + 1);

	if (!named)
	{
		punct__(state, code);

		return;
	}

	readRun__(state, start + 1);

	const end = state.runEnd;

	if (state.verbatim !== -1)
	{
		state.index = end;
	}
	else if (code === 0x23 && state.hexOk && state.noHex === 0 && !state.runEscaped && isShortHex__(content, start + 1, end))
	{
		flush__(state, start);
		state.candidates.push([state.parts.length, `#${content[start + 1]}${content[start + 3]}${content[start + 5]}`]);
		state.parts.push(content.slice(start, end));
		state.copied = end;
		emitRun__(state, start, end, false);
	}
	else
	{
		emitRun__(state, start, end, state.runEscaped);
	}
}

/**
 * @description Handles an identifier, and a function name with its "(": url( bodies and style( groups are vaulted.
 * @param {Object} state - Scanner state.
 */
function identifier__(state)
{
	const content = state.content;
	const start = state.index;

	readRun__(state, start);

	const end = state.runEnd;
	const escaped = state.runEscaped;

	if (content.charCodeAt(end) !== 0x28)
	{
		if (state.verbatim === -1) emitRun__(state, start, end, escaped);
		state.index = end;

		return;
	}

	const name = escaped || end - start > 12 ? "" : asciiLower__(content.slice(start, end));

	if (name === "url" && !isQuotedUrl__(content, end + 1))
	{
		opaque__(state, urlEnd__(content, end + 1));

		return;
	}

	if (state.verbatim === -1 && name === "style") startVerbatim__(state, false);
	if (state.verbatim === -1) emitRun__(state, start, end + 1, escaped);
	state.index = end + 1;
	push__(state, escaped || name === "element" || name === "-moz-element" ? "E" : "(");
}

/**
 * @description Dispatches one token that is not a newline run or a comment.
 * @param {Object} state - Scanner state.
 * @param {number} code - Its first character.
 */
function token__(state, code)
{
	const content = state.content;

	if (code === 1)
	{
		opaque__(state, state.index + 1);
	}
	else if (code === 0x22 || code === 0x27)
	{
		opaque__(state, stringEnd__(content, state.index));
	}
	else if (code === 0x5C && !isEscape__(content, state.index))
	{
		opaque__(state, escapeEnd__(content, state.index));
	}
	else if (startsNumber__(content, state.index))
	{
		number__(state);
	}
	else if (code === 0x23 || code === 0x40)
	{
		hash__(state, code);
	}
	else if (isNameCode__(code) || code === 0x5C)
	{
		identifier__(state);
	}
	else
	{
		punct__(state, code);
	}
}

/**
 * @description Handles a run of CR, LF and tab: nothing after an unescaped "{" "}" ";" "," or at either end, else one space.
 * @param {Object} state - Scanner state.
 */
function newlines__(state)
{
	const content = state.content;
	const start = state.index;
	let end = start + 1;

	while (end < content.length && (content.charCodeAt(end) === 0x0A || content.charCodeAt(end) === 0x0D || content.charCodeAt(end) === 0x09)) end++;
	state.index = end;
	if (state.verbatim !== -1) return;

	flush__(state, start);
	state.copied = end;
	if (state.last !== "" && !"{};,".includes(state.last)) state.pending = true;
}

/**
 * @description Handles a comment: dropped, kept inside a verbatim span; an unterminated one is vaulted to the end.
 * @param {Object} state - Scanner state.
 */
function comment__(state)
{
	const close = state.content.indexOf("*/", state.index + 2);
	const end = close === -1 ? state.content.length : close + 2;

	if (state.verbatim === -1 && close === -1)
	{
		state.pending = false;
		emitVault__(state, state.index, end);
	}
	else if (state.verbatim === -1)
	{
		flush__(state, state.index);
		state.copied = end;
	}

	state.index = end;
}

/**
 * @description Where a verbatim value ends with only whitespace after its ":", keeps one space as its value.
 * @param {Object} state - Scanner state, at the ";" or "}" that ends the value, or at the end of the input.
 */
function loneSpace__(state)
{
	if (!state.pending && state.last !== " " && state.last !== "\f") return;

	let end = state.index;

	while (end > state.copied && isWhitespaceCode__(state.content.charCodeAt(end - 1))) end--;
	flush__(state, end);
	state.copied = state.index;
	state.parts.push(" ", vault__(state.spans, " "));
	state.pending = false;
	state.last = MARK__;
}

/**
 * @description Before a token in normal mode: starts a pending verbatim value, emits a pending newline space.
 * @param {Object} state - Scanner state.
 * @param {number} code - The token's first character.
 * @param {boolean} comment - Whether the token is a comment.
 */
function prepare__(state, code, comment)
{
	const startsValue = state.valuePending && !isWhitespaceCode__(code);

	if (startsValue) state.valuePending = false;

	if (startsValue && (code === 0x3B || code === 0x7D)) loneSpace__(state);

	if (state.pending && (!comment || (startsValue && code !== 0x3B && code !== 0x7D)))
	{
		flush__(state, state.index);
		state.parts.push(" ");
		state.pending = false;
		state.last = " ";
	}

	if (startsValue && code !== 0x3B && code !== 0x7D) startVerbatim__(state, true);
}

/**
 * @description Scans one token.
 * @param {Object} state - Scanner state.
 */
function step__(state)
{
	const content = state.content;
	const code = content.charCodeAt(state.index);

	if (code === 0x0A || code === 0x0D || code === 0x09)
	{
		newlines__(state);

		return;
	}

	const comment = code === 0x2F && content.charCodeAt(state.index + 1) === 0x2A;

	if (state.verbatim === -1) prepare__(state, code, comment);

	const valueMode = state.verbatim !== -1 && state.verbatimValue;

	if (comment) comment__(state);
	else token__(state, code);

	if (valueMode && state.verbatim !== -1 && code !== 0x20 && code !== 0x0C) state.verbatimLast = state.index;
}

/**
 * @description Ends a verbatim span that is still open at the end of the input.
 * @param {Object} state - Scanner state.
 * @return {boolean} True when the scan must go on over the whitespace after a verbatim value.
 */
function endAtEof__(state)
{
	if (state.verbatim === -1) return false;

	if (state.verbatimValue)
	{
		endValue__(state);

		return true;
	}

	endGroup__(state);

	return false;
}

/**
 * @description Scans CSS: vaults what must stay byte-exact and applies the context-dependent edits.
 * @param {string} content - CSS.
 * @param {Array<string>} spans - The vault.
 * @return {string} The text with markers, ready for the global rules.
 */
function scanCss__(content, spans)
{
	const state = createState__(content, spans);

	do
	{
		while (state.index < content.length) step__(state);
	} while (endAtEof__(state));

	if (state.valuePending) loneSpace__(state);
	commit__(state);
	flush__(state, content.length);

	return state.parts.join("");
}

/**
 * @description Reads the encoding declaration a stylesheet starts with.
 * @param {string} text - CSS.
 * @return {string} The declaration, or an empty string when the text does not start with one.
 */
function charsetDeclaration__(text)
{
	const found = CHARSET__.exec(text);

	return found === null ? "" : found[0];
}

/**
 * @description Minifies CSS content; one whose minified form would start with another encoding declaration stays as written.
 * @param {string} content - Original CSS content.
 * @return {string} Minified output of the given CSS content.
 */
function minifyCss__(content)
{
	const spans = [];
	const minified = scanCss__(content, spans)
		.replaceAll(/ {2,}/gu, " ")
		.replaceAll(/ ([{:}]) /gu, "$1")
		.replaceAll(/([;,]) /gu, "$1")
		.replaceAll(" !", "!")
		.replaceAll(";}", "}")
		.replaceAll(": ", ":")
		.replaceAll(" {", "{")
		.replaceAll(/\{[\t\n\f\r ]+/gu, "{")
		.replaceAll(/(?<![\t\n\f\r ])[\t\n\f\r ]+\}/gu, "}");

	const output = restoreVault__(spans, minified);

	return charsetDeclaration__(output) === charsetDeclaration__(content) ? output : content;
}

export { minifyCss__ };
