# Hulk.js

[![npm version](https://img.shields.io/npm/v/@proctorio/hulk.svg)](https://www.npmjs.com/package/@proctorio/hulk)
[![npm downloads](https://img.shields.io/npm/dm/@proctorio/hulk.svg)](https://www.npmjs.com/package/@proctorio/hulk)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Tests](https://img.shields.io/badge/tests-41%20passing-brightgreen.svg)]()
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)]()

Lightweight, zero-dependency minification library for HTML, CSS, SVG, JavaScript, and JSON content.

## Features

- 🚀 **Zero runtime dependencies** - Pure JavaScript implementation
- ⚡ **Fast and efficient** - Regex-based transformations
- 🎯 **Simple API** - Single function with extension-based routing
- 📦 **Tiny footprint** - Minimal bundle size
- ✅ **Well-tested** - 100% code coverage with 41 comprehensive tests
- 🔧 **ES Modules** - Modern module system support
- 💪 **Advanced optimizations** - Aggressive minification with safe defaults

## Installation

```bash
npm install @proctorio/hulk
```

## Usage

```javascript
import minify__ from '@proctorio/hulk';

// Minify HTML
const html = '<div>  <p>  Hello  </p>  </div>';
const minifiedHtml = minify__(html, 'html');
// Result: '<div><p>Hello</p></div>'

// Minify CSS with advanced optimizations
const css = `
  .class {
    color: #ffffff;
    margin: 0px;
    padding: 0.5em;
  }
`;
const minifiedCss = minify__(css, 'css');
// Result: '.class{color:#fff;margin:0;padding:.5em}'

// Minify JavaScript
const js = `
  function test() {
    // This is a comment
    return 42;
  }
`;
const minifiedJs = minify__(js, 'js');
// Result: 'function test() {\n  return 42;\n}'

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

Minifies the provided content based on the file extension.

**Parameters:**
- `content` (string): The content to minify
- `extension` (string): File type - `'html'`, `'css'`, `'svg'`, `'js'`, or `'json'`

**Returns:**
- (string): Minified content, or empty string if input is not a string

**Supported Extensions:**
- `html` - Removes whitespace, comments, and optimizes attributes
- `css` - Removes comments, whitespace, and optimizes spacing
- `svg` - Removes whitespace and comments
- `js` - Removes comments and trailing whitespace
- `json` - Uses native JSON.stringify for minification

## Minification Features

### CSS Optimizations
- ✅ **Zero unit removal**: `0px` → `0`, `0rem` → `0` (all CSS units)
- ✅ **Leading zero removal**: `0.5em` → `.5em`
- ✅ **Trailing semicolon removal**: `color:red;}` → `color:red}`
- ✅ **Hex color compression**: `#ffffff` → `#fff`, `#112233` → `#123`
- ✅ **Whitespace optimization**: Removes spaces around `{}:;` and after colons
- ✅ **Preserved features**: `calc()` function spaces, `!important` flags, string content

### HTML Optimizations
- ✅ **Attribute spacing**: `class = "foo"` → `class="foo"`
- ✅ **Tag spacing**: `<div >` → `<div>`
- ✅ **Default type removal**: Strips `type="text/javascript"` from `<script>` tags
- ✅ **Boolean attributes**: `checked="checked"` → `checked`
- ✅ **Whitespace collapsing**: Multiple spaces reduced to single space
- ✅ **Comment removal**: HTML comments are stripped

### SVG Optimizations
- ✅ **Number precision**: Removes `.0` from whole numbers (`10.0` → `10`)
- ✅ **Trailing zeros**: `1.500` → `1.5`
- ✅ **Leading zeros**: `0.5` → `.5`
- ✅ **Attribute spacing**: Optimizes spaces around equals signs
- ✅ **Preserved features**: `xml:space` attributes, path data precision

### JavaScript Optimizations
- ✅ **Comment removal**: Single-line and multi-line comments
- ✅ **Trailing whitespace**: Removed per line
- ✅ **Preserved features**: Template literals, strings with comment-like syntax

### JSON Optimizations
- ✅ **Native JSON.stringify**: Reliable and safe minification
- ✅ **Fallback handling**: Returns original if JSON is invalid
- ✅ **Nested structure support**: Handles complex objects

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
<script type="text/javascript">
  <input type="checkbox" checked="checked" disabled="disabled" />
</script>

<!-- After -->
<script><input type="checkbox" checked disabled/></script>
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

- Node.js >= 16.0.0
- npm >= 7.0.0

### Setup

```bash
git clone https://github.com/proctorio/hulk.js
cd hulk.js
npm install
```

### Scripts

```bash
# Build (copies src/ to lib/)
npm run build

# Run tests
npm test

# Run tests with coverage
npm run coverage

# Lint code
npm run lint

# Check linting without fixing
npm run lint:check

# Pre-publish checks (build + test)
npm run prepublishOnly
```

### Testing

The project uses Jest with 100% code coverage requirement. Test results and coverage reports are generated in standardized formats:

- **Test Results**: `npm test` generates `test-results.xml` in JUnit format (`.test_output/test-results.xml`)
- **Coverage Reports**: `npm run coverage` generates:
  - Cobertura XML format (`cobertura-coverage.xml`)
  - LCOV format (`lcov.info` and HTML report in `lcov-report/`)

All 41 tests cover:
- ✅ All minification functions (HTML, CSS, SVG, JS, JSON)
- ✅ Advanced CSS optimizations (zero units, hex colors, leading zeros)
- ✅ HTML attribute optimizations (boolean attributes, default types)
- ✅ SVG number precision optimizations
- ✅ Edge cases (empty content, invalid input, special characters)
- ✅ Type validation and error handling
- ✅ Comment preservation in strings
- ✅ CSS `calc()` function handling
- ✅ Template literals in JavaScript

## Publishing

This package is published to npm as [@proctorio/hulk](https://www.npmjs.com/package/@proctorio/hulk).

To publish a new version:

```bash
# Update version in package.json
npm version patch  # or minor, or major

# Build and test
npm run prepublishOnly

# Publish to npm
npm publish
```

The package includes only necessary files for distribution:
- `lib/` - Compiled source code
- `LICENSE` - Apache 2.0 license
- `README.md` - Documentation

Development files (tests, configuration, etc.) are excluded via `.npmignore`.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- All tests pass (`npm test`)
- Code coverage remains at 100% (`npm run coverage`)
- Code follows the linting rules (`npm run lint`)

## Author

**Proctorio**

## Support

For issues and questions, please visit the [GitHub Issues](https://github.com/proctorio/hulk.js/issues) page.