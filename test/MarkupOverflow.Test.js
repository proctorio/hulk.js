import minify__ from "../src/index.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// 8 MB runs overflow V8's regexp backtrack stack in the regexes these minifiers used before (WI 47095). The repo blocks
// blobs over 5 MB, so every input is generated here. "→" (U+2192) keeps the subject a two-byte string, the shape that
// overflows the u-flag regexes; the one-byte CSS and SVG cases overflowed without it.
const SIZE__ = 8 * 1024 * 1024;
const RUN__ = "x".repeat(SIZE__);
const BASE64__ = "QUJD".repeat(SIZE__ / 4);

// Wall-clock allowance per test, generous because a busy machine can stretch these seconds-long runs several times over;
// what each test checks is its output (and, for the workloads, CPU time), not this.
const TIMEOUT_MS__ = 120000;

describe("minify__ on large comments, data URIs and pre blocks", { timeout: TIMEOUT_MS__ }, () =>
{
	it("CSS strips an 8 MB inline source map comment from a one-byte file", () =>
	{
		const css = `a { color: red; }\n/*# sourceMappingURL=data:application/json;base64,${BASE64__} */\n`;

		expect(difference__(minify__(css, "css"), "a{color:red}")).toBeNull();
	});

	it("CSS strips an 8 MB inline source map comment from a two-byte file", () =>
	{
		const css = `a { content: "→"; }\n/*# sourceMappingURL=data:application/json;base64,${BASE64__} */\n`;

		expect(difference__(minify__(css, "css"), "a{content:\"→\"}")).toBeNull();
	});

	it("CSS keeps an 8 MB unterminated comment as it is", () =>
	{
		const css = `a { content: "→"; }\n/*${RUN__}`;

		expect(difference__(minify__(css, "css"), `a{content:"→"}/*${RUN__}`)).toBeNull();
	});

	it("HTML unquotes an 8 MB data: URI src", () =>
	{
		const html = `<p>→</p>\n<img src="data:image/png;base64,${BASE64__}" alt="a">`;

		expect(difference__(minify__(html, "html"), `<p>→</p><img src=data:image/png;base64,${BASE64__} alt="a">`)).toBeNull();
	});

	it("HTML unquotes an 8 MB href", () =>
	{
		const html = `<p>→</p>\n<a href='${RUN__}'>b</a>`;

		expect(difference__(minify__(html, "html"), `<p>→</p><a href=${RUN__}>b</a>`)).toBeNull();
	});

	it("HTML strips an 8 MB comment", () =>
	{
		const html = `<p>→</p>\n<!--${RUN__}-->\n<p>b</p>`;

		expect(difference__(minify__(html, "html"), "<p>→</p><p>b</p>")).toBeNull();
	});

	it("HTML keeps an 8 MB pre block as it is", () =>
	{
		const html = `<p>→</p>\n<pre>\n  ${RUN__}\n</pre>`;

		expect(difference__(minify__(html, "html"), `<p>→</p> <pre>\n  ${RUN__}\n</pre>`)).toBeNull();
	});

	it("HTML keeps a pre block whose opening tag is 8 MB", () =>
	{
		const html = `<p>→</p>\n<pre class="${RUN__}">x</pre>`;

		expect(difference__(minify__(html, "html"), `<p>→</p> <pre class="${RUN__}">x</pre>`)).toBeNull();
	});

	it("HTML keeps an 8 MB code block whose closing tag differs in case", () =>
	{
		const html = `<p>→</p>\n<CODE class="a">\n${RUN__}</code >\n</Code>`;

		expect(difference__(minify__(html, "html"), `<p>→</p> <CODE class="a">\n${RUN__}</code >\n</Code>`)).toBeNull();
	});

	it("HTML leaves an 8 MB unterminated pre block in place", () =>
	{
		const html = `<p>→</p>\n<pre>${RUN__}`;

		expect(difference__(minify__(html, "html"), `<p>→</p><pre>${RUN__}`)).toBeNull();
	});

	it("HTML drops the self-closing slash on a void tag with an 8 MB attribute", () =>
	{
		const html = `<p>→</p>\n<img alt="${RUN__}" />`;

		expect(difference__(minify__(html, "html"), `<p>→</p><img alt="${RUN__}">`)).toBeNull();
	});

	it("HTML handles a long whitespace run inside a void tag in linear time", () =>
	{
		// main's lazy [^>]*? plus \s*\/> rescanned the run from every position: 64K spaces took 12 s, 128K about 50 s
		const html = `<p>→</p>\n<img src=x${" ".repeat(128 * 1024)}>`;
		let output = "";
		const took = cpuMs__(() =>
		{
			output = minify__(html, "html");
		});

		expect(difference__(output, "<p>→</p><img src=x>")).toBeNull();
		expect(took).toBeLessThan(3000);
	});

	it("SVG strips an 8 MB comment from a one-byte file", () =>
	{
		const svg = `<svg><text>a</text>\n<!--${RUN__}-->\n</svg>`;

		expect(difference__(minify__(svg, "svg"), "<svg><text>a</text></svg>")).toBeNull();
	});

	it("SVG strips an 8 MB comment from a two-byte file", () =>
	{
		const svg = `<svg><text>→</text>\n<!--${RUN__}-->\n</svg>`;

		expect(difference__(minify__(svg, "svg"), "<svg><text>→</text></svg>")).toBeNull();
	});
});
