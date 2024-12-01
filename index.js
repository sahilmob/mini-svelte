import * as fs from "fs";
import * as acorn from "acorn";
import * as periscopic from "periscopic";
import * as estreewalker from "estree-walker";

const content = fs.readFileSync("./app.svelte", "utf-8");
const ast = parse(content);
const analysis = analyze(ast);
// const js = generate(ast, analysis);

console.log(analysis);
fs.writeFileSync("./app.json", JSON.stringify(ast, null, 2), "utf-8");

function parse(content) {
  let i = 0;
  const ast = {};
  ast.html = parseFragments(() => i < content.length);
  return ast;

  function parseFragments(condition) {
    const fragments = [];

    while (condition()) {
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

  function parseElement() {
    if (match("<")) {
      eat("<");
      const tagName = readWhileMatching(/[a-z]/);
      const attributes = parseAttributeList();
      eat(">");

      const endTag = `</${tagName}>`;

      const element = {
        type: "Element",
        name: tagName,
        attributes,
        children: parseFragments(() => !match(endTag)),
      };

      eat(endTag);
      return element;
    }
  }
  function parseAttributeList() {
    const attributes = [];
    skipWhitespace();
    while (!match(">")) {
      attributes.push(parseAttribute());
      skipWhitespace();
    }

    return attributes;
  }
  function parseAttribute() {
    const name = readWhileMatching(/[^=]/);
    eat("={");
    const value = parseJavascript();
    eat("}");

    return {
      type: "Attribute",
      name,
      value,
    };
  }
  function parseExpression() {
    if (match("{")) {
      eat("{");
      const expression = parseJavascript();
      eat("}");

      return {
        type: "Expression",
        expression,
      };
    }
  }
  function parseText() {
    const text = readWhileMatching(/[^<{]/);

    if (text.trim() !== "") {
      return {
        type: "Text",
        value: text,
      };
    }
  }
  function parseJavascript() {
    const js = acorn.parseExpressionAt(content, i, { ecmaVersion: 2022 });
    i = js.end;
    return js;
  }

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
    while (i < content.length && regex.test(content[i])) {
      i++;
    }

    return content.slice(startIndex, i);
  }

  function skipWhitespace() {
    readWhileMatching(/[\s\n]/);
  }
}
function analyze(ast) {
  const result = {
    variables: new Set(),
    willChange: new Set(),
    willUseInTemplate: new Set(),
  };

  const { scope: rootScope, map } = periscopic.analyze(ast.script);
  result.variables = new Set(rootScope.declarations.keys());
  result.rootScope = rootScope;
  result.map = map;

  let currentScope = rootScope;
  estreewalker.walk(ast.script, {
    enter: (node) => {
      if (map.has(node)) currentScope = map.get(node);
      if (
        node.type === "UpdateExpression" &&
        currentScope.find_owner(node.argument.name) === rootScope
      ) {
        result.willChange.add(node.argument.name);
      }
    },
    leave: (node) => {
      if (map.has(node)) currentScope = currentScope.parent;
    },
  });

  function traverse(fragment) {
    switch (fragment.type) {
      case "Element":
        fragment.children.forEach(traverse);
        fragment.attributes.forEach(traverse);
        break;
      case "Attribute":
        result.willUseInTemplate.add(fragment.value.name);
        break;
      case "Expression":
        result.willUseInTemplate.add(fragment.expression.name);
    }
  }

  ast.html.forEach(traverse);

  return result;
}
function generate(ast, analysis) {}
