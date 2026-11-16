import { vi } from "vitest";
import minify__ from "../src/index.js";

// WI 47221: CSS comments and escaped function names, on top of the scanner of WI 47101 (src/CssMinifier.js).
//
// - A comment is a gap, not a token, and dropping it must not make its two neighbours one token ("1px/**/2px" is two
//   tokens, "1px2px" is one invalid dimension). A run of adjacent comments is decided once, at its end, with L the last
//   character the scan emitted (whitespace when a newline run is pending) and R the first input character after it:
//   1. L absent (start) or R absent (end of input): dropped.
//   2. L is a vault marker (escape, string, url, bad string, kept comment): kept as "/**/". A restored escape takes a
//      following whitespace or hex digit as its own ("\31/**/ b" must stay a descendant selector).
//   3. L or R is CSS whitespace, or one of { } ; : , ) [ ], or L is "(": dropped.
//   4. Otherwise kept as "/**/", a vaulted span no later rule edits. A space is wrong in a selector (".a/**/.b" is one
//      compound selector, ".a .b" is two).
//   The rule is checked against @csstools/css-tokenizer on 7.2 million left/right pairs in the work item's tools (the
//   rule itself, not this scan) and the scan by the differentials listed in PLAN.md.
// - Function names are compared decoded (CSS Syntax 4.3.7): a name with an escape is read to its code points and
//   folded ASCII-only, so "u\72l(" is url( (its body is vaulted) and "st\79le(" is
//   style( (its group is vaulted). Every function whose name has an escape keeps WI 47101's "E" frame. "<!--" is a token
//   of its own: "<!--u\72l(" is the CDO and then url(, not the ident "--url".
// - After a ":" colonSpace__ vaults the whitespace and comments up to the next token: a declaration outside brackets
//   turns that span into a space the global rules drop, anywhere else the span stays as written (nothing fuses).

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

describe("CSS comments (WI 47221): a comment between two tokens that would fuse stays", () =>
{
	it("C1: the cases of the work item", () =>
	{
		expectCases([
			[".Ā{margin:1px/**/2px}", ".Ā{margin:1px/**/2px}"],
			[".Ā{z-index:1/**/0}", ".Ā{z-index:1/**/0}"],
			[".Ā{x:0/**/auto}", ".Ā{x:0/**/auto}"],
			[".Ā div/**/p{}", ".Ā div/**/p{}"],
			[".Ā{--n:1/**/0}", ".Ā{--n:1/**/0}"]
		]);
	});

	it("rule 4: names, numbers and operators next to a comment", () =>
	{
		expectCases([
			[".Ā{x:1/**/e3}", ".Ā{x:1/**/e3}"],
			[".Ā{x:1/**/%}", ".Ā{x:1/**/%}"],
			[".Ā{x:a-/**/-b}", ".Ā{x:a-/**/-b}"],
			[".Ā{x:a//**/*b}", ".Ā{x:a//**/*b}"],
			[".Ā{width:calc(1px/**/+/**/2px)}", ".Ā{width:calc(1px/**/+/**/2px)}"],
			[".Ā.a/**/.b{}", ".Ā.a/**/.b{}"],
			[".Ā{color:#aabbcc/**/dd}", ".Ā{color:#aabbcc/**/dd}"],
			[".Ā{x:1px/**/(a)}", ".Ā{x:1px/**/(a)}"]
		]);
	});

	it("rule 4: a run of comments is one decision", () =>
	{
		expectCases([
			[".Ā{margin:1px/**//* x *//**/2px}", ".Ā{margin:1px/**/2px}"],
			[".Ā{margin:1px/* a *//* b */ 2px}", ".Ā{margin:1px 2px}"],
			[".Ā{margin:1px /* a *//* b */2px}", ".Ā{margin:1px 2px}"]
		]);
	});

	it("rule 2: a vault marker before a comment keeps it", () =>
	{
		expectCases([
			[".Ā\\31/**/ .b{}", ".Ā\\31/**/ .b{}"],
			[".Ā{x:a\\31/**/2}", ".Ā{x:a\\31/**/2}"],
			[".Ā{x:a\\31/**/ b}", ".Ā{x:a\\31/**/ b}"],
			[".Ā{content:\"x\"/**/ attr(data-x)}", ".Ā{content:\"x\"/**/ attr(data-x)}"],
			[".Ā{content:'x'/**/b}", ".Ā{content:'x'/**/b}"],
			[".Ā{b:url(x)/**/c}", ".Ā{b:url(x)/**/c}"]
		]);
	});

	it("rules 1 and 3: a comment next to a separator, whitespace or an end goes", () =>
	{
		expectCases([
			[".Ā.a/**/{}", ".Ā.a{}"],
			[".Ā{x:1/**/;}", ".Ā{x:1}"],
			[".Ā a /**/ b{}", ".Ā a b{}"],
			["/**/.Ā{}", ".Ā{}"],
			[".Ā{}/**/", ".Ā{}"],
			[".Ā{x:1,/**/2}", ".Ā{x:1,2}"],
			[".Ā{x:f(/**/1)}", ".Ā{x:f(1)}"],
			[".Ā{x:f(1/**/)}", ".Ā{x:f(1)}"],
			[".Ā[/**/a]{}", ".Ā[a]{}"],
			[".Ā{x:1\n/**/2}", ".Ā{x:1 2}"],
			[".Ā{x:1/**/\n2}", ".Ā{x:1 2}"],
			[".Ā{x:1 /**/2}", ".Ā{x:1 2}"]
		]);
	});

	it("rule 3: each separator drops a comment on either side, and whitespace of any kind", () =>
	{
		for (const gap of "{};:,)[]")
		{
			expect(css(`.Ā{x:a/**/${gap}b}`), gap).toBe(`.Ā{x:a${gap}b}`);
			expect(css(`.Ā{x:a${gap}/**/b}`), gap).toBe(`.Ā{x:a${gap}b}`);
		}

		for (const space of [" ", "\t", "\n", "\f", "\r", "\r\n"])
		{
			// a form feed inside a value is kept as it is (WI 47101); the comment next to it is dropped all the same
			const joined = space === "\f" ? "\f" : " ";

			expect(css(`.Ā{x:a/**/${space}b}`), JSON.stringify(space)).toBe(`.Ā{x:a${joined}b}`);
			expect(css(`.Ā{x:a${space}/**/b}`), JSON.stringify(space)).toBe(`.Ā{x:a${joined}b}`);
		}

		// controls: the characters next to them are not separators
		expect(css(".Ā{x:a/**/b}")).toBe(".Ā{x:a/**/b}");
		expect(css(".Ā{x:a/**/(b)}")).toBe(".Ā{x:a/**/(b)}");
		expect(css(".Ā{x:(/**/b)}")).toBe(".Ā{x:(b)}");
	});

	it("rule 1: nothing before it, or nothing after it", () =>
	{
		expectCases([
			["a/**/", "a"],
			["/**/a", "a"],
			[".Ā{x:a/**/", ".Ā{x:a"],
			[".Ā{x:1}b/**//**/", ".Ā{x:1}b"],

			// the end of the input wins over a vault before the comment (rule 2 keeps it anywhere else, before a "}" too)
			[".Ā{content:\"x\"/* c */", ".Ā{content:\"x\""],
			[".a\\31/**/", ".a\\31"],
			["a{b:url(x)/**/", "a{b:url(x)"],
			[".Ā{content:\"x\"/* c */}", ".Ā{content:\"x\"/**/}"]
		]);
	});

	it("what is kept as written is kept to its edges, to the end of the input and in its spelling", () =>
	{
		expectCases([
			// a value that is kept as written: a comment at its start or end stays with the spaces between it and the value; only the outside goes
			[".Ā{--x:/* c */a}", ".Ā{--x:/* c */a}"],
			[".Ā{--x:a/* c */}", ".Ā{--x:a/* c */}"],
			[".Ā{--x:/* c */}", ".Ā{--x:/* c */}"],
			[".Ā{--x:/* c */  a}", ".Ā{--x:/* c */  a}"],
			[".Ā{--x:a  /* c */}", ".Ā{--x:a  /* c */}"],
			[".Ā{--x:  /* c */  a  /* d */  }", ".Ā{--x:/* c */  a  /* d */}"],

			// whitespace alone is the value: one space
			[".Ā{--x: }", ".Ā{--x: }"],
			[".Ā{--x:\t\t}", ".Ā{--x: }"],
			[".Ā{--x:\n\n;y:1}", ".Ā{--x: ;y:1}"],

			// an input that ends inside a comment, a group or a value: kept to its last character
			[".Ā{x:a/* c  d", ".Ā{x:a/* c  d"],
			[".Ā style(a/* c  d", ".Ā style(a/* c  d"],
			[".Ā style(  ", ".Ā style(  "],
			[".Ā{f({  ", ".Ā{f({  "],
			[".Ā{--x: ", ".Ā{--x: "],
			[".Ā{--x:a  ", ".Ā{--x:a "],
			[".Ā{--x:a  /* c */", ".Ā{--x:a  /* c */"],
			[".Ā{--x:/* a */  /* b */}", ".Ā{--x:/* a */  /* b */}"],

			// the spaces around a value are not part of it
			[".Ā{--x: a  }", ".Ā{--x:a}"],

			// the run after a colon that is not a declaration's is vaulted whole
			[".Ā:/* c */hover{}", ".Ā:/* c */hover{}"],
			["@supports (a: /* c */  b){.Ā{}}", "@supports (a: /* c */  b){.Ā{}}"],
			[".Ā{f(a: /* c */  b):x}", ".Ā{f(a: /* c */  b):x}"],

			// the newline a bad string or an invalid escape takes with it
			["\"a\n.Ā{}", "\"a\n.Ā{}"],
			["\"a\r\n.Ā{}", "\"a\r\n.Ā{}"],
			["\"a\r.Ā{}", "\"a\r.Ā{}"],
			["\"a\f.Ā{}", "\"a\f.Ā{}"],
			[".Ā{f(\\\n):{a;}}", ".Ā{f(\\\n):{a;}}"],

			// an at-rule whose name holds a vault is read as @property's: its initial-value stays as written, and so does a group in it
			["@\"s\"{initial-value:{a;}}.Ā{}", "@\"s\"{initial-value:{a;}}.Ā{}"],
			["@/**/a{initial-value:{a;}}.Ā{}", "@/**/a{initial-value:{a;}}.Ā{}"],
			["@\u0001{initial-value:{a;}}.Ā{}", "@\u0001{initial-value:{a;}}.Ā{}"],
			["@\\\n{initial-value:{a;}}.Ā{}", "@\\\n{initial-value:{a;}}.Ā{}"],
			["@a/**/+b{initial-value:a  b}.Ā{}", "@a/**/+b{initial-value:a  b}.Ā{}"],

			// the whole written name counts: "initial-value y" is no initial-value
			["@property --x{initial-value y:a  b}.Ā{}", "@property --x{initial-value y:a b}.Ā{}"],

			// a value is protected by a comment kept in its name, and by nothing that only looks like one
			[".Ā{a/**/+b:a  b}", ".Ā{a/**/+b:a  b}"],

			// a comment outside what is kept as written is one "/**/" or nothing: its payload goes
			[".Ā{x:a/* SECRET */b}", ".Ā{x:a/**/b}"],
			[".Ā{x:a/* c *//* d */b}", ".Ā{x:a/**/b}"],

			// an escape is kept as written, the number around it is still shortened
			[".Ā{x:0.5\\70x}", ".Ā{x:.5\\70x}"]
		]);
	});

	it("after a colon, comments are dropped or kept whole, and nothing fuses", () =>
	{
		expectCases([
			[".Ā:/*payload*/hover{}", ".Ā:/*payload*/hover{}"],
			[".Ā{b:/**/1}", ".Ā{b:1}"],
			[".Ā{b: /* a */ 1}", ".Ā{b:1}"],
			["@media (min-width:/**/100px){.Ā{}}", "@media (min-width:100px){.Ā{}}"],

			// a colon in a prelude that is no feature
			["@media .5:/* a */1", "@media .5:/* a */1"]
		]);
	});

	it("a string runs to its closing quote: a hex escape takes the one whitespace character after it, a newline included (WI 47820)", () =>
	{
		expectCases([
			// the string is kept as written, whatever the whitespace after the escape is
			["a{b:\"\\31\n  x  y\";c  :  1}", "a{b:\"\\31\n  x  y\";c:1}"],
			["a{b:\"\\31\r\n  x  y\";c  :  1}", "a{b:\"\\31\r\n  x  y\";c:1}"],
			["a{b:\"\\31\r  x  y\";c  :  1}", "a{b:\"\\31\r  x  y\";c:1}"],
			["a{b:\"\\31\f  x  y\";c  :  1}", "a{b:\"\\31\f  x  y\";c:1}"],
			["a{b:\"\\31\t  x  y\";c  :  1}", "a{b:\"\\31\t  x  y\";c:1}"],
			["a{b:'\\27\n  x  y';c  :  1}", "a{b:'\\27\n  x  y';c:1}"],

			// the newline after a hex escape and a space is bare: it ends the string
			["a{b:\"\\31 \n  x  y;c  :  1}", "a{b:\"\\31 \n x y;c:1}"],

			// a backslash and a newline is a line continuation
			["a{b:\"\\\n  x  y\";c  :  1}", "a{b:\"\\\n  x  y\";c:1}"],
			["a{b:\"\\\r\n  x  y\";c  :  1}", "a{b:\"\\\r\n  x  y\";c:1}"],

			// what stands in such a string is text, not a url( that ends at its first ")": the escaped and the plain name alike
			[".Ā{content:\"\\31\nu\\72l(style(()X/*PAYLOAD*/Y)\"}", ".Ā{content:\"\\31\nu\\72l(style(()X/*PAYLOAD*/Y)\"}"],
			[".Ā{content:\"\\31\nu\\72l(style(()hello  world)\"}", ".Ā{content:\"\\31\nu\\72l(style(()hello  world)\"}"],
			[".Ā{content:\"\\31\nurl(style(()X/*PAYLOAD*/Y)\"}", ".Ā{content:\"\\31\nurl(style(()X/*PAYLOAD*/Y)\"}"],
			[".Ā{content:\"\\31\nu\\72l(a)b/*P*/c\"}", ".Ā{content:\"\\31\nu\\72l(a)b/*P*/c\"}"],

			// an input that ends inside such a string
			["a{b:\"\\31\n  x  y", "a{b:\"\\31\n  x  y"],
			["a{b:\"x\\", "a{b:\"x\\"]
		]);
	});

	it("the same in a style element", () =>
	{
		const html = input => minify__(input, "html");
		const string = ".Ā{content:\"\\31\nu\\72l(style(()X/*PAYLOAD*/Y)\"}";

		expect(html(`<style>${string}</style>`)).toBe(`<style>${string}</style>`);
		expect(html("<style>a{b:\"\\31\n  x  y\";c  :  1}</style>")).toBe("<style>a{b:\"\\31\n  x  y\";c:1}</style>");
	});

	it("a comment inside a verbatim span is kept as written", () =>
	{
		expectCases([
			[".Ā{--x:a/* c */b}", ".Ā{--x:a/* c */b}"],
			["@container style(--x:a/**/b){.Ā{}}", "@container style(--x:a/**/b){.Ā{}}"]
		]);
	});

	it("an unterminated comment is vaulted to the end", () =>
	{
		expectCases([
			[".Ā{x:1/**/2}/* open", ".Ā{x:1/**/2}/* open"],

			// the run of terminated comments ends where the unterminated one starts: the run is kept, the rest is vaulted
			[".Ā{x:1/**//* open", ".Ā{x:1/**//* open"],
			[".Ā{x:1 /**//* open", ".Ā{x:1 /* open"]
		]);
	});

	it("a property name that holds a kept comment is unknown: its value stays as written", () =>
	{
		expectCases([
			[".Ā{a/**/b:0.0}", ".Ā{a/**/b:0.0}"],
			[".Ā{ab:0.0}", ".Ā{ab:.0}"]
		]);
	});
});

describe("CSS escaped function names (WI 47221)", () =>
{
	it("C2: an escaped url( keeps its body, quoted or not", () =>
	{
		expectCases([
			[".Ā{b:u\\72l(0.5.png)}", ".Ā{b:u\\72l(0.5.png)}"],
			[".Ā{b:u\\72l(/*x*/0.5.png)}", ".Ā{b:u\\72l(/*x*/0.5.png)}"],
			[".Ā{b:\\75rl(0.5.png)}", ".Ā{b:\\75rl(0.5.png)}"],
			[".Ā{b:U\\52L(0.5.png)}", ".Ā{b:U\\52L(0.5.png)}"],
			[".Ā{b:u\\72 l(0.5.png)}", ".Ā{b:u\\72 l(0.5.png)}"],
			[".Ā{b:u\\000072l(0.5.png)}", ".Ā{b:u\\000072l(0.5.png)}"],
			[".Ā{b:u\\72l( \"a  b\")}", ".Ā{b:u\\72l( \"a  b\")}"],
			[".Ā{b:u\\72l( img0.5.png )}", ".Ā{b:u\\72l( img0.5.png )}"]
		]);
	});

	it("C2: a name that decodes to something else is no url", () =>
	{
		// positive control: 6 digits make the escape, the seventh is a name char of its own
		expectCases([
			[".Ā{b:\\0000075rl(0.5.png)}", ".Ā{b:\\0000075rl(.5.png)}"],
			[".Ā{b:xu\\72l(0.5.png)}", ".Ā{b:xu\\72l(.5.png)}"],
			[".Ā{b:-u\\72l(0.5.png)}", ".Ā{b:-u\\72l(.5.png)}"],
			[".Ā{b:1u\\72l(0.5.png)}", ".Ā{b:1u\\72l(.5.png)}"],
			[".Ā{b:#u\\72l(0.5.png)}", ".Ā{b:#u\\72l(.5.png)}"],
			[".Ā{b:ſrl(0.5.png)}", ".Ā{b:ſrl(.5.png)}"],

			// an escape beyond ASCII is no letter, whatever its low bits spell (\175 is U+0175, its low byte is "u"), and NUL is none either
			[".Ā{b:\\175rl(0.5.png)}", ".Ā{b:\\175rl(.5.png)}"],
			[".Ā{b:\\10075rl(0.5.png)}", ".Ā{b:\\10075rl(.5.png)}"],
			[".Ā{b:\\0 rl(0.5.png)}", ".Ā{b:\\0 rl(.5.png)}"]
		]);
	});

	it("C2: a string next to a false url is not cut at its ) (Codex r2 and r4)", () =>
	{
		expectCases([
			[".Ā{b:\u0000u\\72l(a \"b)0.5\");}", ".Ā{b:\u0000u\\72l(a \"b)0.5\")}"],
			[".Ā{--x:\u0000u\\72l(a \"b)0.5\");}", ".Ā{--x:\u0000u\\72l(a \"b)0.5\")}"],
			[".Ā{b:\\41 url(a \"b)0.5\")}", ".Ā{b:\\41 url(a \"b)0.5\")}"],
			[".Ā{b:\\\\url(a \"b)0.5\")}", ".Ā{b:\\\\url(a \"b)0.5\")}"]
		]);
	});

	it("C2: <!-- is a token, the name after it is a url", () =>
	{
		expectCases([
			[".Ā{b:<!--u\\72l(0.5.png)}", ".Ā{b:<!--u\\72l(0.5.png)}"],
			[".Ā{b:<!--url(0.5.png)}", ".Ā{b:<!--url(0.5.png)}"],
			[".Ā{b:+u\\72l(0.5.png)}", ".Ā{b:+u\\72l(0.5.png)}"],
			[".Ā{b:1.u\\72l(0.5.png)}", ".Ā{b:1.u\\72l(0.5.png)}"],
			[".Ā{b:%u\\72l(0.5.png)}", ".Ā{b:%u\\72l(0.5.png)}"],

			// control: an escaped "<" is no CDO; "\\<", "!" and the function --url follow, and its string ends at its own quote (Codex r9)
			[".Ā{b:\\<!--u\\72l(a \"b)0.5\");}", ".Ā{b:\\<!--u\\72l(a \"b)0.5\")}"]
		]);
	});

	it("C2: an escaped style( keeps its group as written", () =>
	{
		expectCases([
			["@container st\\79le( --x:a  b ) { .Ā{} }", "@container st\\79le( --x:a  b ){.Ā{}}"],
			["@container ST\\59LE( --x:a  b ) { .Ā{} }", "@container ST\\59LE( --x:a  b ){.Ā{}}"],
			["@container st\\79 le( --x:a  b ) { .Ā{} }", "@container st\\79 le( --x:a  b ){.Ā{}}"],

			// the escape ends after six digits: the "e" that follows is a letter of the name, not a seventh digit
			["@container sty\\00006ce( --x:a  b ) { .Ā{} }", "@container sty\\00006ce( --x:a  b ){.Ā{}}"],
			["@container xst\\79le( --x:a  b ) { .Ā{} }", "@container xst\\79le( --x:a b ){.Ā{}}"]
		]);
	});

	it("C2: escaped element( and -moz-element( stay protected (WI 47101)", () =>
	{
		expectCases([
			[".Ā{b:el\\65ment(#aabbcc)}", ".Ā{b:el\\65ment(#aabbcc)}"],
			[".Ā{b:-moz-el\\65ment(#aabbcc)}", ".Ā{b:-moz-el\\65ment(#aabbcc)}"],
			[".Ā{b:-moz-el\\65mentx(#aabbcc)}", ".Ā{b:-moz-el\\65mentx(#aabbcc)}"],
			[".Ā{b:if(st\\79le(--x:#aabbcc):red)}", ".Ā{b:if(st\\79le(--x:#aabbcc):red)}"]
		]);
	});

	it("a function name longer than the longest compared one (12 code points) is not read to its end", () =>
	{
		// the same input with a space before the "(" has no function name to read: what the two differ by is what reading the name costs
		const reads = text =>
		{
			const spy = vi.spyOn(String.prototype, "charCodeAt");

			try
			{
				css(text);

				return spy.mock.calls.length;
			}
			finally
			{
				spy.mockRestore();
			}
		};
		const plain = "a".repeat(20000);
		const escaped = "\\61 ".repeat(20000);

		expect(reads(`.Ā{b:${plain}(x)}`) - reads(`.Ā{b:${plain} (x)}`)).toBeLessThan(200);
		expect(reads(`.Ā{b:${escaped}(x)}`) - reads(`.Ā{b:${escaped} (x)}`)).toBeLessThan(200);

		// 12 are read, 13 are not: -moz-element( keeps its id, the one longer than it is a function like any other
		expectCases([
			[".Ā{b:-moz-element(#aabbcc)}", ".Ā{b:-moz-element(#aabbcc)}"],
			[".Ā{b:-moz-elementx(#aabbcc)}", ".Ā{b:-moz-elementx(#abc)}"]
		]);
	});
});
