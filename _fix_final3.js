const fs = require('fs');
let js = fs.readFileSync('src/modules/attachments.js', 'utf8');

// Fix the broken type validation block
// Find: theType = rcfg && rcfg.type; followed by if (!theType) { return; }
// Replace with proper nested structure including alert
js = js.replace(
  `\t\t\t\ttheType = rcfg && rcfg.type;\n\t\t\t\tif (!theType) {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tvar saveData`,
  `\t\t\t\ttheType = rcfg && rcfg.type;\n\t\t\t\tif (!theType) {\n\t\t\t\t\talert('请选择类型');\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t}\n\t\t\t\tvar saveData`
);

fs.writeFileSync('src/modules/attachments.js', js);
console.log('Done');
