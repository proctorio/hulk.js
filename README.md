# Hulk.js

[![npm version](https://img.shields.io/npm/v/@proctorio/hulk.svg)](https://www.npmjs.com/package/@proctorio/hulk)
[![npm downloads](https://img.shields.io/npm/dm/@proctorio/hulk.svg)](https://www.npmjs.com/package/@proctorio/hulk)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Lightweight, zero-dependency minification library for HTML, CSS, SVG, JavaScript, and JSON content.

## Features

- 🚀 **Zero runtime dependencies** - Pure JavaScript implementation
- 🎯 **Simple API** - Single function with extension-based routing
- 🔧 **ES Modules** - Ships as an ES module
- ⚡ **Regex-based** - HTML, CSS, SVG and JavaScript are pattern rewrites, not parsed: see [Minification Features](#minification-features) for what each type changes and what it does not preserve

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
- `html` - Collapses whitespace, removes comments, and shortens attributes; `<pre>` and `<code>` blocks are set aside while the rest is minified
- `css` - Removes comments, line breaks and tabs, collapses spaces, and shortens values
- `svg` - Removes whitespace between tags, line breaks and comments, and shortens numbers
- `js` - Removes comments that start a line, trailing whitespace and blank lines; nothing else
- `json` - `JSON.stringify(JSON.parse(content))`; invalid JSON is returned unchanged

## Minification Features

HTML, CSS, SVG and JavaScript are minified by a fixed sequence of regular-expression replacements. None of them knows where a string, template literal, inline script, attribute value or comment starts and ends, so every rule can also fire inside one. JSON is parsed and serialized again. The "Not preserved" lists below show where the output's meaning changes.

### CSS Optimizations
- ✅ **Comment removal**: `/* ... */` comments are removed, and so is every line break and tab (deleted, not replaced by a space)
- ✅ **Zero unit removal**: `margin:0px` → `margin:0`, `margin:0rem` → `margin:0`, for `px`, `em`, `rem`, `vh`, `vw`, `vmin`, `vmax`, `cm`, `mm`, `in`, `pt`, `pc`, `ex` and `ch` (any case), when the `0` follows a space or a colon. Other units are kept (`0%`, `0deg`, `0s`), and so is a zero after a comma (`margin:0px,0px` → `margin:0,0px`)
- ✅ **Leading zero removal**: `margin:0.5em` → `margin:.5em`, `margin:-0.5em` → `margin:-.5em`, when the `0` follows a character that is not a digit
- ✅ **Trailing semicolon removal**: `color:red;}` → `color:red}`
- ✅ **Hex color compression**: `#ffffff` → `#fff`, `#112233` → `#123`, when each pair has the same case (`#aAbBcC` is kept)
- ✅ **Whitespace optimization**: Runs of spaces collapse to one; spaces are removed after `{`, `:`, `;` and `,`, before `{`, `}` and `!`, and on both sides of `:` (`color : red !important` → `color:red!important`). Other spaces are kept: `color :red`, `a ,b`, `div > p`, `calc(100% - 10px)`

Not preserved:
- **Hex shortening has no boundary**: it also rewrites id selectors and 8-digit colors (`#ffeedd{}` → `#fed{}`, `#aabbccdd` → `#abcdd`)
- **String and `url()` content**: every rule above applies inside them (`content:"a   b /* x */ c"` → `content:"a b c"`, `content:'/* x */'` → `content:''`, `content:"x:0rem #aabbcc"` → `content:"x:0 #abc"`, `url(img0.5.png)` → `url(img.5.png)`)
- **Zero lengths in `calc()`**: `calc(100% - 0px)` → `calc(100% - 0)`, which is invalid
- **Line breaks between tokens**: a line that continues without indentation, or with tab indentation, is joined to the one before it (`@media screen\nand` → `@media screenand`, `opacity 1s\n\tease` → `opacity 1sease`, `.a\n.b{}` → `.a.b{}`); continuations indented with spaces keep one space

### HTML Optimizations
- ✅ **Preserved blocks**: `<pre>` and `<code>` elements (any case, with attributes) are set aside and put back after the rest is minified (exceptions under Not preserved)
- ✅ **Whitespace collapsing**: `\n` and `\r\n` line breaks and tabs become spaces, whitespace between tags is removed, any other run collapses to one space, and the result is trimmed (`<p>  Hello  </p>` → `<p> Hello </p>`). Whitespace next to a `<pre>` or `<code>` block is not "between tags" while the block is set aside, so it can remain (`<div> <pre>x</pre> </div>` is unchanged). Comments are removed after this step, so the spaces on both sides of a removed comment can remain
- ✅ **Comment removal**: `<!-- ... -->` comments are removed, repeatedly, until none are left; an unterminated `<!--` is kept
- ✅ **Attribute spacing**: `class = "foo"` → `class="foo"`
- ✅ **Tag spacing**: `<div >` → `<div>`
- ✅ **Unquoted `href` and `src`**: `href="/docs"` → `href=/docs` when the value has no whitespace and no `/` follows the closing quote (`<a href="x"/>` keeps them). The rule matches any attribute name ending in `href` or `src`, such as `data-src`
- ✅ **Void element slash**: `<br />` → `<br>`, `<img ... />` → `<img ...>` for `area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `source`, `track` and `wbr`; other elements keep it (`<path/>`, `<div/>`)
- ✅ **Default type removal**: `type="text/javascript"` on `<script>` and `type="text/css"` on `<style>`, when it is the first attribute
- ✅ **Boolean attributes**: `<input checked="checked">` → `<input checked>` for `checked`, `disabled`, `selected`, `readonly`, `required`, `autofocus`, `autoplay`, `controls`, `loop` and `muted`, when the value repeats the name (`checked="true"` is kept)

Not preserved:
- **Inline `<script>`, `<style>` and `<textarea>` content** is collapsed onto one line like any other text, so a `//` comment in an inline script comments out the code after it (`<script>\n// c\nfoo();\n</script>` → `<script> // c foo(); </script>`)
- **Text and attribute values**: the `=` and `>` spacing and space collapsing apply everywhere (`<p>a = b</p>` → `<p>a=b</p>`, `<p>a > b</p>` → `<p>a> b</p>`, `title="a   b"` → `title="a b"`)
- **Space between inline elements**: `<b>x</b> <i>y</i>` → `<b>x</b><i>y</i>`, which renders as `xy`
- **`href` and `src` quote removal** can break the markup: `href="/x>y"` → `href=/x>y` (the tag now ends at the first `>`), and a quote later in the document can be taken as the closing one (`<use href="x"/><text>"y"</text>` → `<use href=x"/><text>"y</text>`)
- **Void element slash removal** also matches longer tag names and attribute values: `<img-widget/>` → `<img-widget>`, `<img alt="a /> b">` → `<img alt="a> b">`
- **Preserved blocks**: a block is put back with `String.prototype.replace`, so `$$`, `$&`, `` $` `` and `$'` in it are replacement patterns (`<pre>$$</pre>` → `<pre>$</pre>`, `` <p>x</p><pre>$`</pre> `` → `<p>x</p><pre><p>x</p></pre>`); a closing tag with a space (`</pre >`) is not recognized, and a nested `<code>` ends the block at its own closing tag, so the rest is minified; `<pre>` text inside comments counts, so a block can start in one comment and end in another, and everything between them is removed with the comments (`<p><!-- <pre> --></p><p>x</p><!-- </pre> -->` → `<p>`); input that already contains `__PRESERVE_BLOCK_<n>__` gets a block put back in the wrong place

### SVG Optimizations
- ✅ **Whitespace**: Whitespace between tags is removed, runs of two or more whitespace characters collapse to one space, and any single line break left is deleted. Comments are removed after the collapse, so the spaces on both sides of a removed comment can remain
- ✅ **Comment removal**: `<!-- ... -->` comments are removed
- ✅ **Attribute spacing**: `width = "100"` → `width="100"`
- ✅ **Number shortening**: `x="10.0"` → `x="10"`, `x="1.500"` → `x="1.5"`, `x="0.5"` → `x=".5"`, without rounding

Not preserved:
- **`xml:space="preserve"`**: the attribute is kept, but text inside it collapses like any other (`a     b` → `a b`)
- **Single line breaks** are deleted, not replaced by a space (`points="0,0\n10,10"` → `points="0,010,10"`, `<text>a\nb</text>` → `<text>ab</text>`)
- **Text**: the `=` spacing applies (`<text>a = b</text>` → `<text>a=b</text>`), and space between elements goes (`<tspan>a</tspan> <tspan>b</tspan>` → `<tspan>a</tspan><tspan>b</tspan>`)
- **Number shortening applies to every digit run**: the XML declaration (`<?xml version="1.0"?>` → `<?xml version="1"?>`, which XML parsers reject), ids and text (`id="icon-1.0"` → `id="icon-1"`), and adjacent path numbers, which merge (`d="M1.0.5"`, the coordinates 1.0 and .5, → `d="M1.5"`)

### JavaScript Optimizations
- ✅ **Comment removal**: `//` comments and `/* ... */` blocks (including multi-line blocks) that start a line, after optional indentation. A comment that follows code on the same line is kept (`var a = 1; // note`, `var a = /* note */ 1;`)
- ✅ **Trailing whitespace**: Removed per line, together with blank lines and the leading whitespace of the first line; `\r\n` line endings become `\n`
- ✅ **Kept as written**: Indentation, spacing within lines, names, and comment-like text after code on a line (`"http://example.com"`)

Not preserved:
- **Template literals and string continuations**: a line inside one that starts with `//` is removed (`` `a\n// x\nb` `` → `` `a\nb` ``), one that starts with `/*` removes everything up to the next `*/`, code included, and trailing spaces and blank lines inside them are removed too

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
<script type="text/javascript" src="app.js"></script>
<input type="checkbox" checked="checked" disabled="disabled" />

<!-- After -->
<script src=app.js></script><input type="checkbox" checked disabled>
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
- ✅ HTML attribute optimizations (boolean attributes, default types, unquoted `href`/`src`, void element slashes)
- ✅ HTML comment removal, including nested and unterminated comments
- ✅ SVG number precision optimizations
- ✅ Edge cases (empty content, non-string input, unsupported extensions, a leading BOM)
- ✅ Comment-like text in strings and in a single-line template literal
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
- Comments in `src/` sit on their own lines: the build removes only comments that start a line, and the `lib` tests fail when a comment is left in `lib/` or a token changes (a comment after code on the same line stays; a template literal line that starts with `//` or `/*` can be cut)

## Author

**Proctorio**

## Support

For issues and questions, please visit the [GitHub Issues](https://github.com/proctorio/hulk.js/issues) page.
