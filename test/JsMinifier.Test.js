import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { Linter } from "eslint";
import minify__ from "../src/index.js";
import { stripJsComments__ } from "../src/JsComments.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// How minifyJs__ (src/JsMinifier.js) works, with its lexer scanJs__ (src/JsLexer.js). The notes live
// here, not in src: src keeps only the JSDoc the lint requires.
//
// Main (47091) makes two edits, blind to context: stripJsComments__ removes a comment that starts a line
// (after whitespace), and /\s+$/gum removes trailing whitespace and blank lines. Inside a template
// literal, or a string continued by a "\" at a line end, both are content, not code:
// - J1: a "// x" or "/* x */" line is deleted from the template; a "/*" line deletes everything through
//   the next "*/", code after the template included.
// - J2: trailing whitespace and blank lines of a template are deleted.
//
// The fix keeps both edits and filters them with a lexical scan:
// - Comment edits are exactly stripJsComments__'s own, gated: given the comment start indexes of the
//   scan, it removes a comment only where the scan says one starts. A comment it may not remove is still
//   skipped as main skips it (a "/*" through its "*/"), so the removals are a subset of main's.
// - Whitespace edits are exactly main's /\s+$/gum matches, minus every match that starts inside a
//   protected span: a string, the characters of a template, or a regex. The spans come from a second scan,
//   of the comment-stripped text the regex runs on.
// - When either scan returns null, nothing is edited but the final trim.
// So a scan that misreads a file can only delete what main deletes too; it cannot add a new kind of edit.
//
// The scan (sweet.js-style slash classification) reads tokens: identifiers, punctuators, numbers,
// strings (LF and CR end them, U+2028/9 do not, "\" + a line terminator continues them, CRLF as one),
// templates with a stack for "${", regex literals (classes, escapes, flags; closed before a line
// terminator), and comments. A "/" starts a regex after the start, a punctuator (prefix ++/-- included),
// or one of the keywords return typeof case do else in new delete void throw instanceof (not after "."
// or "?.", where they are property names); after ")" only when its "(" followed if, while, for, with or
// "for await"; after "}" only when its "{" opened a certain block. After an identifier, number, string,
// template, regex, "]" or postfix ++/-- it is division.
//
// A "{" is a certain block at the start, after ";" "{" "}" "=>", after else try finally do catch, or after
// the ")" of if for while with catch switch. It is a certain expression after any other punctuator (an
// object literal, a "${" slot) and after return typeof case in new delete void throw instanceof yield
// await. Everything else is uncertain: after the ")" of a function, after an identifier or "class", after
// ":" (label or case), and after a number, string, template, regex, "]", "of", a statement end or a
// postfix ++/-- (where a "{" can only be a block that ASI starts).
//
// The scan refuses (returns null) instead of guessing, since a balanced wrong reading passes every
// consistency check: a "/" right after yield, await or of (keywords or identifiers by context), after
// debugger, break, continue or the label after break/continue (ASI may end the statement), or after the
// "}" of an uncertain brace. HTML-like comments refuse too: "<!--" anywhere, and "-->" with only
// whitespace and comments between it and a line start (the start of input included); they are comments
// in a classic script and operators in a module, which hulk cannot tell apart. Consistency checks also
// refuse: a regex or string that meets a line terminator, a string, template, regex or "/*" open at the
// end, a closer that does not match the innermost open "(", "[", "{" or "${", or anything left open.
//
// Linear time: one pass with index jumps (whitespace runs, line comments and "*/" are found by search).
// The "-->" check caches the next line terminator and searches again only once the scan passes it.
// The /\s+$/gum regex is main's, unchanged: its quadratic cost on a long whitespace run that does not end
// a line is item 47108's. The filter walks the protected spans with one pointer, in match order.

const js = content => minify__(content, "js");
const lexer = () => import("../src/JsLexer.js");
const OPEN_SLOT__ = "${";

// main's whitespace edit, for premises: the input has something main's regex deletes
const MAIN_TRIM__ = /\s+$/gum;
const mainTrim = content => content.replaceAll(MAIN_TRIM__, "");

// keeps V8 from storing the large inputs one-byte
const TWO_BYTE__ = "→";

// at least 500k characters for each scaling input
const LARGE__ = 600000;

// CPU-time bound of every scaling test, as in the markup tests
const CPU_MS__ = 3000;

// generous per-test limit: v8 coverage slows the large inputs down several times over
const SLOW_TEST_MS__ = 60000;

/**
 * @description Runs a script in a fresh context and returns one of its globals.
 * @param {string} code - Script.
 * @param {string} name - Global to read.
 * @return {?(string|number)} The global's value.
 */
function evaluate(code, name)
{
	const context = {};
	runInNewContext(code, context);

	return context[name];
}

describe("J1: line-start comments in templates and strings are content (red on main)", () =>
{
	it("minify JS keeps a // line inside a template", () =>
	{
		const input = "var t = `a\n// x\nb`;\n// drop\n";

		// premise: main's comment strip deletes the template line
		expect(stripJsComments__(input)).toBe("var t = `a\n\nb`;\n\n");

		expect(js(input)).toBe("var t = `a\n// x\nb`;");
		expect(evaluate(js(input), "t")).toBe(evaluate(input, "t"));
	});

	it("minify JS keeps a /* */ line inside a template", () =>
	{
		const input = "var t = `a\n  /* keep */\nb`;\n  /* drop */\n";

		expect(stripJsComments__(input)).toBe("var t = `a\n  \nb`;\n  \n");
		expect(js(input)).toBe("var t = `a\n  /* keep */\nb`;");
		expect(evaluate(js(input), "t")).toBe(evaluate(input, "t"));
	});

	it("minify JS keeps code after a template whose /* line main deleted through the next */", () =>
	{
		const input = "var t = `\n/* x`;\nvar foo = 1; /* y */\nvar bar = 2;";

		// premise: main deletes the code between the template's "/*" and the next "*/"
		expect(stripJsComments__(input)).toBe("var t = `\n\nvar bar = 2;");

		expect(js(input)).toBe(input);
		expect(evaluate(js(input), "foo")).toBe(1);
	});

	it("minify JS keeps a // line inside a continued string", () =>
	{
		const input = "var s = 'a\\\n// x';\nvar n = 1;";

		expect(stripJsComments__(input)).toBe("var s = 'a\\\n\nvar n = 1;");
		expect(js(input)).toBe(input);
		expect(evaluate(js(input), "s")).toBe("a// x");
	});

	it("minify JS keeps // after U+2028 inside a string, which does not end it", () =>
	{
		const input = "var s=\"a\u2028// text\";";

		expect(stripJsComments__(input)).toBe("var s=\"a\u2028");
		expect(js(input)).toBe(input);
	});

	it("minify JS keeps comment lines in a nested template and drops the real comment", () =>
	{
		const input = "x = `" + OPEN_SLOT__ + " `\n// inner\n` }\n// keep`;\n// drop\n";

		expect(js(input)).toBe("x = `" + OPEN_SLOT__ + " `\n// inner\n` }\n// keep`;");
	});

	it("minify JS keeps comment lines in a template with CRLF line ends", () =>
	{
		const input = "const t = `a\r\n// keep\r\n/* keep */\r\nb`;\r\n// drop\r\nfoo();\r\n";

		expect(stripJsComments__(input)).toBe("const t = `a\r\r\n\r\nb`;\r\r\nfoo();\r\n");
		expect(js(input)).toBe("const t = `a\r\n// keep\r\n/* keep */\r\nb`;\nfoo();");
	});

	it("minify JS keeps a tagged template's raw text that a tag observes", () =>
	{
		const input = "const tag = s => s.raw[0].length;\nvar n = tag`x\n// keep\ny`;";

		expect(evaluate(mainTrim(stripJsComments__(input)), "n")).toBe(3);
		expect(js(input)).toBe(input);
		expect(evaluate(js(input), "n")).toBe(11);
	});

	it("minify JS keeps a line-start /* that sits inside a comment opened earlier on another line", () =>
	{
		const input = "x(); /* a\n/* b */\ny();";

		// premise: main deletes the comment's end, so y() becomes comment
		expect(stripJsComments__(input)).toBe("x(); /* a\n\ny();");

		expect(js(input)).toBe(input);
	});
});

describe("J2: trailing whitespace and blank lines in templates are content (red on main)", () =>
{
	it("minify JS keeps a template's trailing spaces and blank lines", () =>
	{
		const input = "var t = `a   \n\n\nb`;";

		expect(mainTrim(input)).toBe("var t = `a\nb`;");
		expect(js(input)).toBe(input);
		expect(evaluate(js(input), "t")).toBe("a   \n\n\nb");
	});

	it("minify JS keeps template whitespace after a slot and trims the code around it", () =>
	{
		const input = "const a = 1;   \n\n\nconst t = `x\t\n" + OPEN_SLOT__ + "a}  \n\n  " + OPEN_SLOT__ + " a   \n  }\t\n`;  \n\n";

		// positive control: the code's trailing whitespace goes, as on main
		expect(js(input)).toBe("const a = 1;\nconst t = `x\t\n" + OPEN_SLOT__ + "a}  \n\n  " + OPEN_SLOT__ + " a\n  }\t\n`;");
	});

	it("minify JS keeps the CR of a CRLF string continuation", () =>
	{
		const input = "var s = 'a\\\r\nb';";

		expect(mainTrim(input)).toBe("var s = 'a\\\nb';");
		expect(js(input)).toBe(input);
	});

	it("minify JS keeps a template that is all whitespace lines", () =>
	{
		const input = "const t = `\n \n\t\n  \n`;\n";

		expect(js(input)).toBe("const t = `\n \n\t\n  \n`;");
	});
});

describe("reviewer probes of rounds 1-5 and 15, and the prototype's cases", () =>
{
	// every JS input of the Codex plan reviews (reviews/codex-plan-r*.md and .stderr) and of
	// scratch/js-cases.mjs, with the output written out: comments inside templates are kept, real ones go,
	// and an ambiguous file (a "/" after yield, await, of, debugger, break, continue, a label or an
	// uncertain "}", or an HTML-like comment) keeps everything but the outer whitespace
	const probes = [
		["r1", "if (ok) /`/.test(s);\nconst t = `a\n// keep\nb`;", "if (ok) /`/.test(s);\nconst t = `a\n// keep\nb`;"],
		["r1", "if (ok) {} /`/.test(s);\nconst t = `a\n/* keep */\nb`;", "if (ok) {} /`/.test(s);\nconst t = `a\n/* keep */\nb`;"],
		["r1", "const q = obj.return / `x/\n//keep\ny`;", "const q = obj.return / `x/\n//keep\ny`;"],
		["r1", "const q = \"1\" / `x/\n//keep\ny`;", "const q = \"1\" / `x/\n//keep\ny`;"],
		["r1", "var s=\"a\u2028// text\";", "var s=\"a\u2028// text\";"],
		["r1", "tag`\\u0061`", "tag`\\u0061`"],
		["r1", "tag`a`", "tag`a`"],
		["r1", "const r=/one/g;", "const r=/one/g;"],
		["r1", "const r=/two/i;", "const r=/two/i;"],
		["r1", "function f(){return\nx}", "function f(){return\nx}"],
		["r1", "function f(){return x}", "function f(){return x}"],
		["r2", "let of=1;const tag=s=>s.raw[0].length;\nconst q=of/tag`x/\n//keep\ny`;\n/`/.test(\"\");q", "let of=1;const tag=s=>s.raw[0].length;\nconst q=of/tag`x/\n//keep\ny`;\n/`/.test(\"\");q"],
		["r2", "let of=1;const tag=s=>s.raw[0].length;\nconst q=of/tag`x/\ny`;\n/`/.test(\"\");q", "let of=1;const tag=s=>s.raw[0].length;\nconst q=of/tag`x/\ny`;\n/`/.test(\"\");q"],
		["r2", "let seen;\nconst tag=s=>(seen=s.raw[0]);\nconst q=function(){} / tag`x/\n//keep\ny`;\n/`/.test(\"\");seen", "let seen;\nconst tag=s=>(seen=s.raw[0]);\nconst q=function(){} / tag`x/\n//keep\ny`;\n/`/.test(\"\");seen"],
		["r2", "let seen;\nconst tag=s=>(seen=s.raw[0]);\nconst q=function(){} / tag`x/\ny`;\n/`/.test(\"\");seen", "let seen;\nconst tag=s=>(seen=s.raw[0]);\nconst q=function(){} / tag`x/\ny`;\n/`/.test(\"\");seen"],
		["r3", "let of=1; const tag=s=>s.raw[0].length; const q=of/tag`x/\n//keep\ny`;\n/`/.test(\"\");", "let of=1; const tag=s=>s.raw[0].length; const q=of/tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r3", "const tag=s=>s.raw[0].length; const q=function(){}/tag`x/\n//keep\ny`;\n/`/.test(\"\");", "const tag=s=>s.raw[0].length; const q=function(){}/tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r3", "let yield=1; const tag=s=>s.raw[0].length; const q=yield/tag`x/\n//keep\ny`;\n/`/.test(\"\");", "let yield=1; const tag=s=>s.raw[0].length; const q=yield/tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r3", "let await=1; const tag=s=>s.raw[0].length; const q=await/tag`x/\n//keep\ny`;\n/`/.test(\"\");", "let await=1; const tag=s=>s.raw[0].length; const q=await/tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r3", "class X{} /`/.test(\"\");\nconst t=`a\n//keep\nb`;", "class X{} /`/.test(\"\");\nconst t=`a\n//keep\nb`;"],
		["r3", "debugger\n/`/.test(\"\");\nconst t=`a\n//keep\nb`;", "debugger\n/`/.test(\"\");\nconst t=`a\n//keep\nb`;"],
		["r3", "for (const x of /`/) {}\nconst t=`a\n//keep\nb`;", "for (const x of /`/) {}\nconst t=`a\n//keep\nb`;"],
		["r3", "const tag=s=>{globalThis.review47101Length=s.raw[0].length;return 1;}; const q=function(){}/tag`x/\n//keep\ny`;\n/`/.test(\"\");", "const tag=s=>{globalThis.review47101Length=s.raw[0].length;return 1;}; const q=function(){}/tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r3", " //keep", ""],
		["r3 md", "const tag = s => {\n  globalThis.seen = s.raw[0].length;\n  return 1;\n};\nconst q = function(){} / tag`x/\n//keep\ny`;\n/`/.test(\"\");", "const tag = s => {\n  globalThis.seen = s.raw[0].length;\n  return 1;\n};\nconst q = function(){} / tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r3 md", "let yield=1;\nconst tag=s=>s.raw[0].length;\nconst q=yield/tag`x/\n//keep\ny`;\n/`/.test(\"\");", "let yield=1;\nconst tag=s=>s.raw[0].length;\nconst q=yield/tag`x/\n//keep\ny`;\n/`/.test(\"\");"],
		["r4", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;"],
		["r4", "async function f(xs) { for await (const x of xs) /`/.test(\"\");\nconst t = `a\n// keep\nb`;\n}", "async function f(xs) { for await (const x of xs) /`/.test(\"\");\nconst t = `a\n// keep\nb`;\n}"],
		["r4", "while(true) { break\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n}", "while(true) { break\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n}"],
		["r4", "for(;;) { continue\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n}", "for(;;) { continue\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n}"],
		["r4", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;"],
		["r4", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;"],
		["r4", "let x=1; x++\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;", "let x=1; x++\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;"],
		["r4", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");"],
		["r4", "async function f(xs) { for await (const x of xs) /`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");\n}", "async function f(xs) { for await (const x of xs) /`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");\n}"],
		["r4", "while(true) { break\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");\n}", "while(true) { break\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");\n}"],
		["r4", "for(;;) { continue\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");\n}", "for(;;) { continue\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");\n}"],
		["r4", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");"],
		["r4", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\n/`/.test(\"\");"],
		["r4", "try {} catch {}\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");", "try {} catch {}\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");"],
		["r4", "async function f(xs) { for await (const x of xs) /`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");\n}", "async function f(xs) { for await (const x of xs) /`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");\n}"],
		["r4", "debugger\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");", "debugger\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");"],
		["r4", "L: { break L\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");\n}", "L: { break L\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");\n}"],
		["r4", "export default class {}\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");", "export default class {}\n/`/.test(\"\");\nconst t=`a\n// keep\nb`;\nglobalThis.observed=t;\n/`/.test(\"\");"],
		["r4 md", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r4 md", "async function f(xs) {\n  for await (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}", "async function f(xs) {\n  for await (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}"],
		["r4 md", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r4 md", "L: {\n  break L\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}", "L: {\n  break L\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}"],
		["r4 md", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r5", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r5", "async function f(xs){for await (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n}", "async function f(xs){for await (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}"],
		["r5", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop"],
		["r5", "L:{break L\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n}", "L:{break L\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n}"],
		["r5", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop"],
		["r5", "for(const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n", "for(const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r5", "x=a\n<!--b `\n// keep\n`\n", "x=a\n<!--b `\n// keep\n`"],
		["r5", "--> anything\nconst t=`a\n// keep\nb`;\n", "--> anything\nconst t=`a\n// keep\nb`;"],
		["r7 r8 r14 r15 (payloads)", "//<frame src=x>", ""],
		["r8", "//<col span=2>", ""],
		["r14", "//keep&#10;keep=1", ""],
		["r15", "const keep = `keep\n// keep\nkeep`;", "const keep = `keep\n// keep\nkeep`;"],
		["diff r1", "function f() {\n  if (false) return\n  {}\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  console.log(t);\n  /`/.test(\"\");\n}\nf();", "function f() {\n  if (false) return\n  {}\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  console.log(t);\n  /`/.test(\"\");\n}\nf();"],
		["diff r1", "function* g() {\n  yield\n  {}\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n}", "function* g() {\n  yield\n  {}\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n}"],
		["diff r1", "async function h() {\n  await /* x\n */ {}\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n}", "async function h() {\n  await /* x\n */ {}\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n}"],
		["diff r1 (control: no slash after the brace, comments still go)", "function f() {\n  return\n  {}\n}\n// c\nf();", "function f() {\n  return\n  {}\n}\nf();"],
		["diff r1 (control: same-line object)", "function f() {\n  return {\n    a: 1\n  }\n}\n// c\nf();", "function f() {\n  return {\n    a: 1\n  }\n}\nf();"],
		["diff r2", "if (true) ++/`/.lastIndex;\nconst t = `a\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");\n// drop\n", "if (true) ++/`/.lastIndex;\nconst t = `a\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");"],
		["diff r2", "let n = 1\nn\n++/`/.lastIndex;\nconst t = `a\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");\n// drop\n", "let n = 1\nn\n++/`/.lastIndex;\nconst t = `a\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");"],
		["diff r2", "let n = 1\nn /* x\n */ ++/`/.lastIndex;\nconst t = `a\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");\n// drop\n", "let n = 1\nn /* x\n */ ++/`/.lastIndex;\nconst t = `a\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");"],
		["diff r2", "const x = {...typeof /`/};\nconst t = `a\n}\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");\n// drop\n", "const x = {...typeof /`/};\nconst t = `a\n}\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");"],
		["diff r2", "f(...typeof /`/);\nconst t = `a\n)\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");\n// drop\n", "f(...typeof /`/);\nconst t = `a\n)\n// keep\nb`;\nconsole.log(t);\n/`/.test(\"\");"],
		["diff r2 (refused: yield or await before ++)", "function* g() {\n  yield ++/`/.lastIndex;\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n  // kept\n}", "function* g() {\n  yield ++/`/.lastIndex;\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n  // kept\n}"],
		["diff r2 (control: postfix is still division)", "let a = 1; a++ / 2;\n// c\nb = (a)++ / 2;\n// d\nc = x[0]-- / 2;\n// e\n", "let a = 1; a++ / 2;\nb = (a)++ / 2;\nc = x[0]-- / 2;"],
		["diff r2 (prefix after a control head)", "while (x) --/`/.lastIndex;\n// c\n", "while (x) --/`/.lastIndex;"],
		["diff r2 (refused: yield or await before ++)", "async function h() {\n  x = await ++/`/.lastIndex;\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n  // kept\n}", "async function h() {\n  x = await ++/`/.lastIndex;\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n  // kept\n}"],
		["diff r2 (control: member after a spread)", "f(...a.typeof / 2);\n// c\n", "f(...a.typeof / 2);"],
		["diff r3", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\ndo {\n  if (false) break\n  x++ / tag`a/\n// keep\nb`;\n  /`/.test(\"\");\n} while (false);\n// drop\n", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\ndo {\n  if (false) break\n  x++ / tag`a/\n// keep\nb`;\n  /`/.test(\"\");\n} while (false);"],
		["diff r3", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\nfor (;;) {\n  if (true) continue\n  x++ / tag`a/\n// keep\nb`;\n  /`/.test(\"\");\n}\n// drop\n", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\nfor (;;) {\n  if (true) continue\n  x++ / tag`a/\n// keep\nb`;\n  /`/.test(\"\");\n}"],
		["diff r3", "let x = 1;\nconst tag = s => s.raw[0];\ndo {\n  if (false) break /* a\n */ x++ / tag`a/\n// keep\nb`;\n  /`/.test(\"\");\n} while (false);\n// drop\n", "let x = 1;\nconst tag = s => s.raw[0];\ndo {\n  if (false) break /* a\n */ x++ / tag`a/\n// keep\nb`;\n  /`/.test(\"\");\n} while (false);"],
		["diff r3 (control: a label on the same line still refuses)", "L: do {\n  break L\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n  // kept\n} while (false);", "L: do {\n  break L\n  /`/.test(\"\");\n  const t = `a\n// keep\nb`;\n  /`/.test(\"\");\n  // kept\n} while (false);"],
		["diff r4", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\n\\u{78}++ / tag`a/\n// keep\nb`;\n/`/.test(\"\");\n// drop\n", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\n\\u{78}++ / tag`a/\n// keep\nb`;\n/`/.test(\"\");"],
		["diff r4", "let x0 = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\nx\\u{30}++ / tag`a/\n// keep\nb`;\n/`/.test(\"\");\n// drop\n", "let x0 = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\nx\\u{30}++ / tag`a/\n// keep\nb`;\n/`/.test(\"\");"],
		["diff r4 (control: a 4-digit escape was already one identifier)", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\n\\u0078++ / tag`a/\n// keep\nb`;\n/`/.test(\"\");\n// drop\n", "let x = 1;\nconst tag = s => { console.log(s.raw[0]); return 1; };\n\\u0078++ / tag`a/\n// keep\nb`;\n/`/.test(\"\");"],
		["diff r4 (a backslash that is no escape refuses)", "a\\x = 1;\n// kept\n", "a\\x = 1;\n// kept"],
		["r1-r4 (js-cases)", "var t = `a\n// x\nb`;", "var t = `a\n// x\nb`;"],
		["r1-r4 (js-cases)", "var s = 'a\\\n// x\nb';", "var s = 'a\\\n// x\nb';"],
		["r1-r4 (js-cases)", "var a = 1; // trailing\n/* c */\nfoo();", "var a = 1; // trailing\nfoo();"],
		["r1-r4 (js-cases)", "var t = `a   \n\n\nb`;", "var t = `a   \n\n\nb`;"],
		["r1-r4 (js-cases)", "var t = `\n/* x`;\nfoo(); /* y */\nbar();", "var t = `\n/* x`;\nfoo(); /* y */\nbar();"],
		["r1-r4 (js-cases)", "#!/usr/bin/env node\n// c\nfoo();", "#!/usr/bin/env node\nfoo();"],
		["r1-r4 (js-cases)", "x = `" + OPEN_SLOT__ + " `\n// inner\n` }\n// keep`;\n// drop\n", "x = `" + OPEN_SLOT__ + " `\n// inner\n` }\n// keep`;"],
		["r1-r4 (js-cases)", "a\n\n  // c\n\nb  \n", "a\nb"],
		["r1-r4 (js-cases)", "let of = 4; const r = of / tag`x/\n// keep\n`;\n// drop\n", "let of = 4; const r = of / tag`x/\n// keep\n`;\n// drop"],
		["r1-r4 (js-cases)", "for (const x of /a/g.exec(s)) f(x); // drop\n", "for (const x of /a/g.exec(s)) f(x); // drop"],
		["r1-r4 (js-cases)", "const tag = s => 1;\nconst q = function(){} / tag`x/\n//keep\ny`;\n/`/.test(\"\");\n// drop\n", "const tag = s => 1;\nconst q = function(){} / tag`x/\n//keep\ny`;\n/`/.test(\"\");\n// drop"],
		["r1-r4 (js-cases)", "let yield=1;\nconst q=yield/tag`x/\n//keep\ny`;\n/`/.test(\"\");\n// drop\n", "let yield=1;\nconst q=yield/tag`x/\n//keep\ny`;\n/`/.test(\"\");\n// drop"],
		["r1-r4 (js-cases)", "function f(){}\n/`/.test(s);\nconst t = `a\n// keep\nb`;\n// drop\n", "function f(){}\n/`/.test(s);\nconst t = `a\n// keep\nb`;\n// drop"],
		["r1-r4 (js-cases)", "lbl: {}\n/`/.test(s);\nconst t = `a\n// keep\nb`;\n", "lbl: {}\n/`/.test(s);\nconst t = `a\n// keep\nb`;"],
		["r1-r4 (js-cases)", "try {} catch (e) {}\n/`/.test(s);\nconst t = `a\n// keep\nb`;\n// drop\n", "try {} catch (e) {}\n/`/.test(s);\nconst t = `a\n// keep\nb`;"],
		["r1-r4 (js-cases)", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n", "try {} catch {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r1-r4 (js-cases)", "async function f(xs) {\n  for await (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}\n", "async function f(xs) {\n  for await (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}"],
		["r1-r4 (js-cases)", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n", "debugger\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r1-r4 (js-cases)", "L: {\n  break L\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}\n", "L: {\n  break L\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n}"],
		["r1-r4 (js-cases)", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n", "export default class {}\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r1-r4 (js-cases)", "for (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");\n// drop\n", "for (const x of xs)\n/`/.test(\"\");\nconst t = `a\n// keep\nb`;\nglobalThis.observed = t;\n/`/.test(\"\");"],
		["r1-r4 (js-cases)", "x = a\n<!--b `\n// keep\n`\n", "x = a\n<!--b `\n// keep\n`"]
	];

	it("minify JS gives each probe its expected output", () =>
	{
		for (const [round, input, expected] of probes)
		{
			expect([round, js(input)]).toEqual([round, expected]);
		}
	});

	it("minify JS keeps every keep line that main's comment strip deletes", () =>
	{
		const keepLine = /\/[*/] ?keep/u;
		const kept = probes.filter(([, , expected]) => keepLine.test(expected));

		// premise: many probes, and main's comment strip deletes the keep line of each
		expect(kept.length).toBeGreaterThanOrEqual(50);
		for (const [round, input] of kept)
		{
			expect([round, keepLine.test(stripJsComments__(input))]).toEqual([round, false]);
			expect([round, keepLine.test(js(input))]).toEqual([round, true]);
		}
	});
});

describe("an ambiguous file gets no edit but the final trim", () =>
{
	// each input ends with code, trailing whitespace and a real comment, which a clean scan removes
	const tail = "\nfoo();  \n// drop\n";

	it("minify JS edits a file whose slashes and braces are certain (positive control)", () =>
	{
		const certain = [
			["x = a / b;", "x = a / b;"],
			["if (a) {}\n/x/.test(s);", "if (a) {}\n/x/.test(s);"],
			["try {} catch {}\n/x/.test(s);", "try {} catch {}\n/x/.test(s);"],
			["switch (a) {}\n/x/.test(s);", "switch (a) {}\n/x/.test(s);"],
			["do {} while (a) /x/.test(s);", "do {} while (a) /x/.test(s);"],
			["async function f(xs) { for await (const x of xs) /x/.test(x); }", "async function f(xs) { for await (const x of xs) /x/.test(x); }"],
			["x = a.yield / a.await / a?.of / 2;", "x = a.yield / a.await / a?.of / 2;"],
			["x = a-->b;", "x = a-->b;"],
			["x = a /* c */ -->b;", "x = a /* c */ -->b;"],
			["x = a\n++b;", "x = a\n++b;"],
			["x = { a: /b/ } / 2;", "x = { a: /b/ } / 2;"],
			["x = a ? /b/ : /c/g;", "x = a ? /b/ : /c/g;"],
			["x = /[/]\\//g / 2;", "x = /[/]\\//g / 2;"],
			["x = .5 / 0x1F / 1_000n / 1e3 / 1.;", "x = .5 / 0x1F / 1_000n / 1e3 / 1.;"],
			["x = a?.5:1 / 2;", "x = a?.5:1 / 2;"],
			["x = \\u0061 / this.#b / c;", "x = \\u0061 / this.#b / c;"],
			["x = `" + OPEN_SLOT__ + "{ a: 1 }.a / 2}`;", "x = `" + OPEN_SLOT__ + "{ a: 1 }.a / 2}`;"],
			["x = () => {}\n/x/.test(s);", "x = () => {}\n/x/.test(s);"],
			["x = typeof /a/;\ny = void /b/;", "x = typeof /a/;\ny = void /b/;"],
			["/a/.test(s);", "/a/.test(s);"],
			["x /= 2; y = a\\u0062c / 2;", "x /= 2; y = a\\u0062c / 2;"],
			["x = -a + ++b - --c / /d/.lastIndex;", "x = -a + ++b - --c / /d/.lastIndex;"],
			["async function f() { return await {a: 1} / 2; }", "async function f() { return await {a: 1} / 2; }"]
		];

		for (const [input, expected] of certain)
		{
			expect(js(`${input}${tail}`)).toBe(`${expected}\nfoo();`);
		}
	});

	it("minify JS edits after each certain block or expression brace and each control head (positive control, green on main)", () =>
	{
		// each line pins one entry of the brace-kind and control-head lists: without it, the "/" after the "}"
		// or ")" is uncertain (refused) or read as division (the quote then opens a string that meets a newline)
		const certain = [
			"if (a) {} else {}\n/x/.test(s);",
			"try {} finally {}\n/x/.test(s);",
			"switch (a) { case {} / 2: }",
			"x = delete {} / 2;",
			"x = a in {} / 2;",
			"x = a instanceof {} / 2;",
			"x = new {} / 2;",
			"function f() { return {} / 2; }",
			"function f() { throw {} / 2; }",
			"x = typeof {} / 2;",
			"x = void {} / 2;",
			"x = 1;\n{}\n/'/.test(s);",
			"{{}\n/'/.test(s);}",
			"x = () => {}\n/'/.test(s);",
			"{}{}\n/x/.test(s);",
			"{}\n/x/.test(s);",
			"for (;;) {}\n/x/.test(s);",
			"while (a) {}\n/x/.test(s);",
			"with (a) {}\n/x/.test(s);",
			"if (a) /'/.test(s);",
			"while (a) /'/.test(s);",
			"with (a) /'/.test(s);"
		];

		for (const input of certain)
		{
			expect(js(`${input}${tail}`)).toBe(`${input}\nfoo();`);
		}
	});

	it("minify JS refuses a slash it cannot classify", () =>
	{
		const uncertain = [
			"let yield = 1; x = yield / 2;",
			"let await = 1; x = await / 2;",
			"let of = 1; x = of / 2;",
			"for (const k of /a/g.exec(s)) {}",
			"while (a) { break\n/x/.test(s); }",
			"while (a) { continue\n/x/.test(s); }",
			"L: while (a) { break L\n/x/.test(s); }",
			"debugger\n/x/.test(s);",
			"function f() {}\n/x/.test(s);",
			"class A {}\n/x/.test(s);",
			"export default class {}\n/x/.test(s);",
			"L: {}\n/x/.test(s);",
			"for (const k of {} / 1) {}",
			"x = 1\n{}\n/x/.test(s);",
			"x = 'a'\n{}\n/x/.test(s);",
			"x = `a`\n{}\n/x/.test(s);",
			"x = /a/\n{}\n/x/.test(s);",
			"x = a[0]\n{}\n/x/.test(s);",
			"x = a++\n{}\n/x/.test(s);",
			"break\n{}\n/x/.test(s);"
		];

		for (const input of uncertain)
		{
			expect(js(`${input}${tail}`)).toBe(`${input}\nfoo();  \n// drop`);
		}
	});

	it("minify JS refuses HTML-like comments", () =>
	{
		const htmlLike = [
			"x = a\n<!-- b",
			"x = a <!--b;",
			"x = a\n--> b",
			"x = a\n  \t--> b",
			"x = a\n/* c */ --> b",
			"x = a /*\n*/ --> b",
			"x = a // c\n--> b",
			"--> b",
			"#!/usr/bin/env node\n--> b"
		];

		for (const input of htmlLike)
		{
			expect(js(`${input}${tail}`)).toBe(`${input}\nfoo();  \n// drop`);
		}
	});

	it("minify JS refuses a file that does not scan consistently", () =>
	{
		const broken = [
			"x = 'a",
			"x = \"a\\\"",
			"x = `a",
			"x = `" + OPEN_SLOT__ + "a",
			"x = `" + OPEN_SLOT__ + "a)`",
			"x = /a",
			"x = /a\\\n/;",
			"x = /a\n/;",
			"x = /[/]",
			"f(a];",
			"f(a;",
			"f(a));",
			"x = [a);",
			"{ ( }",
			"x = {",
			"}",
			"x = `a` }"
		];

		for (const input of broken)
		{
			expect(js(`${input}${tail}`)).toBe(`${input}\nfoo();  \n// drop`);
		}
	});

	it("minify JS refuses a file that is open at its end", () =>
	{
		const open = ["x = 'a", "x = `a", "x = /a", "/* a", "f(", "x = [", "x = {", "x = `" + OPEN_SLOT__ + "a"];

		for (const input of open)
		{
			expect(js(`foo();  \n// drop\n${input}`)).toBe(`foo();  \n// drop\n${input}`);
		}
	});

	it("minify JS refuses when the comment-stripped text no longer scans", () =>
	{
		// removing the leading comment turns "#!" into a hashbang, which swallows a backtick
		const input = "/* x */#! `\n`";

		expect(js(input.replace("/* x */", "/* x */ "))).toBe("#! `\n`");
		expect(js(input)).toBe(input);
	});
});

describe("main already does this right (green on main)", () =>
{
	it("minify JS keeps main's exact output on plain code", () =>
	{
		const cases = [
			["/** doc */\nfunction f() {}\n", "function f() {}"],
			["a();\n  /* a */ b();\n", "a();\n   b();"],
			["a();\n\t// c\n\tb();\n", "a();\n\tb();"],
			["a();\t \n\n\n  \nb();  \n", "a();\nb();"],
			["x = 1; /* not at a line start */\ny = 2; // nor this\n", "x = 1; /* not at a line start */\ny = 2; // nor this"],
			["x = '//';\ny = \"/* */\";\n", "x = '//';\ny = \"/* */\";"],
			["x = /\\/\\/ c/;\n", "x = /\\/\\/ c/;"],
			["#!/usr/bin/env node\n// c\nfoo();", "#!/usr/bin/env node\nfoo();"],
			["/*\n * a\n */\n\n// b\nexport { a };\n", "export { a };"],
			["\uFEFFvar bom = 1;", "var bom = 1;"],
			["x = `a`;\n// c\n", "x = `a`;"],
			["x = 'a'  \ny = `b`\t\nz = /c/ \n", "x = 'a'\ny = `b`\nz = /c/"],
			["  \n\t\n", ""],
			["", ""]
		];

		for (const [input, expected] of cases)
		{
			expect(js(input)).toBe(expected);
		}
	});

	it("minify JS removes a one-line inline script payload's comment, as main does", () =>
	{
		// payloads from the HTML probes: the HTML minifier decides what reaches minifyJs__
		const payloads = [" //keep", "//<frame src=x>", "//<col span=2>", "//keep&#10;keep=1", "//c&#10;alert(1)"];

		for (const payload of payloads)
		{
			expect(js(payload)).toBe("");
		}
	});
});

describe("stripJsComments__ with a comment filter", () =>
{
	/**
	 * @description Deterministic 32-bit PRNG (mulberry32), uniform in [0, 1).
	 * @param {number} seed - Initial state.
	 * @return {function(): number} Generator.
	 */
	function prng(seed)
	{
		let state = seed;

		return () =>
		{
			state = (state + 0x6D2B79F5) | 0;
			let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
			mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);

			return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
		};
	}

	/**
	 * @description Random strings over an alphabet of comment, line and template characters.
	 * @param {number} count - Number of strings.
	 * @return {Array<string>} The strings.
	 */
	function randomInputs(count)
	{
		const alphabet = ["/", "/", "*", "*", "\n", "\r", "\u2028", " ", "\t", "a", "`", "'", "→"];
		const random = prng(47101);
		const inputs = [];
		for (let round = 0; round < count; round++)
		{
			let input = "";
			const length = Math.floor(random() * 30);
			for (let index = 0; index < length; index++)
			{
				input += alphabet[Math.floor(random() * alphabet.length)];
			}

			inputs.push(input);
		}

		return inputs;
	}

	it("strip with a filter that allows every index is the strip without a filter", () =>
	{
		const everyIndex = { has: () => true };
		const inputs = randomInputs(50000);
		const expected = inputs.map(input => stripJsComments__(input));

		// premise: many inputs have a comment to strip
		expect(inputs.filter((input, index) => expected[index] !== input).length).toBeGreaterThanOrEqual(5000);

		expect(inputs.map(input => stripJsComments__(input, everyIndex))).toEqual(expected);
		expect(inputs.map(input => stripJsComments__(input, null))).toEqual(expected);
	}, SLOW_TEST_MS__);

	it("strip with an empty filter removes nothing", () =>
	{
		const inputs = randomInputs(50000);

		// positive control: the same inputs lose comments without the filter
		expect(inputs.filter(input => stripJsComments__(input) !== input).length).toBeGreaterThanOrEqual(5000);

		expect(inputs.map(input => stripJsComments__(input, new Set()))).toEqual(inputs);
	}, SLOW_TEST_MS__);

	it("strip removes only the comments the filter names", () =>
	{
		expect(stripJsComments__("// a\n// b\n/* c */\n")).toBe("\n\n\n");
		expect(stripJsComments__("// a\n// b\n/* c */\n", new Set([5, 10]))).toBe("// a\n\n\n");
	});

	it("strip skips a filtered-out block through its */ as main does", () =>
	{
		const input = "x = `\n/* a`;\n// b\nfoo(); /* c */\nbar();";

		// premise: main removes the whole run from the template's "/*" to the next "*/"
		expect(stripJsComments__(input)).toBe("x = `\n\nbar();");

		// "// b" is a real comment, but main never removes it apart from that run, so neither does the filter
		expect(stripJsComments__(input, new Set([input.indexOf("// b"), input.indexOf("/* c")]))).toBe(input);
	});
});

describe("scanJs__", () =>
{
	it("scan returns the protected spans and the comment starts", async() =>
	{
		const { scanJs__ } = await lexer();
		const input = "#!x\nx = \"a\" + 'b' + `c" + OPEN_SLOT__ + "d}e` + /f/g; // g\n/* h */";

		expect(scanJs__(input)).toEqual({
			commentStarts: new Set([0, input.indexOf("// g"), input.indexOf("/* h")]),
			protectedSpans: [8, 11, 14, 17, 21, 22, 26, 27, 31, 35]
		});
	});

	it("scan protects a string that U+2028 or a continuation crosses", async() =>
	{
		const { scanJs__ } = await lexer();

		expect(scanJs__("x = 'a\u2028b\\\r\nc';").protectedSpans).toEqual([4, 13]);
		expect(scanJs__("x = 'a\nb';")).toBeNull();
		expect(scanJs__("x = 'a\rb';")).toBeNull();
	});

	it("scan reads regex flags up to the first non-identifier character", async() =>
	{
		const { scanJs__ } = await lexer();

		expect(scanJs__("x = /a/gu\u00A0;").protectedSpans).toEqual([4, 9]);
		expect(scanJs__("x = /a/gu\u2028;").protectedSpans).toEqual([4, 9]);
	});
});

describe("U+0001 in JS input", () =>
{
	it("minify JS passes U+0001 through in strings, templates, regexes and comments", () =>
	{
		const input = "const a = '\u0001';\n// \u0001\nconst t = `\u0001  \n\u0001" + OPEN_SLOT__ + "a}\u0001`;  \n/\u0001/.test(a); /* \u0001 */\n\u0001\n";

		expect(js(input)).toBe("const a = '\u0001';\nconst t = `\u0001  \n\u0001" + OPEN_SLOT__ + "a}\u0001`;\n/\u0001/.test(a); /* \u0001 */\n\u0001");
	});

	it("minify JS keeps U+0001 next to every trigger character", () =>
	{
		const input = "x = `\u0001\n// \u0001\n/* \u0001 */\u0001`;\n\u0001// c\n\u0001/* c */\n";

		expect(js(input)).toBe("x = `\u0001\n// \u0001\n/* \u0001 */\u0001`;\n\u0001// c\n\u0001/* c */");
	});

	it("minify JS keeps many U+0001 characters", () =>
	{
		const input = `x = [${"'\u0001', `\u0001\u0001`, ".repeat(5000)}];\n// drop\n`;

		expect(js(input)).toBe(`x = [${"'\u0001', `\u0001\u0001`, ".repeat(5000)}];`);
	});
});

describe("JS scan in linear time", () =>
{
	/**
	 * @description Minifies JS under the CPU bound and checks the output exactly.
	 * @param {string} input - JS of at least 500k characters with a character above U+00FF.
	 * @param {string} expected - Expected output.
	 */
	function expectLinear(input, expected)
	{
		// premise: large and two-byte
		expect(input.length).toBeGreaterThanOrEqual(500000);
		expect(input).toContain(TWO_BYTE__);

		let output = "";
		expect(cpuMs__(() =>
		{
			output = js(input);
		})).toBeLessThan(CPU_MS__);
		expect(difference__(output, expected)).toBeNull();
	}

	it("minify JS scans a long string, template and regex", () =>
	{
		const body = `${TWO_BYTE__}${"a".repeat(LARGE__)}`;

		expectLinear(`x = "${body}";\n// drop\n`, `x = "${body}";`);
		expectLinear(`x = \`${body}\`;\n// drop\n`, `x = \`${body}\`;`);
		expectLinear(`x = /${body}/u;\n// drop\n`, `x = /${body}/u;`);
	}, SLOW_TEST_MS__);

	it("minify JS keeps a template of many lines with trailing whitespace", () =>
	{
		const body = `${TWO_BYTE__}${"a  \n// k\n".repeat(LARGE__ / 10)}`;

		expectLinear(`x = \`${body}\`;  \n// drop\n`, `x = \`${body}\`;`);
	}, SLOW_TEST_MS__);

	it("minify JS scans deeply nested template slots", () =>
	{
		const count = 100000;
		const nested = `x = \`${`${OPEN_SLOT__}\``.repeat(count)}${TWO_BYTE__}${"`}".repeat(count)}\`;`;

		expectLinear(`${nested}\n// drop\n`, nested);
	}, SLOW_TEST_MS__);

	it("minify JS scans many nested and sequential braces", () =>
	{
		const nested = `x = '${TWO_BYTE__}';\n${"{".repeat(LARGE__ / 2)}${"}".repeat(LARGE__ / 2)}`;
		const blocks = `x = '${TWO_BYTE__}';\n${"if (a) {} /b/.test(c);\n".repeat(LARGE__ / 24)}`;

		expectLinear(`${nested}\n// drop\n`, nested);
		expectLinear(`${blocks}// drop\n`, blocks.trim());
	}, SLOW_TEST_MS__);

	it("minify JS scans many slash tokens", () =>
	{
		const divisions = `x = '${TWO_BYTE__}' ${"/ a ".repeat(LARGE__ / 4)};`;
		const regexes = `x = ['${TWO_BYTE__}', ${"/a/g, ".repeat(LARGE__ / 6)}];`;
		const parens = `x = '${TWO_BYTE__}' + ${"f(".repeat(LARGE__ / 3)}${")".repeat(LARGE__ / 3)};`;

		expectLinear(`${divisions}\n// drop\n`, divisions);
		expectLinear(`${regexes}\n// drop\n`, regexes);
		expectLinear(`${parens}\n// drop\n`, parens);
	}, SLOW_TEST_MS__);

	it("minify JS reads identifiers of many escapes, and refuses a long \\u{ with no } once (diff r4)", () =>
	{
		const escapes = `x = '${TWO_BYTE__}'; const ${"\\u{78}\\u0079".repeat(LARGE__ / 12)} = 1;`;
		const unclosed = `x = '${TWO_BYTE__}'; \\u{${"7".repeat(LARGE__)}\n// kept\n`;

		expectLinear(`${escapes}\n// drop\n`, escapes);
		expectLinear(unclosed, unclosed.trim());
	}, SLOW_TEST_MS__);

	it("minify JS refuses an unclosed /* once", () =>
	{
		const unclosed = `x = '${TWO_BYTE__}';\n/*${"a".repeat(LARGE__)}`;
		const lines = `x = '${TWO_BYTE__}';\n${"/*a\n".repeat(LARGE__ / 4)}`;

		expectLinear(unclosed, unclosed);
		expectLinear(lines, lines.trim());
	}, SLOW_TEST_MS__);

	it("minify JS checks many --> operators", () =>
	{
		const oneLine = `x = '${TWO_BYTE__}'; ${"a-->b; ".repeat(LARGE__ / 7)}`;
		const manyLines = `x = '${TWO_BYTE__}';\n${"a-->b;\n".repeat(LARGE__ / 7)}`;

		expectLinear(`${oneLine}\n// drop\n`, oneLine.trim());
		expectLinear(`${manyLines}// drop\n`, manyLines.trim());
	}, SLOW_TEST_MS__);

	it("minify JS scans many comments, strings and templates", () =>
	{
		const comments = `x = '${TWO_BYTE__}';\n${"// c\n/* c */ a;\n".repeat(LARGE__ / 16)}`;
		const literals = `x = '${TWO_BYTE__}';\n${"`a`; 'b';  \n".repeat(LARGE__ / 12)}`;

		expectLinear(comments, `x = '${TWO_BYTE__}';\n${" a;\n".repeat(LARGE__ / 16)}`.trim());
		expectLinear(literals, `x = '${TWO_BYTE__}';\n${"`a`; 'b';\n".repeat(LARGE__ / 12)}`.trim());
	}, SLOW_TEST_MS__);

	it("minify JS scans a long identifier, number and whitespace run", () =>
	{
		const identifier = `x = '${TWO_BYTE__}' + a${"b".repeat(LARGE__)};`;
		const number = `x = '${TWO_BYTE__}' + 1${"0".repeat(LARGE__)};`;
		const spaces = `x = '${TWO_BYTE__}';${" ".repeat(LARGE__)}\nfoo();`;

		expectLinear(identifier, identifier);
		expectLinear(number, number);
		expectLinear(spaces, `x = '${TWO_BYTE__}';\nfoo();`);
	}, SLOW_TEST_MS__);

	it("scan skips a whitespace run that does not end a line in linear time", async() =>
	{
		// through minify__ such a run meets main's /\s+$/gum, whose quadratic cost is item 47108's
		const { scanJs__ } = await lexer();
		const input = `x = '${TWO_BYTE__}';${" \t\u00A0".repeat(LARGE__ / 3)}y();`;
		let scan = null;

		expect(cpuMs__(() =>
		{
			scan = scanJs__(input);
		})).toBeLessThan(CPU_MS__);
		expect(scan.protectedSpans).toEqual([4, 7]);
	}, SLOW_TEST_MS__);
});

describe("minify JS on hulk's own source", () =>
{
	const root = fileURLToPath(new URL("..", import.meta.url));
	const linter = new Linter();
	const notCode = new Set(["start", "end", "loc", "range", "comments", "parent"]);

	/**
	 * @description Parses a JS module with ESLint's parser, comments included.
	 * @param {string} code - Module source.
	 * @return {Object} The AST, with a comments array.
	 */
	function parse(code)
	{
		const messages = linter.verify(code, [
			{
				languageOptions: {
					ecmaVersion: "latest",
					sourceType: "module"
				}
			}
		]);

		// premise: the module parsed
		expect(messages).toEqual([]);

		return linter.getSourceCode().ast;
	}

	/**
	 * @description The code of an AST without positions or comments.
	 * @param {Object} ast - Parsed module.
	 * @return {string} JSON of the code.
	 */
	function codeOf(ast)
	{
		return JSON.stringify(ast, (key, value) =>
		{
			if (value === null || typeof value !== "object" || Array.isArray(value))
			{
				return value;
			}

			return Object.fromEntries(Object.entries(value).filter(([name]) => !notCode.has(name)));
		});
	}

	it("minify JS keeps the code of every src module and strips the JS modules' comments", () =>
	{
		const files = readdirSync(`${root}src`).filter(name => name.endsWith(".js"));

		// premise: the JS minifier's own modules are among them
		expect(files).toEqual(expect.arrayContaining(["JsComments.js", "JsLexer.js", "JsMinifier.js"]));

		for (const name of files)
		{
			const source = readFileSync(`${root}src/${name}`, "utf8");
			const built = parse(js(source));

			expect([name, codeOf(built)]).toEqual([name, codeOf(parse(source))]);

			if (name.startsWith("Js"))
			{
				expect(parse(source).comments.length).toBeGreaterThan(0);
				expect([name, built.comments]).toEqual([name, []]);
			}
		}
	}, SLOW_TEST_MS__);
});
