# Hulk.js

[![npm version](https://img.shields.io/npm/v/@proctorio/hulk.svg)](https://www.npmjs.com/package/@proctorio/hulk)
[![npm downloads](https://img.shields.io/npm/dm/@proctorio/hulk.svg)](https://www.npmjs.com/package/@proctorio/hulk)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Lightweight, zero-dependency minification library for HTML, CSS, SVG, JavaScript, and JSON content.

## Features

- 🚀 **Zero runtime dependencies** - Pure JavaScript implementation
- 🎯 **Simple API** - Single function with extension-based routing
- 🔧 **ES Modules** - Ships as an ES module
- ⚡ **Scanner-based** - HTML, CSS, SVG and JavaScript are read by a scanner that knows where strings, comments, tags and values are, so a rule edits only what it may; where the scanner cannot tell, the text stays as written: see [Minification Features](#minification-features) for what each type changes and its limits

## Installation

```bash
npm install @proctorio/hulk
```

## Usage

```javascript
import minify__ from '@proctorio/hulk';
// or: import { minify__ } from '@proctorio/hulk';

// Minify HTML: whitespace between tags goes, text keeps one space
const html = '<div>  <p>  Hello  </p>  </div>';
const minifiedHtml = minify__(html, 'html');
// Result: '<div><p> Hello </p></div>'

// Minify CSS with advanced optimizations
const css = `.class {
  color: #ffffff;
  margin: 0px;
  padding: 0.5em;
}`;
const minifiedCss = minify__(css, 'css');
// Result: '.class{color:#fff;margin:0;padding:.5em}'

// Minify JavaScript: comments that start a line go, the rest of the code is kept as written
const js = `function test() {
  // This comment starts a line, so it is removed
  return 42; // this one follows code, so it stays
}`;
const minifiedJs = minify__(js, 'js');
// Result: 'function test() {\n  return 42; // this one follows code, so it stays\n}'

// Minify JSON
const json = '{\n  "key": "value"\n}';
const minifiedJson = minify__(json, 'json');
// Result: '{"key":"value"}'

// Minify SVG
const svg = '<svg>  <circle cx="50" cy="50" r="40"/>  </svg>';
const minifiedSvg = minify__(svg, 'svg');
// Result: '<svg><circle cx="50" cy="50" r="40"/></svg>'
```

## API

### `minify__(content, extension)`

Minifies the provided content based on the file extension. Exported both as the default export and as the named export `minify__`.

**Parameters:**
- `content` (string): The content to minify
- `extension` (string): File type - `'html'`, `'css'`, `'svg'`, `'js'`, or `'json'`. Matched exactly: `'CSS'` or `'.css'` is not supported.

**Returns:**
- (string): Minified content
- `''` if `content` is not a string primitive (`null`, `undefined`, a number, an object, a `String` object)
- `content` unchanged, after a `console.warn("Extension provided is not supported. Returning same content.")`, if `extension` is not one of the five above

A leading UTF-8 byte order mark (U+FEFF) is removed from `content` before anything else, for every extension, including unsupported ones and invalid JSON.

**Supported Extensions:**
- `html` - Removes comments and the whitespace between tags, collapses whitespace in text, tidies tags and simple `href`/`src` values, and minifies inline `<style>` and `<script>`; `<pre>`, `<code>`, `<textarea>`, the DOCTYPE and attribute values are kept as written
- `css` - Removes comments, collapses whitespace, and shortens colors, zero lengths and leading zeros; strings, `url()` and custom properties are kept as written
- `svg` - Removes comments and the whitespace between elements, tidies tags, and shortens numbers in numeric attributes; text, `xml:space="preserve"` content and the XML declaration are kept as written
- `js` - Removes comments that start a line, trailing whitespace and blank lines; nothing else, and nothing inside a template literal, string or regex
- `json` - `JSON.stringify(JSON.parse(content))`; invalid JSON is returned unchanged

## Minification Features

HTML, CSS, SVG and JavaScript are minified by one scanner each. It reads the text the way the language does, sets aside what must stay byte for byte (strings, `url()` bodies, attribute values, raw text, `<pre>` blocks, template literals, regexes), runs the rules on the rest and puts the set-aside text back. Where it cannot tell what a piece of text is (an unterminated construct, markup a parser may read differently), it leaves that text, or the rest of the document, as written. JSON is parsed and serialized again. The "Limits" list under each type shows what is still changed or not read.

2.2 stopped rewriting text that 2.1 changed by mistake, so some 2.1 results differ and files come out a little larger (HTML by a few percent, CSS, SVG and JavaScript by a fraction of a percent on real files):
- **CSS**: id selectors such as `#ffeedd{}`, 8-digit colors, strings, `url()` bodies, custom properties and zero lengths inside `calc()` are kept; a line break between two tokens becomes a space instead of nothing
- **HTML**: `type="text/javascript"`, `type="text/css"` and boolean attribute values (`checked="checked"`) are kept; the `=` and `>` spacing no longer reaches text, and neither it nor space collapsing reaches attribute values or `<textarea>` text; `<script>` and `<style>` payloads are minified with the JavaScript and CSS rules instead of being flattened onto one line; only HTML whitespace is collapsed (a non-breaking space stays); a document that mentions `white-space` keeps its text whitespace; `<pre>` blocks are put back as written (no `$` patterns, no `__PRESERVE_BLOCK_n__` collisions)
- **SVG**: `xml:space="preserve"` and text content, single line breaks, the XML declaration, ids and other text are kept; numbers change only in numeric attributes
- **JavaScript**: lines inside template literals, string continuations and regexes are kept

### CSS Optimizations
- ✅ **Comment removal**: `/* ... */` comments are removed (`a{color:red;/* c */margin:1px}` → `a{color:red;margin:1px}`). An unterminated `/*` is kept, with everything after it
- ✅ **Whitespace**: a run of line breaks and tabs is removed after `{`, `}`, `;` and `,` and at the ends of the file, and is one space anywhere else (`.a\n.b{}` → `.a .b{}`, `a{transition:opacity 1s\n\tease}` → `a{transition:opacity 1s ease}`). Runs of spaces collapse to one; spaces are removed after `{`, `;` and `,`, before `{`, `}` and `!`, and after the `:` of a declaration or a media feature, and before it when a space follows it too (`a{color : red !important}` → `a{color:red!important}`). Other spaces are kept: `a ,b{}`, `div > p{}`, `a: hover{}`, `a{color :red}`, `a{width:calc(100% - 10px)}`
- ✅ **Zero unit removal**: `a{margin:0px}` → `a{margin:0}`, for `px`, `em`, `rem`, `vh`, `vw`, `vmin`, `vmax`, `cm`, `mm`, `in`, `pt`, `pc`, `ex` and `ch` (any case). Only in properties where a unitless zero means the same (margins, paddings, offsets, sizes, borders, radii, outline, gaps, spacing, `font-size`, `background`, shadows and a few more), only for a whole `0` + unit token that follows a space or a colon at the top level of the value, so not inside `calc()` or any other function (`a{width:calc(100% - 0px)}` stays), and not after a comma. Other units are kept (`0%`, `0deg`, `0s`), and so is `a{line-height:0px}`
- ✅ **Leading zero removal**: `a{margin:0.5em}` → `a{margin:.5em}`, `a{margin:-0.5em}` → `a{margin:-.5em}`, on whole number tokens only (`a0.5s` and the `0.5` in `10.0.5` keep theirs)
- ✅ **Trailing semicolon removal**: `a{color:red;}` → `a{color:red}`
- ✅ **Hex color compression**: `a{color:#ffffff}` → `a{color:#fff}`, `a{color:#112233}` → `a{color:#123}`, when each pair repeats a digit and has the same case (`#aAbBcC` is kept). Only a whole 6-digit value in a declaration of a style rule: not selectors (`#ffeedd{color:red}`), 8-digit colors (`a{color:#aabbccdd}`), `a{background:url(#aabbcc)}`, custom properties or inside `element()` and `style()`
- ✅ **Kept as written**: strings (`a{content:"a   b /* x */ c"}`), escapes, `url()` bodies (`a{background:url(img0.5.png)}`), custom property values (`:root{--y:#ffffff}`) and `@property` `initial-value`

Limits:
- **A comment removal can fuse two tokens**: `a{opacity:1/**/0}` → `a{opacity:10}`
- **Function names spelled with an escape** are not read as `url(`, so the rules reach into the body: `a{background:u\72l( a  0.5.png )}` → `a{background:u\72l( a .5.png )}`

### HTML Optimizations
- ✅ **Whitespace between tags**: a run of whitespace alone between two tags is removed (`<ul>\n  <li>a</li>\n</ul>` → `<ul><li>a</li></ul>`). Comments do not break the chain, so `<p>a</p> <!-- c --> <p>b</p>` → `<p>a</p><p>b</p>`
- ✅ **Whitespace in text**: a tab, a line feed, or a run of two or more whitespace characters becomes one space, and the document is trimmed (`<p>  Hello  </p>` → `<p> Hello </p>`). Only HTML whitespace counts (space, tab, line feed, form feed, carriage return), so `&nbsp;` and U+00A0 stay. A run that does not sit alone between two tags is not removed, so one space can remain beside a `<pre>` or `<code>` block, a literal `>` or `<` in text, a DOCTYPE that is not at the start, or a comment (`<div>\n<pre>x</pre>\n</div>` → `<div> <pre>x</pre> </div>`)
- ✅ **`white-space` documents**: a document that mentions `white-space` (or `whitespace`) in any case, or spells it with a character reference or a CSS escape in a `style` attribute or element, keeps the whitespace in its text as written; only a run alone between two tags still goes (`<p style="white-space:pre">a   b</p>  <p>c   d</p>` → `<p style="white-space:pre">a   b</p><p>c   d</p>`)
- ✅ **Comment removal**: `<!-- ... -->` comments are removed where the HTML tokenizer ends them (`-->`, `--!>`, `<!-->`, `<!--->`), conditional comments included. An unterminated `<!--` and bogus comments such as `<p>a</p><!x><p>b</p>` and `<p>a</p><?x?><p>b</p>` are kept
- ✅ **Inline `<style>` and `<script>`**: a `<style>` with no type or `text/css` goes through the CSS minifier (`<style>\n  a { color : #ffffff }\n</style>` → `<style> a{color:#fff}</style>`); a `<script>` with no type, an empty type, a JavaScript MIME type or `module`, no `language` attribute and no `<!--` goes through the JavaScript minifier (`<script>\n// c\nfoo();\n</script>` → `<script>foo();</script>`). Other types (`application/json`, templates) are kept, and so is a payload whose minified form would hold `</style`, `</script` or `<!--`
- ✅ **Attribute spacing**: `<p class = "foo">` → `<p class="foo">`, inside tags only
- ✅ **Tag spacing**: `<div >` → `<div>`
- ✅ **Unquoted `href` and `src`**: `<a href="/docs">` → `<a href=/docs>` when `=` and the opening quote touch, the value has no whitespace, quote, `=`, `<`, `>`, backtick or brace, and the quote is followed by whitespace or `>`, never by a `/` (`<a href="x"/>` is unchanged, and `<a href = "x">` → `<a href="x">` keeps them, since `=` and the quote do not touch). The rule matches any attribute name ending in `href` or `src`, such as `data-src`
- ✅ **Void element slash**: `<br />` → `<br>`, `<img alt="a b" />` → `<img alt="a b">` for `area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `source`, `track` and `wbr`, and for names that start with one of them and a non-word character (`<img-widget/>` → `<img-widget>`; the parser ignores the slash on any non-void HTML element). Other elements and everything in `svg` and `math` keep it (`<path/>`, `<div/>`)
- ✅ **Kept as written**: `<pre>`, `<code>` and `<listing>` blocks (any case, nested ones included); the content of `<textarea>`, `<title>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>` and `<noscript>`; everything after `<plaintext>`; the DOCTYPE; every attribute value (`<div style="margin : 0px">x</div>`, `<script type="text/javascript"></script>`, `<style type="text/css"></style>` and `<input checked="checked">` are unchanged); the `=` and `>` spacing in text (`<p>a = b</p>`, `<p>a > b</p>`); text in `svg` and `math` (`<svg><text>a  b</text></svg>` is unchanged)
- ✅ **Unsure means as written**: where the parser's state cannot be known (a start tag or CDATA inside `foreignObject`, `title`, `desc` or `annotation-xml`, a foreign end tag with no open match, a tag cut off by the end of the input), the rest of the document is kept from that tag on. A document with `<select`, `<frameset`, `<noscript` or `<col` keeps every `<script>` and `<style>` payload as written, since a parser can ignore their start tags there

Limits:
- **Whitespace between inline elements goes**: `<b>x</b> <i>y</i>` → `<b>x</b><i>y</i>`, which renders as `xy`. By decision, whitespace-only text between two tags is removed everywhere
- **Whitespace-only text that a script or a selector reads** is gone too: `textContent`, `childNodes` and `:empty` see something else. That includes the whitespace-only content of a `white-space:pre` element (`<span style="white-space:pre">  </span>` → `<span style="white-space:pre"></span>`)
- **The `white-space` check reads the document only**: a property name a script builds, a `data:` stylesheet and an external one are out of reach (`<link rel=stylesheet href=a.css><p class="a">x  y</p>` → `<link rel=stylesheet href=a.css><p class="a">x y</p>`)
- **A comment removal can join what was on its two sides** into a new comment, tag or character reference (`<p>a</p><!<!-- x -->-- y -->` → `<p>a</p>`, `<p>&<!-- x -->amp;</p>` → `<p>&amp;</p>`), and two spaces on both sides of a removed comment stay as two (`<p>a <!-- c --> b</p>` → `<p>a  b</p>`)
- The input is read as a document or a body fragment with scripting on, so `<noscript>` is raw text

### SVG Optimizations
- ✅ **Whitespace between elements**: whitespace-only text between two elements is removed (`<svg>  <circle cx="50" cy="50" r="40"/>  </svg>` → `<svg><circle cx="50" cy="50" r="40"/></svg>`)
- ✅ **Whitespace in tags**: the whitespace between a tag name and its attributes, and between attributes, becomes one space, never nothing (`<path\nd="M0 0"/>` → `<path d="M0 0"/>`); `width = "100"` → `width="100"`
- ✅ **Comment removal**: `<!-- ... -->` comments are removed. A comment XML rejects (`<!-- a -- b -->`) leaves the document's numbers, and everything after that comment, as written (`<svg><rect x="1.0"/><!-- a -- b --><rect x="2.0"/></svg>` is unchanged)
- ✅ **Number shortening**: `x="10.0"` → `x="10"`, `x="1.500"` → `x="1.5"`, `x="0.5"` → `x=".5"`, without rounding. Only in numeric attributes (`x`, `y`, `width`, `d`, `points`, `transform`, `viewBox` and the like) on SVG elements, and only when the whole value is valid for that attribute and still splits into the same numbers (`<svg><path d="M1.0.5"/></svg>` is unchanged, since the shortened value would be one number). In a document that holds only inert SVG elements (shapes, text, gradients, filters and the like, not `script`, `style` or `a`), and no attribute that can read other attributes (an event handler, `attr`, `&` or a backslash in a value). `<svg><rect x="1.0"/><rect onclick="f()"/></svg>` is unchanged
- ✅ **Inline `<style>` and `<script>`**: minified with the CSS and JavaScript minifiers when the payload is plain text or one CDATA section (`<svg><style>\n a { color : #ffffff }\n</style></svg>` → `<svg><style> a{color:#fff}</style></svg>`)
- ✅ **Kept as written**: text in `text`, `tspan`, `textPath`, `title`, `desc`, `foreignObject`, `script` and `style`, and everything inside `xml:space="preserve"` (`<svg><text>a     b</text></svg>` is unchanged); the XML declaration, processing instructions, CDATA sections and the DOCTYPE; attribute values that are not numeric, ids, and other text (`<metadata>`)
- ✅ **Unsure means as written**: in a document with a DOCTYPE (it can default attributes) only the whitespace inside tags and the comments are edited; where the markup is not well formed (an unterminated construct, an end tag that does not close the innermost element, a duplicate attribute, a `<` in a value) the rest of the document is kept from that point

Limits:
- **Whitespace-only text between elements goes**, so a script that reads `textContent` or `childNodes` sees something else
- **Readers outside the file** are out of reach: a script or stylesheet in the page that embeds the SVG can read an attribute whose number was shortened (`getAttribute("x")` returns `10` for `x="10.0"`)

### JavaScript Optimizations
- ✅ **Comment removal**: `//` comments and `/* ... */` blocks (including multi-line blocks) that start a line, after optional indentation. A comment that follows code on the same line is kept (`var a = 1; // note`, `var a = /* note */ 1;`)
- ✅ **Trailing whitespace**: removed per line, together with blank lines and the leading whitespace of the first line; `\r\n` line endings become `\n`
- ✅ **Kept as written**: indentation, spacing within lines, names, strings, template literals, regexes, and comment-like text after code (`"http://example.com"`). A line inside a template literal or a string continuation that starts with `//` or `/*` is content, not a comment (`` `a\n// x\nb` `` is unchanged), and so are trailing spaces and blank lines inside them
- ✅ **Unsure means trim only**: a lexer reads the file to tell code from strings, templates and regexes. When it cannot (a `/` after `yield`, `await` or `of`, `<!--` or a `-->` that starts a line, a string or regex cut by a line break, a template or bracket left open, a closer that does not match), nothing is edited except the final trim (`// c\nvar a = 1;\n<!-- x` is unchanged)

### JSON Optimizations
- ✅ **Native JSON.stringify**: `JSON.stringify(JSON.parse(content))`, so all whitespace outside strings is removed. String values are kept; their escapes may be written differently (`"a\/"` → `"a/"`)
- ✅ **Fallback handling**: The content is returned unchanged (without a leading BOM) when `JSON.parse` or `JSON.stringify` throws, as it does for invalid JSON
- ✅ **Nested structure support**: Handles nested objects and arrays

Values go through `JSON.parse`, so numbers become JavaScript numbers (`1.0` → `1`, `-0` → `0`, integers above 2^53 may lose precision, `1e400` → `null`) and the last of duplicate keys wins.

## Examples

### Before and After

**CSS Example:**
```css
/* Before */
.button {
  color: #ffffff;
  margin: 0px;
  padding: 0.5rem 10px 0em;
  border-radius: 0.25em;
}

/* After */
.button{color:#fff;margin:0;padding:.5rem 10px 0;border-radius:.25em}
```

**HTML Example:**
```html
<!-- Before -->
<ul class = "menu">
  <li>  <a href="/docs">  Docs  </a>  </li>
  <!-- the end -->
</ul>
<input type="checkbox" checked="checked" />
<script>
  // start the app
  start();
</script>

<!-- After -->
<ul class="menu"><li><a href=/docs> Docs </a></li></ul><input type="checkbox" checked="checked"><script>start();</script>
```

**SVG Example:**
```svg
<!-- Before -->
<svg width = "100.0" height = "50.0">
  <circle cx="10.500" cy="0.5" r="5"/>
</svg>

<!-- After -->
<svg width="100" height="50"><circle cx="10.5" cy=".5" r="5"/></svg>
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Development

### Prerequisites

- Using the package: Node.js >= 16.0.0 (`engines`)
- Developing it: a current Node.js 24, which CI and the publish workflow use (the dev tools' own `engines` ranges set the exact floor)
- npm >= 7.0.0

### Setup

```bash
git clone https://github.com/proctorio/hulk.js
cd hulk.js
npm install
```

### Scripts

```bash
# Build lib/ from src/: every .js file goes through hulk's own JS minifier
# (comments removed) and must still parse (node --check)
npm run build

# Run the tests with coverage
npm test

# Lint and fix
npm run lint

# Lint without fixing
npm run lint:check

# Pre-publish checks (build + test)
npm run prepublishOnly
```

`npm pack` and `npm publish` run the build first (`prepack`), so the published `lib/` is the minified build of `src/`, not a copy of it.

### Testing

The tests use [Vitest](https://vitest.dev) (`test/`). `npm test` runs the suite as two Vitest projects: `src` runs it against the source, `lib` against the built package. V8 coverage covers `src/` and `scripts/`. A run writes:

- **Test results**: JUnit XML at `.test_output/test-results.xml`
- **Coverage**: a text summary in the terminal and Cobertura XML at `.test_output/cobertura-coverage.xml`

The run fails if statement, branch, function or line coverage drops below 80% (`vitest.config.js`).

The tests cover:
- ✅ All minification functions (HTML, CSS, SVG, JS, JSON)
- ✅ Advanced CSS optimizations (zero units, hex colors, leading zeros)
- ✅ HTML attribute edits (unquoted `href`/`src`, void element slashes) and the attribute values that are kept (`type`, boolean attributes)
- ✅ HTML comment removal, including nested and unterminated comments, and the whitespace rules around comments, tags and `white-space`
- ✅ HTML inline `<style>` and `<script>`, preserved blocks, and where the parser's state is unknown
- ✅ SVG number precision optimizations
- ✅ Edge cases (empty content, non-string input, unsupported extensions, a leading BOM)
- ✅ Comment-like text in strings, in template literals of any length and in regexes
- ✅ SVG whitespace, text, `xml:space` and namespaces, and the numbers that are left alone
- ✅ Linear-time bounds on large inputs for each scanner
- ✅ CSS `calc()` function handling
- ✅ The build: comments stripped from every `.js` file in `lib/`, tokens unchanged, each file still parses

## Publishing

This package is published to npm as [@proctorio/hulk](https://www.npmjs.com/package/@proctorio/hulk). Releases are automatic: nobody runs `npm version` or `npm publish` by hand.

- `package.json` holds the release line (`2.1.0` means the `2.1` line). The release process assigns the patch number; do not bump it.
- Merging a change to `main` releases the next patch version of that line, except a change that touches only documentation or CI configuration.
- To start a new line, change major.minor in `package.json`.

The published package holds `lib/`, `LICENSE`, `README.md` and `package.json` (the `files` field in `package.json`).

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- All tests pass and coverage stays above the 80% thresholds (`npm test`)
- Code follows the linting rules (`npm run lint`)
- Comments in `src/` sit on their own lines: the build removes only comments that start a line, and the `lib` tests fail when a comment is left in `lib/` or a token changes (a comment after code on the same line stays; a file the JavaScript scan cannot read, such as one with `<!--`, keeps all its comments)

## Author

**Proctorio**

## Support

For issues and questions, please visit the [GitHub Issues](https://github.com/proctorio/hulk.js/issues) page.
