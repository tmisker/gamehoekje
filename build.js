// Assemble the self-contained index.html from template + solver + app.
const fs = require("fs");
const tpl = fs.readFileSync("template.html","utf8");
const solver = fs.readFileSync("solver.js","utf8");
const kociemba = fs.readFileSync("kociemba.js","utf8");
const app = fs.readFileSync("app.js","utf8");
const out = tpl
  .replace("/*__SOLVER__*/", "\n"+solver+"\n")
  .replace("/*__KOCIEMBA__*/", "\n"+kociemba+"\n")
  .replace("/*__APP__*/", "\n"+app+"\n");
fs.writeFileSync("index.html", out);
console.log("index.html written ("+out.length+" bytes)");
