import * as fs from "fs";
import * as acorn from "acorn";
import * as escodegen from "escodegen";
import * as periscopic from "periscopic";
import * as estreewalker from "estree-walker";

export function buildClient() {
  const content = fs.readFileSync("./app.svelte", "utf-8");
  fs.writeFileSync("./app.js", compile(content, "dom"), "utf-8");
}

// const content = fs.readFileSync("./app.svelte", "utf-8");

// fs.writeFileSync("./ssr.js", compile(content, "ssr"), "utf-8");
// fs.writeFileSync("./app.js", compile(content, "dom"), "utf-8");

function compile(content, compileTarget) {
  const ast = parse(content);
  const analysis = analyze(ast);

  return compileTarget === "ssr"
    ? generateSSR(ast, analysis)
    : generate(ast, analysis);
}

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
    reactiveDeclarations: [],
  };

  const { scope: rootScope, map, globals } = periscopic.analyze(ast.script);
  result.variables = new Set(rootScope.declarations.keys());
  result.rootScope = rootScope;
  result.map = map;

  const toRemove = new Set();

  ast.script.body.forEach((node, index) => {
    if (node.type === "LabeledStatement" && node.label.name === "$") {
      const body = node.body;
      const left = body.expression.left;
      const right = body.expression.right;
      const dependencies = [];

      estreewalker.walk(right, {
        enter: (node) => {
          if (node.type === "Identifier") {
            dependencies.push(node.name);
          }
        },
      });

      result.willChange.add(left.name);

      const reactiveDeclaration = {
        index,
        node: body,
        dependencies,
        assignees: [left.name],
      };

      result.reactiveDeclarations.push(reactiveDeclaration);
      toRemove.add(node);
    }
  });

  ast.script.body = ast.script.body.filter((node) => !toRemove.has(node));

  let currentScope = rootScope;
  estreewalker.walk(ast.script, {
    enter: (node) => {
      if (map.has(node)) currentScope = map.get(node);
      if (
        node.type === "UpdateExpression" ||
        node.type === "AssignmentExpression"
      ) {
        const names = periscopic.extract_names(
          node.type === "UpdateExpression" ? node.argument : node.left
        );
        for (const name of names) {
          if (
            currentScope.find_owner(name) === rootScope ||
            globals.has(name)
          ) {
            result.willChange.add(name);
          }
        }
      }
    },
    leave: (node) => {
      if (map.has(node)) currentScope = currentScope.parent;
    },
  });

  function traverse(fragment) {
    switch (fragment.type) {
      case "Element": {
        fragment.children.forEach(traverse);
        fragment.attributes.forEach(traverse);
        break;
      }
      case "Attribute": {
        result.willUseInTemplate.add(fragment.value.name);
        break;
      }
      case "Expression": {
        extractNames(fragment.expression).forEach((n) =>
          result.willUseInTemplate.add(n)
        );
        break;
      }
    }
  }

  ast.html.forEach(traverse);

  return result;
}
function generate(ast, analysis) {
  const code = {
    variables: [],
    create: [],
    update: [],
    destroy: [],
    reactiveDeclarations: [],
  };
  let counter = 1;
  let hydrationIndex = 0;
  let hydrationParent = "target";

  function traverse(node, parent) {
    switch (node.type) {
      case "Element": {
        const variableName = `${node.name}_${counter++}`;
        code.variables.push(variableName);
        code.create.push(
          `${variableName} = shouldHydrate ? ${hydrationParent}.childNodes[${hydrationIndex++}] : document.createElement('${
            node.name
          }');`
        );
        node.attributes.forEach((att) => {
          traverse(att, variableName);
        });

        const currentHydrationParent = hydrationParent;
        const currentHydrationIndex = hydrationIndex;

        hydrationParent = variableName;
        hydrationIndex = 0;

        node.children.forEach((c) => traverse(c, variableName));

        hydrationParent = currentHydrationParent;
        hydrationIndex = currentHydrationIndex;

        code.create.push(
          `if (!shouldHydrate) ${parent}.appendChild(${variableName});`
        );
        code.destroy.push(`${parent}.removeChild(${variableName});`);
        break;
      }
      case "Text": {
        const variableName = `txt_${counter++}`;
        code.variables.push(variableName);
        code.create.push(
          `
            ${variableName} = shouldHydrate ? ${hydrationParent}.childNodes[${hydrationIndex++}] : document.createTextNode('${
            node.value
          }');
          `
        );
        hydrationIndex++;
        code.create.push(
          `if (!shouldHydrate) ${parent}.appendChild(${variableName});`
        );
        code.destroy.push(`${parent}.removeChild(${variableName});`);
        break;
      }
      case "Attribute": {
        if (node.name.startsWith("on:")) {
          const eventName = node.name.slice(3);
          const eventHandler = node.value.name;
          code.create.push(
            `${parent}.addEventListener('${eventName}', ${eventHandler});`
          );
          code.destroy.push(
            `${parent}.removeEventListener('${eventName}', ${eventHandler});`
          );
        }
        break;
      }
      case "Expression": {
        const variableName = `txt_${counter++}`;
        const expressionStr = escodegen.generate(node.expression);
        code.variables.push(variableName);
        code.create.push(`
            ${variableName} = shouldHydrate ? ${hydrationParent}.childNodes[${hydrationIndex++}] : document.createTextNode(${expressionStr});
          `);
        hydrationIndex++;
        code.create.push(`
            if(!shouldHydrate) ${parent}.appendChild(${variableName});
          `);
        const names = extractNames(node.expression);
        if (names.some((n) => analysis.willChange.has(n))) {
          const changes = names.filter((v) => analysis.willChange.has(v));
          let condition = "";
          if (changes.length > 1) {
            condition = `${JSON.stringify(
              changes
            )}.some(name => changed.includes(name))`;
          } else {
            condition = `changed.includes('${changes[0]}')`;
          }
          code.update.push(`
              if(${condition}){
                ${variableName}.data = ${expressionStr};
              };
            `);
        }
        break;
      }
    }
  }

  ast.html.forEach((f) => traverse(f, "target"));

  const { rootScope, map } = analysis;
  let currentScope = rootScope;

  estreewalker.walk(ast.script, {
    enter(node) {
      if (map.has(node)) currentScope = map.get(node);
      if (
        node.type === "UpdateExpression" ||
        node.type === "AssignmentExpression"
      ) {
        const names = periscopic
          .extract_names(
            node.type === "UpdateExpression" ? node.argument : node.left
          )
          .filter(
            (name) =>
              currentScope.find_owner(name) === rootScope &&
              analysis.willUseInTemplate.has(name)
          );

        if (names.length > 0) {
          this.replace({
            type: "SequenceExpression",
            expressions: [
              node,
              acorn.parseExpressionAt(`update(${JSON.stringify(names)})`, 0, {
                ecmaVersion: 2022,
              }),
            ],
          });
          this.skip();
        }
      }
    },
    leave(node) {
      if (map.has(node)) currentScope = currentScope.parent;
    },
  });

  analysis.reactiveDeclarations.sort((rd1, rd2) => {
    if (rd1.assignees.some((assignee) => rd2.dependencies.includes(assignee))) {
      return -1;
    }

    if (rd2.assignees.some((assignee) => rd1.declarations.includes(assignee))) {
      return 1;
    }

    return rd1.index - rd2.index;
  });

  analysis.reactiveDeclarations.forEach((d) => {
    code.reactiveDeclarations.push(`
        if (${JSON.stringify(
          d.dependencies
        )}.some(name => collectedChanges.includes(name))){
          ${escodegen.generate(d.node)}
          update(${JSON.stringify(d.assignees)})
        }
      `);
    d.assignees.forEach((a) => code.variables.push(a));
  });

  return `
    export default function(){
      ${code.variables.map((v) => `let ${v};`).join("\n")}

      let collectedChanges = [];
      let updateCalled = false;

      function update(changed) {
        changed.forEach(c => collectedChanges.push(c))

        if (updateCalled) return;
        updateCalled = true;

        updateReactiveDeclarations();
        if (typeof lifecycle !== "undefined") lifecycle.update(collectedChanges);
        collectedChanges = [];
        updateCalled = false;
      };

      function updateReactiveDeclarations() {
        ${code.reactiveDeclarations.join("\n")}
      };

     
      ${escodegen.generate(ast.script)}

       update(${JSON.stringify(Array.from(analysis.willChange))});
      
      var lifecycle = {
        create(target, shouldHydrate = target.childNodes.length > 0){
          ${code.create.join("\n")};
        },
        update(changed){
          ${code.update.join("\n")};
        },
        destroy(target){
          ${code.destroy.join("\n")};
        },
      }

      return lifecycle;
    }
  `;
}

function extractNames(jsNode, result = []) {
  switch (jsNode.type) {
    case "Identifier": {
      result.push(jsNode.name);
      break;
    }
    case "BinaryExpression": {
      extractNames(jsNode.left, result);
      extractNames(jsNode.right, result);
      break;
    }
  }

  return result;
}

function generateSSR(ast, analysis) {
  const code = {
    variables: [],
    reactiveDeclarations: [],
    template: {
      expressions: [],
      quasis: [],
    },
  };

  let templateStr = "";

  function addString(str) {
    templateStr += str;
  }

  function addExpression(expression) {
    code.template.quasis.push(templateStr);
    code.template.expressions.push(expression);
    templateStr = "";
  }

  function traverse(node) {
    switch (node.type) {
      case "Element": {
        addString(`<${node.name}`);
        node.attributes.forEach((att) => {
          traverse(att);
        });
        addString(">");
        node.children.forEach((c) => traverse(c));
        addString(`</${node.name}>`);
        break;
      }
      case "Text": {
        addString(node.value);
        addString("<!---->");
        break;
      }
      case "Attribute": {
        addString(" class='some-class'");
        break;
      }
      case "Expression": {
        addExpression(node.expression);
        addString("<!---->");
        break;
      }
    }
  }

  ast.html.forEach((f) => traverse(f));

  code.template.quasis.push(templateStr);
  templateStr = "";

  analysis.reactiveDeclarations.sort((rd1, rd2) => {
    if (rd1.assignees.some((assignee) => rd2.dependencies.includes(assignee))) {
      return -1;
    }

    if (rd2.assignees.some((assignee) => rd1.declarations.includes(assignee))) {
      return 1;
    }

    return rd1.index - rd2.index;
  });

  analysis.reactiveDeclarations.forEach((d) => {
    code.reactiveDeclarations.push(escodegen.generate(d.node));
    d.assignees.forEach((a) => code.variables.push(a));
  });

  ast.script.body = ast.script.body.filter((n) => {
    return n.declarations[0].init.type !== "ArrowFunctionExpression";
  });

  const templateLiteral = {
    type: "TemplateLiteral",
    expressions: code.template.expressions,
    quasis: code.template.quasis.map((q) => ({
      type: "TemplateElement",
      value: {
        raw: q,
        cooked: q,
      },
    })),
  };

  return `
    export default function(){
      ${code.variables.map((v) => `let ${v};`).join("\n")}
      ${escodegen.generate(ast.script)}
      ${code.reactiveDeclarations.join("\n")}
 
      return ${escodegen.generate(templateLiteral)};
    }
  `;
}
