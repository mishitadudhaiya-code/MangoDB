/**
 * src/engine/scanner.js — Lightweight Heuristic Source Scanner (pure function)
 * Uses regex only (no AST) to extract dependency relationships from JS / Python snippets.
 */
const { validateManifest } = require('./validateManifest');

const IGNORED_PROPS = new Set([
  'then', 'catch', 'json', 'map', 'filter', 'forEach', 'length', 'status',
  'toString', 'id', 'split', 'slice', 'push', 'join', 'send', 'status', 'send'
]);

/**
 * Scan source files and build an impact manifest.
 * @param {Array<{path: string, content: string}>} files - Max 10 files
 * @returns {Object} Manifest object { project, version, components, edges }
 */
function scanSourceFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('files must be a non-empty array.');
  }

  if (files.length > 10) {
    throw new Error('Maximum 10 files allowed for heuristic scanning.');
  }

  const componentsMap = new Map();
  const edgesList = [];
  const edgeKeys = new Set();

  function addComponent(comp) {
    if (!componentsMap.has(comp.id)) {
      componentsMap.set(comp.id, {
        id: comp.id,
        type: comp.type,
        name: comp.name || comp.id,
        criticality: comp.criticality || 3,
        meta: comp.meta || {}
      });
    }
    return componentsMap.get(comp.id);
  }

  function addEdge(edge) {
    const key = `${edge.from}>${edge.kind}>${edge.to}>${!!edge.dynamic}`;
    if (!edgeKeys.has(key) && edge.from !== edge.to) {
      edgeKeys.add(key);
      edgesList.push({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        dynamic: !!edge.dynamic,
        meta: edge.meta || {}
      });
    }
  }

  // 1. First pass: Register all file components and function definitions
  const functionDefinitions = new Map(); // fnName -> fileComponentId

  for (const file of files) {
    const rawPath = file.path || 'snippet.js';
    const cleanId = rawPath.replace(/[^a-zA-Z0-9_.]/g, '_');
    const isPage = /page|view|frontend|ui/i.test(rawPath);
    const fileCompType = isPage ? 'page' : 'service';

    addComponent({
      id: cleanId,
      type: fileCompType,
      name: rawPath,
      criticality: isPage ? 4 : 3
    });

    const content = file.content || '';

    // Extract JS function defs: function myFunc(
    const jsFnRegex = /(?:function\s+([a-zA-Z0-9_]+)\s*\(|(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\()/g;
    let match;
    while ((match = jsFnRegex.exec(content)) !== null) {
      const fnName = match[1] || match[2];
      if (fnName && fnName.length > 2) {
        const fnId = `fn.${fnName}`;
        addComponent({ id: fnId, type: 'function', name: `${fnName}()`, criticality: 3 });
        addEdge({ from: cleanId, to: fnId, kind: 'calls' });
        functionDefinitions.set(fnName, fnId);
      }
    }

    // Extract Python def: def my_func(
    const pyDefRegex = /def\s+([a-zA-Z0-9_]+)\s*\(/g;
    while ((match = pyDefRegex.exec(content)) !== null) {
      const fnName = match[1];
      if (fnName && !fnName.startsWith('__')) {
        const fnId = `fn.${fnName}`;
        addComponent({ id: fnId, type: 'function', name: `${fnName}()`, criticality: 3 });
        addEdge({ from: cleanId, to: fnId, kind: 'calls' });
        functionDefinitions.set(fnName, fnId);
      }
    }
  }

  // 2. Second pass: Extract API calls, static reads, and dynamic bracket accesses
  for (const file of files) {
    const rawPath = file.path || 'snippet.js';
    const fileId = rawPath.replace(/[^a-zA-Z0-9_.]/g, '_');
    const content = file.content || '';

    // Pattern 1: fetch/axios/requests to "/api/..."
    const apiRegex = /(?:fetch|axios(?:\.get|\.post|\.put|\.delete)?|requests\.(?:get|post|put|delete))\s*\(\s*['"`](\/api\/[^'"`\s?#]+)['"`]/g;
    let match;
    while ((match = apiRegex.exec(content)) !== null) {
      const endpoint = match[1];
      const apiId = `api.${endpoint.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      addComponent({ id: apiId, type: 'api', name: endpoint, criticality: 4 });
      addEdge({ from: fileId, to: apiId, kind: 'calls' });
    }

    // Pattern 2: static property reads like data.user_name or data["user_name"]
    const propDotRegex = /\b(?:data|user|item|order|record|props|res)\.([a-zA-Z0-9_]+)\b/g;
    while ((match = propDotRegex.exec(content)) !== null) {
      const prop = match[1];
      if (!IGNORED_PROPS.has(prop)) {
        const fieldId = `field.${prop}`;
        addComponent({ id: fieldId, type: 'field', name: prop, criticality: 3 });
        addEdge({ from: fileId, to: fieldId, kind: 'reads', dynamic: false });
      }
    }

    const propBracketLiteralRegex = /\b(?:data|user|item|order|record|props|res)\[['"]([a-zA-Z0-9_]+)['"]\]/g;
    while ((match = propBracketLiteralRegex.exec(content)) !== null) {
      const prop = match[1];
      if (!IGNORED_PROPS.has(prop)) {
        const fieldId = `field.${prop}`;
        addComponent({ id: fieldId, type: 'field', name: prop, criticality: 3 });
        addEdge({ from: fileId, to: fieldId, kind: 'reads', dynamic: false });
      }
    }

    // Pattern 3: dynamic bracket access like data[key] or data[variable]
    const dynamicAccessRegex = /\b(?:data|user|item|order|record|props|res)\[([a-zA-Z_$][a-zA-Z0-9_$]*)\]/g;
    while ((match = dynamicAccessRegex.exec(content)) !== null) {
      const varName = match[1];
      // Exclude string literals which were handled above
      if (!varName.startsWith('"') && !varName.startsWith("'")) {
        const dynFieldId = `field.dynamic_access`;
        addComponent({ id: dynFieldId, type: 'field', name: 'dynamic_access', criticality: 3 });
        addEdge({ from: fileId, to: dynFieldId, kind: 'reads', dynamic: true });
      }
    }

    // Pattern 4: function calls between files
    for (const [fnName, fnId] of functionDefinitions.entries()) {
      const callRegex = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
      if (callRegex.test(content)) {
        addEdge({ from: fileId, to: fnId, kind: 'calls' });
      }
    }
  }

  // Ensure at least 2 components so validateManifest accepts it
  if (componentsMap.size < 2) {
    addComponent({ id: 'app.entry', type: 'service', name: 'App Entry', criticality: 3 });
    if (componentsMap.size >= 2) {
      const firstId = Array.from(componentsMap.keys())[0];
      if (firstId !== 'app.entry') {
        addEdge({ from: 'app.entry', to: firstId, kind: 'calls' });
      }
    }
  }

  const manifest = {
    project: 'ScannedSourceProject',
    version: '1.0.0',
    components: Array.from(componentsMap.values()),
    edges: edgesList
  };

  const validation = validateManifest(manifest);
  return {
    valid: validation.valid,
    errors: validation.errors,
    manifest
  };
}

module.exports = { scanSourceFiles };
