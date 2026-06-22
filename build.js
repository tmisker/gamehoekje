// Assemble the self-contained cube-solver page from its parts.
//   src/cube-solver/{template,solver,kociemba,app}  ->  games/cube-solver/index.html
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src", "cube-solver");
const OUT = path.join(__dirname, "games", "cube-solver", "index.html");

const read = f => fs.readFileSync(path.join(SRC, f), "utf8");
const tpl = read("template.html");
const out = tpl
  .replace("/*__SOLVER__*/",   "\n" + read("solver.js")   + "\n")
  .replace("/*__KOCIEMBA__*/", "\n" + read("kociemba.js") + "\n")
  .replace("/*__APP__*/",      "\n" + read("app.js")      + "\n");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log("built " + path.relative(__dirname, OUT) + " (" + out.length + " bytes)");
