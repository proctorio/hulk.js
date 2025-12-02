import minify__ from "../src/index.js";

describe("minify__", () => 
{
	it("minify CSS", () => 
	{
		const dummyCSS = `/* demo page styles */
			body { font-family: Helvetica, Arial, sans-serif; text-align: center;}
			img { margin: 10px; }
			
			/* dummy image styles */
			.dummy
			{
				box-sizing: border-box;
				display: inline-block; 
				position: relative;
			}
			.dummy:before 
			{
				content: '';
				position: absolute;
				background: lightgray;
				top: 0;
				right: 0;
				bottom: 0;
				left: 0;
			}
			.dummy:after 
			{ 
				content: attr(width) " x " attr(height);
				white-space: pre;
				color: gray;
				text-align: center;
				display: block;
				position: absolute;
				width: 100%;
				top: calc(50% - .5em);
				font-size: 100%;
			}
			.dummy.alt:after 
			{
				content: attr(alt);
			}
			.dummy.double.alt:after
			{
				content: attr(alt) "\\A" attr(data-second);
				white-space: pre;
				top: calc(50% - 1em);
			}
			.dummy.big
			{
				font-size: 200%;
			}
			.dummy.small
			{
				font-size: 50%;
			}
			.dummy.round
			{
				padding: 0 1em;
			}
			.dummy.round:before
			{ 
				border-radius: 1em;
			}
			.dummy.round:after
			{
				margin-left: -1em;
			}
			"`;
	
		const dummyCSSMinify = minify__(dummyCSS, "css");
	
		expect(dummyCSSMinify).toBe("body{font-family:Helvetica,Arial,sans-serif;text-align:center}img{margin:10px}.dummy{box-sizing:border-box;display:inline-block;position:relative}.dummy:before{content:'';position:absolute;background:lightgray;top:0;right:0;bottom:0;left:0}.dummy:after{content:attr(width) \" x \" attr(height);white-space:pre;color:gray;text-align:center;display:block;position:absolute;width:100%;top:calc(50% - .5em);font-size:100%}.dummy.alt:after{content:attr(alt)}.dummy.double.alt:after{content:attr(alt) \"\\A\" attr(data-second);white-space:pre;top:calc(50% - 1em)}.dummy.big{font-size:200%}.dummy.small{font-size:50%}.dummy.round{padding:0 1em}.dummy.round:before{border-radius:1em}.dummy.round:after{margin-left:-1em}\"");
	});
	
	it("minify JS", () => 
	{
		const dummyJS = `function test(name,by,cy)
			{
				const age = cy-by;     
				const r = name+"is"+age;				
				return r;				
			}
			console.log(test("alice",1871,1964));
			`;
	
		const dummyJSMinify = minify__(dummyJS, "js");
	
		expect(dummyJSMinify).toBe("function test(name,by,cy)\n\t\t\t{\n\t\t\t\tconst age = cy-by;\n\t\t\t\tconst r = name+\"is\"+age;\n\t\t\t\treturn r;\n\t\t\t}\n\t\t\tconsole.log(test(\"alice\",1871,1964));");
	});

	it("minify JS single line comments", () => 
	{
		const dummyJS = `function test(name,by,cy)
			{
				const age = cy-by;
				// const r = name+"is"+age;
				return r;
			}
			console.log(test("alice",1871,1964));
			`;
	
		const dummyJSMinify = minify__(dummyJS, "js");
	
		expect(dummyJSMinify).toBe("function test(name,by,cy)\n\t\t\t{\n\t\t\t\tconst age = cy-by;\n\t\t\t\treturn r;\n\t\t\t}\n\t\t\tconsole.log(test(\"alice\",1871,1964));");
	});

	it("minify JS special single line case", () => 
	{
		const dummyJS = `function test(name,by,cy)
			{
				const age = cy-by;
				const r = name+"is//"+age;
				return r;
			}
			console.log(test("alice",1871,1964));
			`;
	
		const dummyJSMinify = minify__(dummyJS, "js");
	
		expect(dummyJSMinify).toBe("function test(name,by,cy)\n\t\t\t{\n\t\t\t\tconst age = cy-by;\n\t\t\t\tconst r = name+\"is//\"+age;\n\t\t\t\treturn r;\n\t\t\t}\n\t\t\tconsole.log(test(\"alice\",1871,1964));");
	});

	it("minify JS multiline comments", () => 
	{
		const dummyJS = `function test(name,by,cy)
			{
				const age = cy-by;
				/*
				const r = name+"is"+age;
				*/
				return r;
			}
			console.log(test("alice",1871,1964));
			`;
	
		const dummyJSMinify = minify__(dummyJS, "js");
	
		expect(dummyJSMinify).toBe("function test(name,by,cy)\n\t\t\t{\n\t\t\t\tconst age = cy-by;\n\t\t\t\treturn r;\n\t\t\t}\n\t\t\tconsole.log(test(\"alice\",1871,1964));");
	});

	it("minify JS special multiline case", () => 
	{
		const dummyJS = `function test(name,by,cy)
			{
				const age = cy-by;
				const r = name+"/*is*/"+age;
				return r;
			}
			console.log(test("alice",1871,1964));
			`;
	
		const dummyJSMinify = minify__(dummyJS, "js");
	
		expect(dummyJSMinify).toBe("function test(name,by,cy)\n\t\t\t{\n\t\t\t\tconst age = cy-by;\n\t\t\t\tconst r = name+\"/*is*/\"+age;\n\t\t\t\treturn r;\n\t\t\t}\n\t\t\tconsole.log(test(\"alice\",1871,1964));");
	});
	
	it("minify HTML", () => 
	{
		const dummyHTML = `<!DOCTYPE html>
	
			<html>
			<head>
				<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
				<title>Spoon-Knife</title>
				<LINK href="styles.css" rel="stylesheet" type="text/css">
			</head>
			
			<body>
			
			<img src="forkit.gif" id="octocat" alt="" />
			
			<!-- Feel free to change this text here -->
			<p>
				Fork me? Fork you, @octocat!
			</p>
			<p>
				Nick made a change
			</p>
			
			</body>
			</html>
			`;
	
		const dummyHTMLMinify = minify__(dummyHTML, "html");
	
		expect(dummyHTMLMinify).toBe("<!DOCTYPE html><html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"/><title>Spoon-Knife</title><LINK href=styles.css rel=\"stylesheet\" type=\"text/css\"></head><body><img src=forkit.gif id=\"octocat\" alt=\"\" /><p> Fork me? Fork you, @octocat! </p><p> Nick made a change </p></body></html>");
	});
	
	it("minify SVG", () => 
	{
		const dummySVG = `<svg height="500px" viewBox="0 0 500 500" enable-background="new 0 0 500 500" xml:space="preserve">
			<path fill-rule="evenodd" clip-rule="evenodd" d="M498,231c0,13.333,0,26.667,0,40c-0.385,1.398-0.936,2.775-1.127,4.2
									c-0.844,6.255-1.263,12.583-2.411,18.777c-8.655,46.727-28.586,87.95-60.799,123.02c-38.92,42.372-86.644,68.66-143.555,77.952
									c-6.69,1.092-13.405,2.037-20.108,3.051c-13,0-26,0-39,0c-1.236-0.376-2.449-0.901-3.713-1.103
									c-9.992-1.59-20.117-2.563-29.972-4.756c-53.421-11.889-97.848-39.035-133.607-80.278
									c-30.342-34.994-49.232-75.482-56.631-121.262C6.022,284.072,5.024,277.534,4,271c0-13.333,0-26.667,0-40
									c0.381-1.599,0.877-3.179,1.124-4.798c1.25-8.202,2.03-16.499,3.711-24.609c11.361-54.818,38.468-100.506,80.563-137.271
									c35.167-30.716,75.897-49.783,122.013-57.266C217.934,5.998,224.47,5.017,231,4c13.333,0,26.667,0,40,0
									c1.422,0.376,2.823,0.891,4.269,1.104c8.21,1.217,16.521,1.924,24.634,3.603c54.807,11.341,100.606,38.289,137.438,80.349
									c30.879,35.262,50.052,76.126,57.554,122.425C495.948,217.983,496.966,224.493,498,231z M250.894,474.182
									c120.941,0.923,220.535-97.251,223.422-217.575c3.004-125.193-97.149-226.097-217.708-228.935
									C131.18,24.72,30.261,125.194,27.658,245.892C24.928,372.446,127.893,475.144,250.894,474.182z" />
			<path fill-rule="evenodd" clip-rule="evenodd" fill="#FFFFFF" d="M250.894,474.182
									c-123.001,0.962-225.965-101.735-223.236-228.29C30.261,125.194,131.18,24.72,256.607,27.672
									c120.559,2.838,220.712,103.741,217.708,228.935C471.429,376.931,371.835,475.104,250.894,474.182z M185.263,433.688
									c72.183-60.821,143.721-121.1,215.631-181.692c-72.131-61.108-143.561-121.621-215.631-182.677
									C185.263,191.178,185.263,311.828,185.263,433.688z" />
			<path fill-rule="evenodd" clip-rule="evenodd" d="M185.263,433.688c0-121.86,0-242.511,0-364.369
									c72.07,61.056,143.5,121.568,215.631,182.677C328.983,312.589,257.445,372.867,185.263,433.688z" />
							</svg>`;
	
		const dummySVGMinify = minify__(dummySVG, "svg");

		expect(dummySVGMinify).toBe("<svg height=\"500px\" viewBox=\"0 0 500 500\" enable-background=\"new 0 0 500 500\" xml:space=\"preserve\"><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M498,231c0,13.333,0,26.667,0,40c-.385,1.398-.936,2.775-1.127,4.2 c-.844,6.255-1.263,12.583-2.411,18.777c-8.655,46.727-28.586,87.95-60.799,123.02c-38.92,42.372-86.644,68.66-143.555,77.952 c-6.69,1.092-13.405,2.037-20.108,3.051c-13,0-26,0-39,0c-1.236-.376-2.449-.901-3.713-1.103 c-9.992-1.59-20.117-2.563-29.972-4.756c-53.421-11.889-97.848-39.035-133.607-80.278 c-30.342-34.994-49.232-75.482-56.631-121.262C6.022,284.072,5.024,277.534,4,271c0-13.333,0-26.667,0-40 c.381-1.599,.877-3.179,1.124-4.798c1.25-8.202,2.03-16.499,3.711-24.609c11.361-54.818,38.468-100.506,80.563-137.271 c35.167-30.716,75.897-49.783,122.013-57.266C217.934,5.998,224.47,5.017,231,4c13.333,0,26.667,0,40,0 c1.422,.376,2.823,.891,4.269,1.104c8.21,1.217,16.521,1.924,24.634,3.603c54.807,11.341,100.606,38.289,137.438,80.349 c30.879,35.262,50.052,76.126,57.554,122.425C495.948,217.983,496.966,224.493,498,231z M250.894,474.182 c120.941,.923,220.535-97.251,223.422-217.575c3.004-125.193-97.149-226.097-217.708-228.935 C131.18,24.72,30.261,125.194,27.658,245.892C24.928,372.446,127.893,475.144,250.894,474.182z\" /><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#FFFFFF\" d=\"M250.894,474.182 c-123.001,.962-225.965-101.735-223.236-228.29C30.261,125.194,131.18,24.72,256.607,27.672 c120.559,2.838,220.712,103.741,217.708,228.935C471.429,376.931,371.835,475.104,250.894,474.182z M185.263,433.688 c72.183-60.821,143.721-121.1,215.631-181.692c-72.131-61.108-143.561-121.621-215.631-182.677 C185.263,191.178,185.263,311.828,185.263,433.688z\" /><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M185.263,433.688c0-121.86,0-242.511,0-364.369 c72.07,61.056,143.5,121.568,215.631,182.677C328.983,312.589,257.445,372.867,185.263,433.688z\" /></svg>");
	});

	it("minify JSON", () => 
	{
		const dummyJSON = `[
				{
					"color": "red",
					"value": "#f00"
				},
				{
					"color": "green",
					"value": "#0f0"
				},
				{
					"color": "blue",
					"value": "#00f"
				},
				{
					"color": "cyan",
					"value": "#0ff"
				},
				{
					"color": "magenta",
					"value": "#f0f"
				},
				{
					"color": "yellow",
					"value": "#ff0"
				},
				{
					"color": "black",
					"value": "#000"
				}
			]`;
	
		const dummyJSONMinify = minify__(dummyJSON, "json");
	
		expect(dummyJSONMinify).toBe("[{\"color\":\"red\",\"value\":\"#f00\"},{\"color\":\"green\",\"value\":\"#0f0\"},{\"color\":\"blue\",\"value\":\"#00f\"},{\"color\":\"cyan\",\"value\":\"#0ff\"},{\"color\":\"magenta\",\"value\":\"#f0f\"},{\"color\":\"yellow\",\"value\":\"#ff0\"},{\"color\":\"black\",\"value\":\"#000\"}]");
	});

	it("skip minify invalid JSON", () => 
	{
		const dummyJSON = `[
				{
					color: "red",
					value: "#f00"
				}
			]`;
	
		const dummyJSONMinify = minify__(dummyJSON, "json");
	
		expect(dummyJSONMinify).toBe(dummyJSON);
	});

	it("minify empty HTML to empty", () => 
	{
		const dummyEmpty = "";
		
		const dummyEmptyMinify = minify__(dummyEmpty, "html");
		
		expect(dummyEmptyMinify).toBe("");
	});

	it("minify empty XX to empty", () => 
	{
		const dummyEmpty = "";
		
		const dummyEmptyMinify = minify__(dummyEmpty, "xx");
		
		expect(dummyEmptyMinify).toBe("");
	});

	it("minify NULL to empty", () => 
	{	
		const dummyEmptyMinify = minify__(null, "css");
		
		expect(dummyEmptyMinify).toBe("");
	});

	it("minify extension not supported", () => 
	{
		const dummySomething = `aaa
				bbb
				ccc
					ddd
				`;
	
		const dummyUnsupportedMinify = minify__(dummySomething, "gif");
	
		expect(dummyUnsupportedMinify).toBe(dummySomething);
	});

	it("minify CSS with calc() preserves spaces", () => 
	{
		const cssWithCalc = `
			.element {
				width: calc(100% - 20px);
				height: calc(50vh + 10px);
			}
		`;
	
		const minified = minify__(cssWithCalc, "css");
	
		expect(minified).toContain("calc(100% - 20px)");
		expect(minified).toContain("calc(50vh + 10px)");
	});

	it("minify HTML with various quote styles", () => 
	{
		const html = "<div class=\"test\" id='myId' data-value=noQuotes></div>";
	
		const minified = minify__(html, "html");
	
		expect(minified).toBe("<div class=\"test\" id='myId' data-value=noQuotes></div>");
	});

	it("minify SVG with xml:space preserve attribute", () => 
	{
		const svg = `<svg xml:space="preserve">
			<text>  Some   Text  </text>
		</svg>`;
	
		const minified = minify__(svg, "svg");
	
		expect(minified).toContain("xml:space=\"preserve\"");
	});

	it("minify JSON with nested objects", () => 
	{
		const json = `{
			"nested": {
				"deep": {
					"value": 123
				}
			}
		}`;
	
		const minified = minify__(json, "json");
	
		expect(minified).toBe('{"nested":{"deep":{"value":123}}}');
	});

	it("minify JS with template literals", () => 
	{
		const js = `
			const msg = \`Hello \${name}\`;
			// Comment should be removed
			const num = 42;
	`;

		const minified = minify__(js, "js");

		expect(minified).toContain("const msg = `Hello");
		expect(minified).toContain("name}`;");
		expect(minified).toContain("const num = 42;");
		expect(minified).not.toContain("// Comment");
	});

	it("minify CSS with important flag", () => 
	{
		const css = `
			.test {
				color: red !important;
				margin: 10px ! important;
			}
		`;
	
		const minified = minify__(css, "css");
	
		expect(minified).toContain("!important");
		expect(minified).not.toContain(" !");
	});

	it("minify HTML removes multiple spaces between tags", () => 
	{
		const html = "<div>     <span>     <a>Link</a>     </span>     </div>";
	
		const minified = minify__(html, "html");
	
		expect(minified).toBe("<div><span><a>Link</a></span></div>");
	});

	it("minify empty content for each type", () => 
	{
		expect(minify__("", "html")).toBe("");
		expect(minify__("", "css")).toBe("");
		expect(minify__("", "svg")).toBe("");
		expect(minify__("", "js")).toBe("");
		expect(minify__("", "json")).toBe("");
	});

	it("minify number input returns empty string", () => 
	{
		const result = minify__(12345, "css");
	
		expect(result).toBe("");
	});

	it("minify object input returns empty string", () => 
	{
		const result = minify__({test: "value"}, "html");
	
		expect(result).toBe("");
	});

	it("minify undefined input returns empty string", () => 
	{
		const result = minify__(null, "js");
	
		expect(result).toBe("");
	});

	it("minify CSS removes units from zero values", () => 
	{
		const css = `
			.box {
				margin: 0px;
				padding: 0em 10px 0rem;
				border: 0vh solid black;
			}
		`;
		const minified = minify__(css, "css");

		expect(minified).toContain("margin:0;");
		expect(minified).toContain("padding:0 10px 0;");
		expect(minified).toContain("border:0 solid black");
		expect(minified).not.toMatch(/:0px\b/u);
		expect(minified).not.toMatch(/\s0em\b/u);
		expect(minified).not.toMatch(/\s0rem\b/u);
	});

	it("minify CSS removes leading zeros from decimals", () => 
	{
		const css = `
			.element {
				opacity: 0.5;
				font-size: 0.875rem;
				line-height: 1.5;
			}
		`;
		const minified = minify__(css, "css");

		expect(minified).toContain("opacity:.5;");
		expect(minified).toContain("font-size:.875rem;");
		expect(minified).toContain("line-height:1.5");
	});

	it("minify CSS removes trailing semicolons before closing brace", () => 
	{
		const css = `
			.test {
				color: red;
			}
			.another {
				display: block;
			}
		`;
		const minified = minify__(css, "css");

		expect(minified).toContain(".test{color:red}");
		expect(minified).toContain(".another{display:block}");
		expect(minified).not.toContain(";}");
	});

	it("minify CSS compresses hex colors", () => 
	{
		const css = `
			.colors {
				color: #ffffff;
				background: #000000;
				border: 1px solid #ff0000;
			}
		`;
		const minified = minify__(css, "css");

		expect(minified).toContain("#fff");
		expect(minified).toContain("#000");
		expect(minified).toContain("#f00");
		expect(minified).not.toContain("#ffffff");
		expect(minified).not.toContain("#000000");
		expect(minified).not.toContain("#ff0000");
	});

	it("minify CSS preserves non-compressible hex colors", () => 
	{
		const css = `
			.colors {
				color: #abc123;
				background: #f0f0f0;
			}
		`;
		const minified = minify__(css, "css");

		expect(minified).toContain("#abc123");
		expect(minified).toContain("#f0f0f0");
	});

	it("minify HTML removes spaces around equals in attributes", () => 
	{
		const html = "<div class = \"test\" id = \"main\" data-value = \"123\"></div>";
		const minified = minify__(html, "html");

		expect(minified).toBe('<div class="test" id="main" data-value="123"></div>');
		expect(minified).not.toContain(" = ");
	});

	it("minify HTML removes spaces before closing bracket", () => 
	{
		const html = "<div class=\"test\" ><span id=\"inner\" ></span></div>";
		const minified = minify__(html, "html");

		expect(minified).toBe('<div class="test"><span id="inner"></span></div>');
		expect(minified).not.toContain(" >");
	});

	it("minify HTML removes default script type attribute", () => 
	{
		const html = "<script type=\"text/javascript\">console.log(\"test\");</script>";
		const minified = minify__(html, "html");

		expect(minified).toBe('<script>console.log("test");</script>');
		expect(minified).not.toContain('type="text/javascript"');
	});

	it("minify HTML removes default style type attribute", () => 
	{
		const html = "<style type=\"text/css\">.test { color: red; }</style>";
		const minified = minify__(html, "html");

		expect(minified).toBe("<style>.test { color: red; }</style>");
		expect(minified).not.toContain('type="text/css"');
	});

	it("minify HTML collapses boolean attributes", () => 
	{
		const html = "<input type=\"checkbox\" checked=\"checked\" disabled=\"disabled\" required=\"required\">";
		const minified = minify__(html, "html");

		expect(minified).toContain("checked");
		expect(minified).toContain("disabled");
		expect(minified).toContain("required");
		expect(minified).not.toContain('checked="checked"');
		expect(minified).not.toContain('disabled="disabled"');
		expect(minified).not.toContain('required="required"');
	});

	it("minify HTML preserves non-boolean attribute values", () => 
	{
		const html = "<input type=\"text\" value=\"checked\" name=\"disabled\">";
		const minified = minify__(html, "html");

		expect(minified).toContain('value="checked"');
		expect(minified).toContain('name="disabled"');
	});

	it("minify SVG removes spaces around equals in attributes", () => 
	{
		const svg = "<svg width = \"100\" height = \"100\"><circle cx = \"50\" cy = \"50\" r = \"40\"/></svg>";
		const minified = minify__(svg, "svg");

		expect(minified).toBe('<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>');
		expect(minified).not.toContain(" = ");
	});

	it("minify SVG removes .0 from whole numbers", () => 
	{
		const svg = "<svg><path d=\"M 10.0 20.0 L 30.0 40.0\"/></svg>";
		const minified = minify__(svg, "svg");

		expect(minified).toContain("M 10 20 L 30 40");
		expect(minified).not.toContain(".0");
	});

	it("minify SVG removes trailing zeros from decimals", () => 
	{
		const svg = "<svg><circle cx=\"10.500\" cy=\"20.1000\" r=\"5.00\"/></svg>";
		const minified = minify__(svg, "svg");

		expect(minified).toContain('cx="10.5"');
		expect(minified).toContain('cy="20.1"');
		expect(minified).toContain('r="5"');
	});

	it("minify SVG removes leading zeros from decimals", () => 
	{
		const svg = "<svg><rect opacity=\"0.5\" fill-opacity=\"0.75\"/></svg>";
		const minified = minify__(svg, "svg");

		expect(minified).toContain('opacity=".5"');
		expect(minified).toContain('fill-opacity=".75"');
	});

	it("minify SVG preserves integers", () => 
	{
		const svg = "<svg width=\"100\" height=\"200\"><circle r=\"10\"/></svg>";
		const minified = minify__(svg, "svg");

		expect(minified).toContain('width="100"');
		expect(minified).toContain('height="200"');
		expect(minified).toContain('r="10"');
	});
});
