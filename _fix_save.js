const fs = require('fs');
let js = fs.readFileSync('src/modules/attachments.js', 'utf8');
const lines = js.split('\n');

// Find the alert('请选择类型') line and add the rcfg fallback before it
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("alert('请选择类型')") || lines[i].includes('alert("请选择类型")')) {
    // Get the indentation of this line
    const indent = lines[i].match(/^\s*/)[0];
    // Get the indentation of the parent if block (one level less)
    const parentIndent = indent.slice(0, -2);
    // Replace: if (!theType) { alert... return; }
    // With: if (!theType) { theType = rcfg && rcfg.type; if (!theType) { alert... return; } }
    lines[i] = indent + "alert('请选择类型');";
    lines[i-1] = lines[i-1] + "\n" + parentIndent + "theType = rcfg && rcfg.type;\n" + parentIndent + "if (!theType) {";
    break;
  }
}

js = lines.join('\n');
fs.writeFileSync('src/modules/attachments.js', js);
console.log('Done');
