import { lineEnd__ } from "./JsComments.js";

const WHITESPACE__ = /\s/u;
const NON_WHITESPACE__ = /\S/gu;
const IDENTIFIER_START__ = /[\w$#\\\u0080-\uFFFF]/u;
const IDENTIFIER_PART__ = /[\w$\\\u0080-\uFFFF]/u;
const UNICODE_ESCAPE__ = /\\u(?:[\dA-Fa-f]{4}|\{[\dA-Fa-f]+\})/uy;
const NUMBER__ = /0[BOXbox][\dA-F_a-f]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[Ee][+-]?\d[\d_]*)?n?/uy;

const KEYWORDS__ = new Set([
	"case",
	"catch",
	"class",
	"default",
	"delete",
	"do",
	"else",
	"extends",
	"finally",
	"for",
	"if",
	"in",
	"instanceof",
	"new",
	"return",
	"switch",
	"throw",
	"try",
	"typeof",
	"void",
	"while",
	"with"
]);
const CONTEXTUAL_WORDS__ = new Set(["await", "of", "yield"]);
const STATEMENT_END_WORDS__ = new Set(["break", "continue", "debugger"]);
const CONTROL_WORDS__ = new Set(["for", "if", "while", "with"]);
const BLOCK_HEAD_WORDS__ = new Set(["catch", "for", "if", "switch", "while", "with"]);
const KEYWORD_BRACES__ = new Map([
	["catch", "block"],
	["do", "block"],
	["else", "block"],
	["finally", "block"],
	["try", "block"],
	["case", "expression"],
	["default", "expression"],
	["delete", "expression"],
	["in", "expression"],
	["instanceof", "expression"],
	["new", "expression"],
	["return", "expression"],
	["throw", "expression"],
	["typeof", "expression"],
	["void", "expression"]
]);
const PUNCTUATOR_BRACES__ = new Map([
	[";", "block"],
	["{", "block"],
	["=>", "block"],
	[":", "uncertain"]
]);
const SLASH_AFTER_BRACE__ = new Map([
	["block", true],
	["expression", false],
	["uncertain", null]
]);
const OPERAND_TYPES__ = new Set(["closeBracket", "closeParen", "identifier", "number", "regex", "string", "template"]);
const START__ = { type: "start" };
const NO_OPENER__ = { opener: "" };

/**
 * @description Tells whether a UTF-16 code is a JS line terminator.
 * @param {number} code - Character code.
 * @return {boolean} True for LF, CR, U+2028 and U+2029.
 */
function _isLineTerminator__(code)
{
	return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * @description Tells whether a UTF-16 code is an ASCII digit.
 * @param {number} code - Character code.
 * @return {boolean} True for 0 to 9.
 */
function _isDigit__(code)
{
	return code >= 48 && code <= 57;
}

/**
 * @description Tells whether a character can continue an identifier, a regex flag run included.
 * @param {string} char - One UTF-16 code unit.
 * @return {boolean} True for identifier characters that are not whitespace.
 */
function _isIdentifierPart__(char)
{
	return IDENTIFIER_PART__.test(char) && !WHITESPACE__.test(char);
}

/**
 * @description Records a token as the previous one, ending at the scan position.
 * @param {Object} state - Scan state.
 * @param {Object} token - Token kind and the details the slash and brace rules read.
 * @return {boolean} True: the scan goes on.
 */
function _emit__(state, token)
{
	state.beforePrevious = state.previous;
	state.previous = token;
	state.tokenEnd = state.index;

	return true;
}

/**
 * @description Records a protected span.
 * @param {Object} state - Scan state.
 * @param {number} start - First index of the span.
 * @param {number} end - Index after the span.
 */
function _protect__(state, start, end)
{
	state.protectedSpans.push(start, end);
}

/**
 * @description Takes the innermost open bracket off the stack.
 * @param {Object} state - Scan state.
 * @return {Object} The bracket, or one with an empty opener when none is open.
 */
function _popOpener__(state)
{
	return state.openers.length > 0 ? state.openers.pop() : NO_OPENER__;
}

/**
 * @description Tells whether a line terminator lies between two indexes.
 * @param {Object} state - Scan state.
 * @param {number} from - First index to check; never less than in an earlier call.
 * @param {number} to - Index after the last one to check.
 * @return {boolean} True when one does.
 */
function _lineBreakBetween__(state, from, to)
{
	if (state.lineBreak < from)
	{
		state.lineBreak = lineEnd__(state.content, from);
	}

	return state.lineBreak < to;
}

/**
 * @description Decides what a "/" after the given token starts.
 * @param {Object} previous - Previous token.
 * @return {?boolean} True for a regex, false for division, null when unsure.
 */
function _slashStartsRegex__(previous)
{
	switch (previous.type)
	{
		case "start":
		case "punctuator":
		case "keyword":
			return true;
		case "contextual":
		case "increment":
		case "statementEnd":
		case "label":
			return null;
		case "closeParen":
			return previous.control;
		case "closeBrace":
			return SLASH_AFTER_BRACE__.get(previous.kind);
		default:
			return false;
	}
}

/**
 * @description Decides what a "{" after the given token opens.
 * @param {Object} previous - Previous token.
 * @return {string} The brace kind: block, expression or uncertain.
 */
function _braceKind__(previous)
{
	switch (previous.type)
	{
		case "start":
		case "closeBrace":
			return "block";
		case "closeParen":
			return previous.block ? "block" : "uncertain";
		case "keyword":
			return KEYWORD_BRACES__.get(previous.value) || "uncertain";
		case "contextual":
			return previous.value === "of" ? "uncertain" : "expression";
		case "punctuator":
			return PUNCTUATOR_BRACES__.get(previous.value) || "expression";
		default:
			return "uncertain";
	}
}

/**
 * @description Classifies an identifier name by what it means for a following "/" or "{".
 * @param {string} word - The identifier name.
 * @param {Object} previous - Token before it.
 * @param {boolean} lineBreak - Whether a line terminator lies between the previous token and the word.
 * @return {string} The token type.
 */
function _wordType__(word, previous, lineBreak)
{
	if (previous.type === "punctuator" && (previous.value === "." || previous.value === "?.")) return "identifier";
	if (STATEMENT_END_WORDS__.has(word)) return "statementEnd";
	if (previous.type === "statementEnd" && previous.value !== "debugger" && !lineBreak) return "label";
	if (CONTEXTUAL_WORDS__.has(word)) return "contextual";
	if (KEYWORDS__.has(word)) return "keyword";

	return "identifier";
}

/**
 * @description Scans template characters up to the closing backtick or the next "${".
 * @param {Object} state - Scan state, just after the backtick or the "}" that closes a "${".
 * @return {boolean} False when the template is open at the end of the input.
 */
function _scanTemplate__(state)
{
	const { content } = state;
	const start = state.index;
	let index = start;

	while (index < content.length)
	{
		const code = content.charCodeAt(index);

		if (code === 96)
		{
			_protect__(state, start, index);
			state.index = index + 1;

			return _emit__(state, { type: "template" });
		}

		if (code === 36 && content.charCodeAt(index + 1) === 123)
		{
			_protect__(state, start, index);
			state.index = index + 2;
			state.openers.push({ opener: "${" });

			return _emit__(state, {
				type: "punctuator",
				value: "${"
			});
		}

		index += code === 92 ? 2 : 1;
	}

	return false;
}

/**
 * @description Scans a string literal.
 * @param {Object} state - Scan state, at the opening quote.
 * @param {number} quote - Character code of the quote.
 * @return {boolean} False when the string is not closed on its line.
 */
function _scanString__(state, quote)
{
	const { content } = state;
	const start = state.index;
	let index = start + 1;

	while (index < content.length)
	{
		const code = content.charCodeAt(index);

		if (code === quote)
		{
			state.index = index + 1;
			_protect__(state, start, state.index);

			return _emit__(state, { type: "string" });
		}

		if (code === 10 || code === 13) return false;

		if (code === 92)
		{
			index += content.startsWith("\r\n", index + 1) ? 3 : 2;
		}
		else
		{
			index++;
		}
	}

	return false;
}

/**
 * @description Finds the "/" that closes a regex literal body.
 * @param {string} content - JS source.
 * @param {number} from - Index after the opening "/".
 * @return {number} Index of the closing "/", or -1 when the body meets a line terminator or the end.
 */
function _regexClose__(content, from)
{
	let index = from;
	let inClass = false;

	while (index < content.length)
	{
		const code = content.charCodeAt(index);

		if (_isLineTerminator__(code)) return -1;
		if (code === 47 && !inClass) return index;

		if (code === 92)
		{
			if (_isLineTerminator__(content.charCodeAt(index + 1))) return -1;

			index++;
		}
		else if (code === 91)
		{
			inClass = true;
		}
		else if (code === 93)
		{
			inClass = false;
		}

		index++;
	}

	return -1;
}

/**
 * @description Scans a regex literal with its flags.
 * @param {Object} state - Scan state, at the opening "/".
 * @return {boolean} False when the regex is not closed on its line.
 */
function _scanRegex__(state)
{
	const { content } = state;
	const start = state.index;
	const close = _regexClose__(content, start + 1);

	if (close === -1) return false;

	let index = close + 1;

	while (index < content.length && _isIdentifierPart__(content[index]))
	{
		index++;
	}

	state.index = index;
	_protect__(state, start, index);

	return _emit__(state, { type: "regex" });
}

/**
 * @description Scans a "/": a comment, a regex or a division.
 * @param {Object} state - Scan state, at the "/".
 * @return {boolean} False when the input is ambiguous or broken there.
 */
function _scanSlash__(state)
{
	const { content, index } = state;
	const next = content.charCodeAt(index + 1);

	if (next === 47)
	{
		state.commentStarts.add(index);
		state.index = lineEnd__(content, index + 2);

		return true;
	}

	if (next === 42)
	{
		const close = content.indexOf("*/", index + 2);

		if (close === -1) return false;

		state.commentStarts.add(index);
		state.index = close + 2;

		return true;
	}

	const regex = _slashStartsRegex__(state.previous);

	if (regex === null) return false;
	if (regex) return _scanRegex__(state);

	state.index += next === 61 ? 2 : 1;

	return _emit__(state, {
		type: "punctuator",
		value: "/"
	});
}

/**
 * @description Scans an identifier name, keywords included; a backslash that does not start a Unicode escape refuses.
 * @param {Object} state - Scan state, at its first character.
 * @return {boolean} False on a backslash that is not a Unicode escape, else true.
 */
function _scanWord__(state)
{
	const { content } = state;
	const start = state.index;
	let index = start;

	do
	{
		if (content.charCodeAt(index) === 92)
		{
			UNICODE_ESCAPE__.lastIndex = index;

			const escape = UNICODE_ESCAPE__.exec(content);

			if (escape === null) return false;
			index += escape[0].length;
		}
		else
		{
			index++;
		}
	}
	while (index < content.length && _isIdentifierPart__(content[index]));

	const word = content.slice(start, index);

	state.index = index;

	return _emit__(state, {
		type: _wordType__(word, state.previous, state.previous.type === "statementEnd" && _lineBreakBetween__(state, state.tokenEnd, start)),
		value: word
	});
}

/**
 * @description Scans a numeric literal.
 * @param {Object} state - Scan state, at a digit or at a "." before a digit.
 * @return {boolean} True: the scan goes on.
 */
function _scanNumber__(state)
{
	NUMBER__.lastIndex = state.index;
	state.index += NUMBER__.exec(state.content)[0].length;

	return _emit__(state, { type: "number" });
}

/**
 * @description Opens a parenthesis, noting whether it follows a control keyword.
 * @param {Object} state - Scan state, at the "(".
 * @return {boolean} True: the scan goes on.
 */
function _openParen__(state)
{
	const { beforePrevious, previous } = state;
	let word = previous.type === "keyword" ? previous.value : "";

	if (previous.type === "contextual" && previous.value === "await" && beforePrevious.type === "keyword" && beforePrevious.value === "for")
	{
		word = "for";
	}

	state.openers.push({
		opener: "(",
		control: CONTROL_WORDS__.has(word),
		block: BLOCK_HEAD_WORDS__.has(word)
	});
	state.index++;

	return _emit__(state, {
		type: "punctuator",
		value: "("
	});
}

/**
 * @description Closes the innermost bracket.
 * @param {Object} state - Scan state, at the ")", "]" or "}".
 * @return {boolean} False when the closer does not match the innermost open bracket.
 */
function _closeBracket__(state)
{
	const closer = state.content[state.index];
	const open = _popOpener__(state);

	state.index++;

	if (closer === "}" && open.opener === "${") return _scanTemplate__(state);
	if (closer === ")" && open.opener === "(")
	{
		return _emit__(state, {
			type: "closeParen",
			control: open.control,
			block: open.block
		});
	}

	if (closer === "]" && open.opener === "[") return _emit__(state, { type: "closeBracket" });
	if (closer === "}" && open.opener === "{")
	{
		return _emit__(state, {
			type: "closeBrace",
			kind: open.kind
		});
	}

	return false;
}

/**
 * @description Tells whether a line break follows return, yield or await, where ASI may end the statement.
 * @param {Object} state - Scan state, at the token after it.
 * @return {boolean} True when the previous token is one of them and a line terminator follows it.
 */
function _restrictedBreak__(state)
{
	const { previous } = state;
	const restricted = (previous.type === "keyword" && previous.value === "return") || (previous.type === "contextual" && previous.value !== "of");

	return restricted && _lineBreakBetween__(state, state.tokenEnd, state.index);
}

/**
 * @description Scans "++" or "--", or refuses an HTML-like "-->" comment.
 * @param {Object} state - Scan state, at the operator.
 * @return {boolean} False at a "-->" that only whitespace and comments separate from a line start.
 */
function _scanIncrement__(state)
{
	const { content, index, previous } = state;

	if (content.startsWith("-->", index) && (state.tokenEnd === -1 || _lineBreakBetween__(state, state.tokenEnd, index))) return false;

	state.index += 2;

	if (previous.type === "contextual") return _emit__(state, { type: "increment" });
	if (OPERAND_TYPES__.has(previous.type) && !previous.control && !_lineBreakBetween__(state, state.tokenEnd, index)) return _emit__(state, { type: "postfix" });

	return _emit__(state, {
		type: "punctuator",
		value: content.slice(index, index + 2)
	});
}

/**
 * @description Scans a punctuator.
 * @param {Object} state - Scan state, at the punctuator.
 * @return {boolean} False when the input is ambiguous or broken there.
 */
function _scanPunctuator__(state)
{
	const { content, index } = state;
	const char = content[index];
	const pair = content.slice(index, index + 2);

	if (char === ")" || char === "]" || char === "}") return _closeBracket__(state);
	if (char === "(") return _openParen__(state);
	if (char === "[") state.openers.push({ opener: "[" });
	if (char === "{")
	{
		state.openers.push({
			opener: "{",
			kind: _restrictedBreak__(state) ? "uncertain" : _braceKind__(state.previous)
		});
	}

	if (content.startsWith("<!--", index)) return false;
	if (pair === "++" || pair === "--") return _scanIncrement__(state);

	let length = pair === "=>" || (pair === "?." && !_isDigit__(content.charCodeAt(index + 2))) ? 2 : 1;

	if (content.startsWith("...", index)) length = 3;

	state.index += length;

	return _emit__(state, {
		type: "punctuator",
		value: content.slice(index, index + length)
	});
}

/**
 * @description Scans the next token, comment or whitespace run.
 * @param {Object} state - Scan state.
 * @return {boolean} False when the input is ambiguous or broken there.
 */
function _scanNext__(state)
{
	const { content, index } = state;
	const char = content[index];
	const code = content.charCodeAt(index);

	if (WHITESPACE__.test(char))
	{
		NON_WHITESPACE__.lastIndex = index;
		const found = NON_WHITESPACE__.exec(content);
		state.index = found === null ? content.length : found.index;

		return true;
	}

	if (code === 47) return _scanSlash__(state);
	if (code === 34 || code === 39) return _scanString__(state, code);

	if (code === 96)
	{
		state.index++;

		return _scanTemplate__(state);
	}

	if (_isDigit__(code) || (code === 46 && _isDigit__(content.charCodeAt(index + 1)))) return _scanNumber__(state);
	if (IDENTIFIER_START__.test(char)) return _scanWord__(state);

	return _scanPunctuator__(state);
}

/**
 * @description Scans JS source for its comments and its string, template and regex spans.
 * @param {string} content - JS source.
 * @return {?Object} Comment starts (a Set) and flat, ordered protected [start, end) pairs, or null when unsure.
 */
function scanJs__(content)
{
	const state = {
		content,
		index: 0,
		previous: START__,
		beforePrevious: START__,
		tokenEnd: -1,
		lineBreak: -1,
		openers: [],
		protectedSpans: [],
		commentStarts: new Set()
	};

	if (content.startsWith("#!"))
	{
		state.commentStarts.add(0);
		state.index = lineEnd__(content, 2);
	}

	let clean = true;

	while (clean && state.index < content.length)
	{
		clean = _scanNext__(state);
	}

	if (!clean || state.openers.length > 0) return null;

	return {
		commentStarts: state.commentStarts,
		protectedSpans: state.protectedSpans
	};
}

export { scanJs__ };
