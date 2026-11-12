const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8');
// v1.0.8 fabricated leave notifications failed Files-gated handlers and detached
// targets. Until the actual site behavior is verified, leave attachment events native.
test('workspace does not synthesize attachment drag events or retain the rejected coordinator',()=>{
 assert.doesNotMatch(source,/new\s+(?:[\w.]+\.)?DragEvent\s*\(/);
 assert.doesNotMatch(source,/createFileDragCoordinator|releaseFileDrag/);
});
