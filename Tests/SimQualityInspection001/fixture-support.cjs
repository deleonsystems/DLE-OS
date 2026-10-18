const fs=require('fs'),path=require('path'),os=require('os');
const repo=path.resolve(__dirname,'../..');
const out=process.env.DLE_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'dle-qc-tests-'));
fs.mkdirSync(out,{recursive:true});
const sources={"work-area-home.js": "SRC/home/work-area-home.js", "work-area-home.css": "SRC/home/work-area-home.css", "workspace-registry.js": "SRC/shell/workspace-registry.js", "production-instruction-editor.js": "SRC/workspaces/kitting/production-instruction-editor.js", "quality-inspection-workspace.js": "SRC/workspaces/quality-inspection/quality-inspection-workspace.js", "quality-inspection-workspace.css": "SRC/workspaces/quality-inspection/quality-inspection-workspace.css"};
module.exports={repo,out,read:n=>fs.readFileSync(path.join(repo,sources[n]),'utf8')};
