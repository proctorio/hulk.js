import minify__ from "../src/index.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// How minifyCss__ (src/CssMinifier.js) works. The notes live here, not in src: src keeps only the JSDoc the lint
// requires, and the build strips even that from the published copy.
//
// The old minifier was a chain of global regexes over the whole stylesheet, and they rewrote what they must keep
// (WI 47101): every "#aabbcc" was shortened (selectors, url(#id), 8-digit colors, custom properties: C1), strings and
// url() bodies were collapsed (C2), newlines and tabs between two tokens were deleted (C3), and zero units were
// stripped inside calc() and custom properties (C4). One linear scan over the CSS tokens (CSS Syntax 3) now decides
// what is edited, and the global rules that are left only see the text the scan leaves exposed.
//
// - Vault (src/Vault.js): text that must stay byte-exact is replaced by U+0001 + index + U+0001 and restored after the
//   global rules. Vaulted: every string (a bad string together with the newline that ends it, CRLF as one; FF counts
//   as a newline), every escape (1-6 hex digits and one whitespace terminator, CRLF as one, or the escaped char), every
//   unquoted url( body up to its first unescaped ")", every style( ... ) group, every {...} group inside brackets, and
//   every U+0001 of the input as its own one-char span, so every U+0001 in the scanned text is a marker.
// - The scan reads whole name runs (name chars, escapes, NUL, chars from U+0080 up), whole number tokens with their
//   unit, and the name after "#" and "@". So url( is a url token only where its "u" starts an ident: "#url(", "@url(",
//   "\0url(", "1url(", "a\url(", "\41 url(" are hash, at-keyword, dimension or function tokens, and what follows them
//   is scanned as code, with its strings vaulted.
// - Comments are dropped. An unterminated "/*" and everything after it is vaulted as it is.
// - A run of \r \n \t becomes nothing after an unescaped "{" "}" ";" "," or at either end of the input, otherwise one
//   space (C3). Escaped delimiters are vaulted, so the scan never takes them for real ones.
// - Declarations: the scan tracks the block stack (style rule, at-rule, @property), the bracket depth and the current
//   segment (the text since the last "{" "}" ";" outside brackets). A segment's hex and zero-unit edits are recorded and
//   applied only when the segment ends in ";" "}" or the end of the input (a "{" makes it a prelude, left as it is),
//   only after its first ":" at bracket depth 0, inside a style rule, and when the name has no escape:
//   - Hex: "#" + exactly six hex digits in pairs, as a whole hash token (no name char or escape after it), never inside
//     element(), -moz-element(), style() or a function whose name holds an escape, and never right before "/*".
//   - Zero unit: only for the allowlisted properties (PLAN.md), at bracket depth 0, a whole "0" + unit token preceded
//     by whitespace or ":" and followed by CSS whitespace ; } , ! "/" (not "/*") or the end, never by a marker.
//   - Leading zero (everywhere in code, not just declarations): a number token whose own text starts with [+-]"0."
//     loses the 0, so "a0.5s" (an ident) and "10.0.5" (the 0 belongs to "10.0") keep theirs.
// - Custom properties ("--*"), names holding an escape (which may decode to "--*") and @property's initial-value keep
//   their value as written, from its first token to its last before the top-level ";" or "}": a style() query compares
//   its value with the property's text, and style() groups are vaulted, so both sides must stay as written. A value of
//   whitespace only keeps one space ("--x: ;"): the first custom-property grammar needed one token, so "--x:;" was
//   invalid there.
// - The global rules then run with CSS whitespace (never NBSP): space runs to one space, spaces around { : } and after
//   ; , dropped, " !" to "!", ";}" to "}", ": " to ":", " {" to "{", and whitespace after "{" and before "}" dropped.
//   The last one has a lookbehind so a long whitespace run is matched once, not again from each of its positions.
//
// Out of scope (WI 47221): a comment between two tokens that fuse once it is dropped ("opacity:1/**/0"), and function
// names spelled with escapes (u\72l( is not taken for url().

// Input size of the scaling tests, and their CPU bound (as in the MarkupScanners tests).
const SIZE__ = 524288;
const BOUND_MS__ = 3000;

// Wall-clock allowance for the scaling tests: v8 coverage and a busy machine slow them down several times over; what
// each test checks is its output and its CPU time, not this.
const TIMEOUT_MS__ = 120000;

// Every scaling input starts with this: a rule that must change (the positive control) and a char above U+00FF (V8
// keeps the string two-byte), inside a string so it cannot join the name run that follows.
const PREFIX__ = "a { color : #aabbcc; content : \"→\"; }\n";
const MINIFIED_PREFIX__ = "a{color:#abc;content:\"→\"}";

const css = input => minify__(input, "css");

/**
 * @description Checks a table of [input, expected output] pairs.
 * @param {Array<Array<string>>} cases - The pairs.
 */
function expectCases(cases)
{
	for (const [input, expected] of cases)
	{
		expect(css(input), JSON.stringify(input)).toBe(expected);
	}
}

describe("CSS plan cases (WI 47101), each red on main", () =>
{
	it("C1: a hash in a selector or a url(#id) is not a color", () =>
	{
		// positive control: a declaration's 6-digit color still shortens
		expectCases([
			["a{color:#aabbcc}", "a{color:#abc}"],
			["#ffeedd{color:red}", "#ffeedd{color:red}"],
			["#aabbcc-x{color:red}", "#aabbcc-x{color:red}"],
			["a{fill:url(#aabbcc)}", "a{fill:url(#aabbcc)}"]
		]);
	});

	it("C1: an 8-digit color keeps all its digits", () =>
	{
		expectCases([["a{color:#aabbccdd}", "a{color:#aabbccdd}"]]);
	});

	it("C1: a custom property keeps its hash", () =>
	{
		expectCases([["a{--x:#aabbcc}", "a{--x:#aabbcc}"]]);
	});

	it("C2: strings keep their spaces, comments and semicolons", () =>
	{
		expectCases([
			["a{content:\"a   b /* x */ c\"}", "a{content:\"a   b /* x */ c\"}"],
			["a{content:'/* x */'}", "a{content:'/* x */'}"],
			["a{content:\"x; y\"}", "a{content:\"x; y\"}"],
			["@font-face{font-family:\"a  b\"}", "@font-face{font-family:\"a  b\"}"]
		]);
	});

	it("C2: url() keeps its body, quoted or not", () =>
	{
		expectCases([
			["a{background:url(img0.5.png)}", "a{background:url(img0.5.png)}"],
			["a{background:url(\"a  b.css\")}", "a{background:url(\"a  b.css\")}"]
		]);
	});

	it("C3: a newline or tab run between two tokens becomes one space", () =>
	{
		expectCases([
			["a{transition:1s\n\tease}", "a{transition:1s ease}"],
			[".a\n.b{color:red}", ".a .b{color:red}"],
			["@media screen\nand (min-width:1px){a{b:c}}", "@media screen and (min-width:1px){a{b:c}}"],
			["a{width:calc(1px\n+ 2px)}", "a{width:calc(1px + 2px)}"],
			["a{grid-template-areas:\"a b\"\n\"c d\"}", "a{grid-template-areas:\"a b\" \"c d\"}"],
			["a{b:url(x)\nc}", "a{b:url(x) c}"]
		]);
	});

	it("C4: calc() keeps its zero units", () =>
	{
		expectCases([
			["a{width:calc(10px + 0px)}", "a{width:calc(10px + 0px)}"],
			["a{width:calc(100% - 0px)}", "a{width:calc(100% - 0px)}"]
		]);
	});

	it("C4: a custom property keeps its zero unit", () =>
	{
		expectCases([["a{--w:0px}", "a{--w:0px}"]]);
	});
});

describe("CSS reviewer probes (PLAN.md rounds r1-r15), each red on main", () =>
{
	it("r1: hashes in escaped selectors, font names and custom blocks stay", () =>
	{
		expectCases([
			[".a:is(#aabbcc\\;x){color:red}", ".a:is(#aabbcc\\;x){color:red}"],
			["[data-x=foo\\:\\#aabbcc\\;x]{color:red}", "[data-x=foo\\:\\#aabbcc\\;x]{color:red}"],
			["@font-face{font-family:\\#aabbcc;src:url(x)}", "@font-face{font-family:\\#aabbcc;src:url(x)}"],
			["a{--x:{color:#aabbcc}}", "a{--x:{color:#aabbcc}}"],
			["a{color:\\#aabbcc}", "a{color:\\#aabbcc}"]
		]);
	});

	it("r1: a hash followed by an escape or a non-ASCII name char is a longer name", () =>
	{
		expectCases([
			["a{color:#aabbcc\\64}", "a{color:#aabbcc\\64}"],
			["a{color:#aabbccé}", "a{color:#aabbccé}"]
		]);
	});

	it("r1: zero units stay inside math functions, escaped functions and custom blocks", () =>
	{
		expectCases([
			["a{transform:rotate(atan2( 0px, 1px))}", "a{transform:rotate(atan2( 0px,1px))}"],
			["a{width:calc-size(auto, size + 0px)}", "a{width:calc-size(auto,size + 0px)}"],
			["a{width:c\\61lc(1px + 0px)}", "a{width:c\\61lc(1px + 0px)}"],
			["a{--x:{a:0px}}", "a{--x:{a:0px}}"],
			["a{--x:(a;b:0px)}", "a{--x:(a;b:0px)}"]
		]);
	});

	it("r1: an escaped tab stays escaped", () =>
	{
		expectCases([[".a\\\tb{color:red}", ".a\\\tb{color:red}"]]);
	});

	it("r1: u\\72l( keeps its digits (a whole-token leading zero; escaped url( itself is 47221's)", () =>
	{
		expectCases([["@import u\\72l(img0.5.css);", "@import u\\72l(img0.5.css);"]]);
	});

	it("r2: a bad string keeps the newline that ends it", () =>
	{
		expectCases([
			["a{content:\"x\n}b{color:red}", "a{content:\"x\n}b{color:red}"],
			["a{b:\"x\r\n}c{d:e}", "a{b:\"x\r\n}c{d:e}"],
			["a{content:\"\\\r\n\"}", "a{content:\"\\\r\n\"}"]
		]);
	});

	it("r2: an escape keeps its whitespace terminator, and the newline after it is a combinator", () =>
	{
		expectCases([
			[".a\\31\n\n.b{color:red}", ".a\\31\n .b{color:red}"],
			[".a\\31\r\n.b{c:d}", ".a\\31\r\n.b{c:d}"]
		]);
	});

	it("a backslash before a newline is no escape, and the newline after it stays", () =>
	{
		// main deletes the newline, so the "\" escapes the next char instead
		expectCases([
			[".a\\\r\nb{c:d}", ".a\\\r\nb{c:d}"],
			["a{b:\\\n}", "a{b:\\\n}"]
		]);
	});

	it("r2, r3: escaped names, flex and @property's initial-value keep their zero units", () =>
	{
		expectCases([
			["a{\\2d-w:0px;width:calc(var(--w) + 1px)}", "a{\\2d-w:0px;width:calc(var(--w) + 1px)}"],
			["a{fl\\65x:0px}", "a{fl\\65x:0px}"],
			["a{flex:0px}", "a{flex:0px}"],
			["@property --w{syntax:\"*\";inherits:false;initial-value:0px}", "@property --w{syntax:\"*\";inherits:false;initial-value:0px}"]
		]);
	});

	it("r3, r15: the leading zero goes only from a whole number token", () =>
	{
		// positive control: whole number tokens still lose it
		expectCases([
			["a{margin:-0.5em}", "a{margin:-.5em}"],
			["a{margin:0.5em 0.25em}", "a{margin:.5em .25em}"],
			["a{animation:a0.5s}", "a{animation:a0.5s}"],
			["a{--x:a0.5s}", "a{--x:a0.5s}"],
			["keep{animation:keep0.5s}", "keep{animation:keep0.5s}"]
		]);
	});

	it("r3: NBSP is a name char, not whitespace", () =>
	{
		expectCases([["a{animation:x\u00A0}", "a{animation:x\u00A0}"]]);
	});

	it("r3: element() and -moz-element() keep the id they reference", () =>
	{
		expectCases([
			["a{background:-moz-element(#aabbcc)}", "a{background:-moz-element(#aabbcc)}"],
			["a{background:element(#aabbcc)}", "a{background:element(#aabbcc)}"]
		]);
	});

	it("r4: the 0 inside 10.0 stays", () =>
	{
		expectCases([
			["a{scale:10.0.5}", "a{scale:10.0.5}"],
			["a{--x:10.0.5s}", "a{--x:10.0.5s}"]
		]);
	});

	it("r5, r6: a custom property keeps its comment between brackets and \">\" or \"/\"", () =>
	{
		expectCases([
			["a{--x:[[]]/**/>}", "a{--x:[[]]/**/>}"],
			["a{--x:</**//StYlE>}", "a{--x:</**//StYlE>}"]
		]);
	});

	it("r8, r9: a zero unit stays when what follows would join its token", () =>
	{
		// positive control: "/" may follow (border-radius:0px/1em is two lengths either way)
		expectCases([
			["a{border-radius:0px/1em}", "a{border-radius:0/1em}"],
			["a{margin:0px.5em}", "a{margin:0px.5em}"],
			["a{margin:0px+.5em}", "a{margin:0px+.5em}"],
			["a{margin:0em/**/.5em}", "a{margin:0em.5em}"],
			["a{margin:0px%}", "a{margin:0px%}"],
			["a{margin:0pxem}", "a{margin:0pxem}"],
			["a{scale:0px.5}", "a{scale:0px.5}"],
			["a{margin:0px\\9}", "a{margin:0px\\9}"]
		]);
	});

	it("r13: a style() query keeps the hash its custom property keeps", () =>
	{
		expectCases([["a{--x:#aabbcc;color:if(style(--x:#aabbcc):red;else:blue)}", "a{--x:#aabbcc;color:if(style(--x:#aabbcc):red;else:blue)}"]]);
	});

	it("r14: font, column-width and columns are not on the zero-unit allowlist", () =>
	{
		// positive control: border and flex-basis are
		expectCases([
			["a{border:0px}", "a{border:0}"],
			["a{flex-basis:0px}", "a{flex-basis:0}"],
			["a{font:0px keep}", "a{font:0px keep}"],
			["a{font:0px/1 keep}", "a{font:0px/1 keep}"],
			["a{font:1 0px keep}", "a{font:1 0px keep}"],
			["a{font:normal 0px keep}", "a{font:normal 0px keep}"],
			["a{column-width:0px}", "a{column-width:0px}"],
			["a{columns:0px}", "a{columns:0px}"]
		]);
	});

	it("r15: an ignored declaration stays ignored", () =>
	{
		expectCases([
			["p{opacity:1;opacity:0px}", "p{opacity:1;opacity:0px}"],
			["p{order:0px}", "p{order:0px}"],
			["a{-webkit-box-shadow:0px 1px red}", "a{-webkit-box-shadow:0px 1px red}"]
		]);
	});

	it("r15: a style() query keeps the ; inside its {} block", () =>
	{
		expectCases([
			["@container style(--keep:{1;}){p{opacity:0}}", "@container style(--keep:{1;}){p{opacity:0}}"],
			["p{opacity:if(style(--keep:{1;}):0;else:1)}", "p{opacity:if(style(--keep:{1;}):0;else:1)}"]
		]);
	});
});

describe("CSS url( is a url token only at the start of an ident, each red on main", () =>
{
	it("#url( @url( NUL+url( and 1url( are no url token: the string after them stays", () =>
	{
		expectCases([
			["a{b:#url(a \"b)0.5\")}", "a{b:#url(a \"b)0.5\")}"],
			["a{b:@url(a \"b)0.5\")}", "a{b:@url(a \"b)0.5\")}"],
			["a{b:\u0000url(a \"b)0.5\")}", "a{b:\u0000url(a \"b)0.5\")}"],
			["a{b:1url(a \"b)0.5\")}", "a{b:1url(a \"b)0.5\")}"]
		]);
	});

	it("a name char or an escape before url( makes one function name", () =>
	{
		expectCases([
			["a{b:\\41 url(a \"b)0.5\")}", "a{b:\\41 url(a \"b)0.5\")}"],
			["a{b:\\url(a \"b)0.5\")}", "a{b:\\url(a \"b)0.5\")}"],
			["a{b:\\41\nurl(a \"b)0.5\")}", "a{b:\\41\nurl(a \"b)0.5\")}"],
			["a{b:\\41\r\nurl(a \"b)0.5\")}", "a{b:\\41\r\nurl(a \"b)0.5\")}"],
			["a{b:x\\41 url(a \"b)0.5\")}", "a{b:x\\41 url(a \"b)0.5\")}"],
			["a{b:\\\\url(a \"b)0.5\")}", "a{b:\\\\url(a \"b)0.5\")}"],
			["a{b:a\\url(a \"b)0.5\")}", "a{b:a\\url(a \"b)0.5\")}"],
			["a{b:éurl(a \"b)0.5\")}", "a{b:éurl(a \"b)0.5\")}"],
			["a{b:-url(a \"b)0.5\")}", "a{b:-url(a \"b)0.5\")}"],
			["a{b:_url(a \"b)0.5\")}", "a{b:_url(a \"b)0.5\")}"]
		]);
	});

	it("url( after \".\" \"%\" or whitespace is a url token, its body kept as written", () =>
	{
		expectCases([
			["a{b:1.url(x0.5)}", "a{b:1.url(x0.5)}"],
			["a{b:%url(x0.5)}", "a{b:%url(x0.5)}"],
			["a{b:URL(x0.5)}", "a{b:URL(x0.5)}"],
			["a{b:url( x0.5 )}", "a{b:url( x0.5 )}"],
			["a{b:url(x\\)0.5)}", "a{b:url(x\\)0.5)}"],
			["a{b:url( \"x0.5\")}", "a{b:url( \"x0.5\")}"],
			["a{b:url(x0.5", "a{b:url(x0.5"]
		]);
	});

	it("whitespace after an escape ends its ident, so the url( after it is a url token", () =>
	{
		// a bad url token (its body holds a quote) up to the first ")": what follows is code, and its 0.5 a number
		expectCases([["a{b:\\41 \nurl(a \"b)0.5\")}", "a{b:\\41  url(a \"b).5\")}"]]);
	});
});

describe("CSS custom-property values stay as written (deviation from PLAN.md, see the header)", () =>
{
	it("a custom property, an escaped name and @property's initial-value keep their spacing and leading zeros", () =>
	{
		// positive control: the same value under a plain property is minified
		expectCases([
			["a{color: 0.5  ,  1px}", "a{color:.5 ,1px}"],
			["a{--x: 0.5 , 1px;}", "a{--x:0.5 , 1px}"],
			["a{--x:  a   b  ;c:d}", "a{--x:a   b ;c:d}"],
			["a{--x:a\n\tb}", "a{--x:a\n\tb}"],
			["a{\\2d-w: a  b}", "a{\\2d-w:a  b}"],
			["@property --x{initial-value: 0.5  1px}", "@property --x{initial-value:0.5  1px}"],
			["a{--x:{a  b}}", "a{--x:{a  b}}"],
			["a{--x:[a  b];}", "a{--x:[a  b]}"],
			["a{--x: a !important}", "a{--x:a !important}"]
		]);
	});

	it("a custom property keeps its comments, so tokens on both sides of one stay apart", () =>
	{
		expectCases([
			["a{--x:/*c*/1}", "a{--x:/*c*/1}"],
			["a{--x:1/**/0}", "a{--x:1/**/0}"]
		]);
	});

	it("a custom property cut off by the end of the input stays as written", () =>
	{
		expectCases([
			["a{--x:0.5  1px", "a{--x:0.5  1px"],
			["a{--x:(0.5  1px", "a{--x:(0.5  1px"],
			["a{--x: a\n", "a{--x:a"]
		]);
	});

	it("a whitespace-only custom property keeps one space", () =>
	{
		// positive control: an empty one stays empty
		expectCases([
			["a{--x:;}", "a{--x:}"],
			["a{--x: ;b:c}", "a{--x: ;b:c}"],
			["a{--x:\n}", "a{--x: }"],
			["a{ --x : ; }", "a{--x: }"],
			["a{--x:\f;}", "a{--x: }"],
			["@property --x{initial-value: ;}", "@property --x{initial-value: }"]
		]);
	});
});

describe("CSS conservative choices that cost bytes, each red on main", () =>
{
	it("preludes are left as they are", () =>
	{
		// positive control: the declarations inside are still minified
		expectCases([
			["@supports(color:#aabbcc){a{color:#aabbcc}}", "@supports(color:#aabbcc){a{color:#abc}}"],
			["@media (min-width:0px){a{margin:0px}}", "@media (min-width:0px){a{margin:0}}"]
		]);
	});

	it("at-rule descriptors are not edited", () =>
	{
		expectCases([
			["@page{margin:0px}", "@page{margin:0px}"],
			["@font-face{src:url(a.woff) format('woff');font-weight:0px}", "@font-face{src:url(a.woff) format('woff');font-weight:0px}"]
		]);
	});

	it("a hash or zero unit right before a comment keeps its digits", () =>
	{
		// positive control: with a space before the comment, they are edited
		expectCases([
			["a{margin:0px /* x */}", "a{margin:0}"],
			["a{color:#aabbcc /* x */}", "a{color:#abc}"],
			["a{color:#aabbcc/* x */}", "a{color:#aabbcc}"],
			["a{margin:0px/* x */}", "a{margin:0px}"]
		]);
	});
});

describe("CSS that main already minifies right keeps main's output (controls, green on main)", () =>
{
	it("control: an escaped } and an NBSP selector (r1)", () =>
	{
		expectCases([
			[".a\\} .b{color:red}", ".a\\} .b{color:red}"],
			["\u00A0{color:red}", "\u00A0{color:red}"]
		]);
	});

	it("control: a newline run after { } ; , or at either end goes (C3)", () =>
	{
		expectCases([
			["\na{\n\tb:c;\n\td:e,\n\tf\n}\n", "a{b:c;d:e,f}"],
			["a{b:c}\n\n\nd{e:f}", "a{b:c}d{e:f}"]
		]);
	});

	it("control: spacing, semicolons, !important and comments", () =>
	{
		expectCases([
			["a { margin: 0px; padding: 0em 10px 0rem; border: 0vh solid black; }", "a{margin:0;padding:0 10px 0;border:0 solid black}"],
			["a{color:red;}\n", "a{color:red}"],
			["a , b { color : red ; }", "a ,b{color:red}"],
			["a{color: red  ;  --y : 1 ; }", "a{color:red ;--y:1}"],
			["a{color:red !important}", "a{color:red!important}"],
			["a{margin:0px!important}", "a{margin:0!important}"],
			["a{color:#aabbcc!important}", "a{color:#abc!important}"],
			["/* x */a{b:c}/* y */", "a{b:c}"],
			["a{b:c}\n/* x */\nd{e:f}", "a{b:c}d{e:f}"],
			[" a{b:c} ", " a{b:c} "],
			["a{b:c}  \n", "a{b:c} "]
		]);
	});

	it("control: numbers, units and colors", () =>
	{
		expectCases([
			["a{background:url(x.png) no-repeat 0px 0px}", "a{background:url(x.png) no-repeat 0 0}"],
			["a{opacity:0.50}", "a{opacity:.50}"],
			[".a{margin:0px 0px 0px 0px}", ".a{margin:0 0 0 0}"],
			["a{margin:0px,0px}", "a{margin:0,0px}"],
			["a{margin:0PX}", "a{margin:0}"],
			["a{MARGIN:0px}", "a{MARGIN:0}"],
			["a{color:#AABBCC}", "a{color:#ABC}"],
			["a{color:#AbCdEf}", "a{color:#AbCdEf}"],
			["a{color:#aabbcc;background:#ffffff}", "a{color:#abc;background:#fff}"],
			["a{&:hover{color:#aabbcc}}", "a{&:hover{color:#abc}}"],
			["a{b:c;d{margin:0px}}", "a{b:c;d{margin:0}}"],
			["@media x{a{margin:0px;color:#aabbcc}}", "@media x{a{margin:0;color:#abc}}"],
			["@-webkit-keyframes x{0%{margin:0px}}", "@-webkit-keyframes x{0%{margin:0}}"],
			["a{b:2-0.5}", "a{b:2-.5}"],
			["a{margin:1-x 0px}", "a{margin:1-x 0}"],
			["a{margin:0-x}", "a{margin:0-x}"],
			["a{b:0.5e2}", "a{b:.5e2}"],
			["a{b:-0.5e-1}", "a{b:-.5e-1}"],
			["a{b:0.5E+2px}", "a{b:.5E+2px}"],
			["a{b:+0.5}", "a{b:+.5}"],
			["a{b:0.5e}", "a{b:.5e}"],
			["a{margin:0e0px}", "a{margin:0e0px}"],
			[".a\\😀{b:c}", ".a\\😀{b:c}"]
		]);
	});

	it("control: strings, escapes and comments that are cut off", () =>
	{
		expectCases([
			["a{content:\"a\\\"b\"}", "a{content:\"a\\\"b\"}"],
			["a{b:\"x\fy\"}", "a{b:\"x\fy\"}"],
			[".a\\31 .b{color:red}", ".a\\31 .b{color:red}"],
			["a{b:c}\\", "a{b:c}\\"],
			["a{b:'x", "a{b:'x"],
			["a{b:c}/* x", "a{b:c}/* x"],
			["a{}\n/*x", "a{}/*x"],
			["a\n/*x*/", "a"],
			["a{b:url(x)}", "a{b:url(x)}"],
			["<!--url(x)", "<!--url(x)"]
		]);
	});
});

describe("CSS markers (U+0001) in the input", () =>
{
	it("control (green on main, which has no vault): a U+0001 next to each rule's trigger stays, and the rule still runs", () =>
	{
		const mark = "\u0001";
		const cases = [
			["{", "{"], ["}", "}"], [";", ";"], [":", ":"], [",", ","], [" ", " "], ["  ", " "], [" !", "!"], ["\f", "\f"],
			["/*x*/", ""], ["\"s\"", "\"s\""], ["url(x)", "url(x)"], ["style(x)", "style(x)"], ["#aabbcc", "#abc"],
			[" 0.5", " .5"], ["\\31 ", "\\31 "], ["(", "("], [")", ")"], ["[", "["], ["]", "]"], ["@x", "@x"], ["--x", "--x"],
			[" { ", "{"], [" : ", ":"], [" } ", "}"], ["; ", ";"], [", ", ","]
		];

		for (const [trigger, expected] of cases)
		{
			expect(css(`a{margin:${mark}${trigger}${mark}}`), JSON.stringify(trigger)).toBe(`a{margin:${mark}${expected}${mark}}`);
		}
	});

	it("a U+0001 at either end, before a number or after a zero unit (red on main: the newline and the unit)", () =>
	{
		expectCases([
			["\u0001a{color:#aabbcc}\u0001", "\u0001a{color:#abc}\u0001"],
			["\u0001\n\u0001", "\u0001 \u0001"],
			["a{margin:\u0001\n\u0001}", "a{margin:\u0001 \u0001}"],
			["a{margin:\u0001\t\u0001}", "a{margin:\u0001 \u0001}"],
			["a{margin:\u00010px}", "a{margin:\u00010px}"],
			["a{margin:\u0001 0px\u0001}", "a{margin:\u0001 0px\u0001}"],
			["a{margin:0px\u0001}", "a{margin:0px\u0001}"],
			["a{color:#aabbcc\u0001}", "a{color:#abc\u0001}"],
			["a{b:0\u0001.5}", "a{b:0\u0001.5}"],
			["a{b:url(\u0001)}", "a{b:url(\u0001)}"],
			["a{b:\"\u0001\"}", "a{b:\"\u0001\"}"],
			["a{--x:\u0001}", "a{--x:\u0001}"],
			["\u0001{\u0001}\u0001;\u0001:\u0001,\u0001 \u0001!\u0001", "\u0001{\u0001}\u0001;\u0001:\u0001,\u0001 \u0001!\u0001"]
		]);
	});

	it("control (green on main, which has no vault): many markers next to vaulted strings and edited numbers", () =>
	{
		const count = 50000;
		const input = `a{b:${"\"s\"\u0001 0.5".repeat(count)}}`;

		// premise: the vault indices run to 6 digits, past every one-digit special case
		expect(input.length).toBeGreaterThan(400000);
		expect(difference__(css(input), `a{b:${"\"s\"\u0001 .5".repeat(count)}}`)).toBeNull();
	});
});

describe("CSS scan stays linear on long runs of each loop's worst case", { timeout: TIMEOUT_MS__ }, () =>
{
	// Guards for the scan's own loops. Main has none of them, so most of these pass on main as well; main fails the
	// newline, bad-string, escape and backslash-newline runs (C3, r2, the vault) and runs for minutes on the form feeds
	// inside a value and the unterminated comments.

	// [name, repeated chunk (its length sets the count), count => [input, expected output]]
	const workloads = [
		["spaces", " ", n => [`${PREFIX__}b{c:d${" ".repeat(n)}e}`, `${MINIFIED_PREFIX__}b{c:d e}`]],
		["newline and tab runs", "\n\t", n => [`${PREFIX__}b{c:d${"\n\t".repeat(n)}e}`, `${MINIFIED_PREFIX__}b{c:d e}`]],
		["form feeds before \"}\"", "\f", n => [`${PREFIX__}b{c:d${"\f".repeat(n)}}`, `${MINIFIED_PREFIX__}b{c:d}`]],
		["form feeds and spaces before \"}\"", "\f ", n => [`${PREFIX__}b{c:d${"\f ".repeat(n)}}`, `${MINIFIED_PREFIX__}b{c:d}`]],
		["form feeds inside a value", "\f", n => [`${PREFIX__}b{c:d${"\f".repeat(n)}e}`, `${MINIFIED_PREFIX__}b{c:d${"\f".repeat(n)}e}`]],
		["one long number", "1", n => [`${PREFIX__}b{margin:${"1".repeat(n)}px}`, `${MINIFIED_PREFIX__}b{margin:${"1".repeat(n)}px}`]],
		["leading zeros", "0.5 ", n => [`${PREFIX__}b{c:${"0.5 ".repeat(n)}}`, `${MINIFIED_PREFIX__}b{c:${".5 ".repeat(n - 1)}.5}`]],
		["zero units", " 0px", n => [`${PREFIX__}b{margin:${" 0px".repeat(n)}}`, `${MINIFIED_PREFIX__}b{margin:0${" 0".repeat(n - 1)}}`]],
		["hex colors", " #aabbcc", n => [`${PREFIX__}b{background:${" #aabbcc".repeat(n)}}`, `${MINIFIED_PREFIX__}b{background:#abc${" #abc".repeat(n - 1)}}`]],
		["quotes", "\"\"", n => [`${PREFIX__}${"\"\"".repeat(n)}`, `${MINIFIED_PREFIX__}${"\"\"".repeat(n)}`]],
		["one unterminated string", "x", n => [`${PREFIX__}b{c:"${"x".repeat(n)}`, `${MINIFIED_PREFIX__}b{c:"${"x".repeat(n)}`]],
		["bad strings", "'\n", n => [`${PREFIX__}${"'\n".repeat(n)}`, `${MINIFIED_PREFIX__}${"'\n".repeat(n)}`]],
		["unclosed url(", "url(", n => [`${PREFIX__}b{c:${"url(".repeat(n)}`, `${MINIFIED_PREFIX__}b{c:${"url(".repeat(n)}`]],
		["url( with spaces before a quote", "url( ' ' )", n => [`${PREFIX__}b{c:${"url( ' ' )".repeat(n)}}`, `${MINIFIED_PREFIX__}b{c:${"url( ' ' )".repeat(n)}}`]],
		["unclosed style(", "style(", n => [`${PREFIX__}b{c:if(${"style(".repeat(n)}`, `${MINIFIED_PREFIX__}b{c:if(${"style(".repeat(n)}`]],
		["unclosed brackets", "([", n => [`${PREFIX__}b{c:${"([".repeat(n)}}`, `${MINIFIED_PREFIX__}b{c:${"([".repeat(n)}}`]],
		["unterminated comments", "/*x", n => [`${PREFIX__}${"/*x".repeat(n)}`, `${MINIFIED_PREFIX__}${"/*x".repeat(n)}`]],
		["many comments", "/**/", n => [`${PREFIX__}b{c:${"/**/".repeat(n)}d}`, `${MINIFIED_PREFIX__}b{c:d}`]],
		["hex escapes", "\\31 ", n => [`${PREFIX__}.a${"\\31 ".repeat(n)}{c:d}`, `${MINIFIED_PREFIX__}.a${"\\31 ".repeat(n)}{c:d}`]],
		["backslashes", "\\\\", n => [`${PREFIX__}${"\\\\".repeat(n)}`, `${MINIFIED_PREFIX__}${"\\\\".repeat(n)}`]],
		["backslash newlines", "\\\n", n => [`${PREFIX__}a${"\\\n".repeat(n)}`, `${MINIFIED_PREFIX__}a${"\\\n".repeat(n)}`]],
		["open braces", "{", n => [`${PREFIX__}${"{".repeat(n)}`, `${MINIFIED_PREFIX__}${"{".repeat(n)}`]],
		["close braces", "}", n => [`${PREFIX__}${"}".repeat(n)}`, `${MINIFIED_PREFIX__}${"}".repeat(n)}`]],
		["colons in a prelude", "a:", n => [`${PREFIX__}${"a:".repeat(n)}{b:c}`, `${MINIFIED_PREFIX__}${"a:".repeat(n)}{b:c}`]],
		["a long custom-property value", " y", n => [`${PREFIX__}b{--x:${" y".repeat(n)}}`, `${MINIFIED_PREFIX__}b{--x:y${" y".repeat(n - 1)}}`]],
		["many custom properties", "--x:y;", n => [`${PREFIX__}b{${"--x:y;".repeat(n)}}`, `${MINIFIED_PREFIX__}b{${"--x:y;".repeat(n - 1)}--x:y}`]],
		["many rules", "a{b:c}\n", n => [`${PREFIX__}${"a{b:c}\n".repeat(n)}`, `${MINIFIED_PREFIX__}${"a{b:c}".repeat(n)}`]],
		["many short constructs", "a{b:\"x\" url(y) #aabbcc 0.5 \\31 c}", n => [`${PREFIX__}${"a{b:\"x\" url(y) #aabbcc 0.5 \\31 c}".repeat(n)}`, `${MINIFIED_PREFIX__}${"a{b:\"x\" url(y) #abc .5 \\31 c}".repeat(n)}`]],
		["markers", "\u0001", n => [`${PREFIX__}${"\u0001".repeat(n)}`, `${MINIFIED_PREFIX__}${"\u0001".repeat(n)}`]],
		["dashes", "-", n => [`${PREFIX__}${"-".repeat(n)}`, `${MINIFIED_PREFIX__}${"-".repeat(n)}`]],
		["hash and at signs", "#@", n => [`${PREFIX__}${"#@".repeat(n)}`, `${MINIFIED_PREFIX__}${"#@".repeat(n)}`]]
	];

	for (const [name, chunk, build] of workloads)
	{
		it(name, () =>
		{
			const [input, expected] = build(Math.ceil(SIZE__ / chunk.length));
			let output = "";
			const took = cpuMs__(() =>
			{
				output = css(input);
			});

			expect(input.length).toBeGreaterThanOrEqual(SIZE__);
			expect(difference__(output, expected)).toBeNull();
			expect(took).toBeLessThan(BOUND_MS__);
		});
	}
});
