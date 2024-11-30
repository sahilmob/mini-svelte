import * as fs from "fs";
import * as acorn from "acorn";

const content = fs.readFileSync("./app.svelte", "utf-8");
const ast = parse(content);
const analysis = analyze(ast);
const js = generate(ast, analysis);

fs.writeFileSync("./app.js", js, "utf-8");

function parse(content) {
  let i = 0;
  const ast = {};
  ast.html = parseFragments();

  function parseFragments() {
    const fragments = [];

    while (i < content.length) {
      const fragment = parseFragment();
      if (fragment) {
        fragments.push(fragment);
      }
    }

    return fragments;
  }
  function parseFragment() {
    return parseScript() ?? parseElement() ?? parseExpression() ?? parseText();
  }
  function parseScript() {
    if (match("<script>")) {
      eat("<script>");
      const startIndex = i;
      const endIndex = content.indexOf("</script>", i);
      const code = content.slice(startIndex, endIndex);
      ast.script = acorn.parse(code, { ecmaVersion: 2022 });
      i = endIndex;
      eat("</script>");
    }
  }
  function parseElement() {}
  function parseAttributeList() {}
  function parseExpression() {}
  function parseText() {}
  function parseJavascript() {}

  function match(str) {
    return content.slice(i, i + str.length) === str;
  }

  function eat(str) {
    if (match(str)) {
      i += str.length;
    } else {
      throw new Error(`Parse error: expecting "${str}"`);
    }
  }

  function readWhileMatching(regex) {
    let startIndex = i;
    while (regex.test(content[i])) {
      i++;
    }

    return content.slice(startIndex, i);
  }
}
function analysis(ast) {}
function generate(ast, analysis) {}