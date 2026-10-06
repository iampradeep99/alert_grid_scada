import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'src', 'index.js');
const outputDir = path.join(rootDir, 'postman');

const BASE_PATH = '/krphapi/FGMS';

const ENVIRONMENTS = [
  {
    name: 'KRPH FGMS Local',
    fileName: 'KRPH_FGMS_Local.postman_environment.json',
    baseUrl: 'http://localhost:9300'
  },
  {
    name: 'KRPH FGMS UAT',
    fileName: 'KRPH_FGMS_UAT.postman_environment.json',
    baseUrl: 'https://pmfbydemo.amnex.co.in'
  },
  {
    name: 'KRPH FGMS Production',
    fileName: 'KRPH_FGMS_Production.postman_environment.json',
    baseUrl: 'https://pmfby.gov.in'
  }
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

function normalizeUrl(...parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('/');

  return joined
    .replace(/\/+/g, '/')
    .replace(':/', '://')
    .replace(/\/$/, '') || '/';
}

function parseImports(indexSource) {
  const imports = new Map();
  const importRegex = /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']/g;
  let match;

  while ((match = importRegex.exec(indexSource)) !== null) {
    const names = match[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => name.split(/\s+as\s+/).pop().trim());
    const importPath = match[2];

    for (const name of names) {
      imports.set(name, importPath);
    }
  }

  return imports;
}

function parseMounts(indexSource) {
  const imports = parseImports(indexSource);
  const mounts = [];
  const mountRegex = /router\.use\(\s*["']([^"']*)["']\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  let match;

  while ((match = mountRegex.exec(indexSource)) !== null) {
    const [, mountPath, routerName] = match;
    const importPath = imports.get(routerName);

    if (!importPath) continue;

    mounts.push({
      routerName,
      mountPath,
      filePath: path.resolve(path.dirname(indexPath), importPath)
    });
  }

  return mounts;
}

function getBalancedCall(source, startIndex) {
  const openIndex = source.indexOf('(', startIndex);
  if (openIndex === -1) return '';

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;

    if (depth === 0) {
      return source.slice(startIndex, index + 1);
    }
  }

  return source.slice(startIndex);
}

function parseRoutes(filePath) {
  const source = stripComments(readText(filePath));
  const imports = parseImports(source);
  const controllerInstances = parseControllerInstances(source, imports, filePath);
  const routes = [];
  const routeRegex = /([A-Za-z0-9_]+)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match;

  while ((match = routeRegex.exec(source)) !== null) {
    const callSource = getBalancedCall(source, match.index);
    const validatorMatch = callSource.match(/validator\s*\.\s*body\s*\(\s*([A-Za-z0-9_]+)\s*\)/);
    const uploadSingleMatch = callSource.match(/upload\s*\.\s*single\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/);
    const handler = getRouteHandler(callSource);
    const handlerInfo = resolveHandler(handler, imports, controllerInstances, filePath);

    routes.push({
      routerName: match[1],
      method: match[2].toUpperCase(),
      routePath: match[3],
      validatorName: validatorMatch?.[1],
      validatorImportPath: validatorMatch?.[1] ? imports.get(validatorMatch[1]) : undefined,
      handler,
      handlerInfo,
      uploadFieldName: uploadSingleMatch?.[1] || (callSource.includes('FileuploadMiddleware') ? 'file' : undefined),
      line: source.slice(0, match.index).split('\n').length
    });
  }

  return routes;
}

function parseControllerInstances(source, imports, routeFilePath) {
  const instances = new Map();
  const instanceRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*new\s+([A-Za-z0-9_]+)\s*\(/g;
  let match;

  while ((match = instanceRegex.exec(source)) !== null) {
    const [, instanceName, className] = match;
    const importPath = imports.get(className);

    if (!importPath) continue;

    instances.set(instanceName, {
      className,
      filePath: resolveImportPath(importPath, routeFilePath)
    });
  }

  return instances;
}

function getRouteHandler(callSource) {
  const withoutOpening = callSource.slice(callSource.indexOf('(') + 1, -1);
  const args = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < withoutOpening.length; index += 1) {
    const char = withoutOpening[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;

    if (char === ',' && depth === 0) {
      args.push(withoutOpening.slice(start, index).trim());
      start = index + 1;
    }
  }

  args.push(withoutOpening.slice(start).trim());
  const handler = args[args.length - 1] || '';

  if (/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(handler)) {
    return handler;
  }

  return undefined;
}

function resolveImportPath(importPath, fromFilePath) {
  const resolvedPath = path.resolve(path.dirname(fromFilePath), importPath);
  return resolvedPath.endsWith('.js') ? resolvedPath : `${resolvedPath}.js`;
}

function resolveHandler(handler, imports, controllerInstances, routeFilePath) {
  if (!handler) return undefined;

  if (handler.includes('.')) {
    const [instanceName, methodName] = handler.split('.');
    const instance = controllerInstances.get(instanceName);

    if (!instance) return undefined;

    return {
      type: 'classMethod',
      filePath: instance.filePath,
      className: instance.className,
      functionName: methodName
    };
  }

  const importPath = imports.get(handler);
  if (!importPath) return undefined;

  return {
    type: 'exportedFunction',
    filePath: resolveImportPath(importPath, routeFilePath),
    functionName: handler
  };
}

function folderNameForMount(mount) {
  if (mount.mountPath && mount.mountPath !== '/') {
    return mount.mountPath.replace(/^\/+/, '');
  }

  return path
    .basename(mount.filePath)
    .replace(/Router|Routes|\.js/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRule(schema, ruleName) {
  return schema.rules?.find((rule) => rule.name === ruleName);
}

function sampleString(fieldName, schema) {
  const lowerName = fieldName.toLowerCase();
  const validValue = schema.allow?.find((value) => value !== '' && value !== null);

  if (validValue !== undefined) return validValue;
  if (schema.flags?.default !== undefined) return schema.flags.default;
  if (schema.flags?.only && schema.allow?.length) return schema.allow[0];
  if (lowerName.includes('mobile') || lowerName.includes('phone') || lowerName.includes('contact')) return '9876543210';
  if (lowerName.includes('email')) return 'user@example.com';
  if (lowerName.includes('date')) return '2026-05-20';
  if (lowerName.includes('year')) return '2026';
  if (lowerName.includes('season')) return '1';
  if (lowerName.includes('password')) return 'Password@123';
  if (lowerName.includes('ipaddress') || lowerName.includes('ip')) return '127.0.0.1';
  if (lowerName.includes('url')) return 'https://example.com';
  if (lowerName.includes('id') || lowerName.includes('code')) return '1';

  const lengthRule = getRule(schema, 'length');
  if (lengthRule?.args?.limit) return '1'.repeat(Math.min(lengthRule.args.limit, 36));

  const minRule = getRule(schema, 'min');
  if (minRule?.args?.limit && minRule.args.limit <= 36) return 'x'.repeat(minRule.args.limit);

  return 'string';
}

function sampleNumber(fieldName, schema) {
  const validValue = schema.allow?.find((value) => typeof value === 'number');
  if (validValue !== undefined) return validValue;
  if (schema.flags?.default !== undefined) return schema.flags.default;
  if (schema.flags?.only && schema.allow?.length) return schema.allow[0];

  const minRule = getRule(schema, 'min');
  if (typeof minRule?.args?.limit === 'number') return minRule.args.limit;

  const lowerName = fieldName.toLowerCase();
  if (lowerName.includes('mobile') || lowerName.includes('phone') || lowerName.includes('contact')) return 9876543210;
  if (lowerName.includes('year')) return 2026;
  if (lowerName.includes('season')) return 1;

  return 1;
}

function sampleFromJoiDescription(schema, fieldName = 'value') {
  if (!schema) return null;

  if (schema.flags?.default !== undefined) return schema.flags.default;
  if (schema.flags?.only && schema.allow?.length) {
    const validValue = schema.allow.find((value) => value !== '' && value !== null);
    if (validValue !== undefined) return validValue;
  }

  switch (schema.type) {
    case 'object': {
      const sample = {};
      for (const [key, childSchema] of Object.entries(schema.keys || {})) {
        sample[key] = sampleFromJoiDescription(childSchema, key);
      }
      return sample;
    }
    case 'array': {
      const itemSchema = schema.items?.[0] || schema.ordered?.[0];
      return [sampleFromJoiDescription(itemSchema, fieldName)];
    }
    case 'string':
      return sampleString(fieldName, schema);
    case 'number':
      return sampleNumber(fieldName, schema);
    case 'boolean':
      return true;
    case 'date':
      return '2026-05-20';
    case 'alternatives': {
      const alternative = schema.matches?.[0]?.schema || schema.matches?.[0]?.then || schema.matches?.[0]?.otherwise;
      return sampleFromJoiDescription(alternative, fieldName) ?? 'string';
    }
    case 'any':
      return schema.allow?.find((value) => value !== null && value !== '') ?? 'value';
    default:
      return null;
  }
}

function createPlaceholderPayload(route) {
  return {
    _note: `No Joi payload validator found for ${route.method} ${normalizeUrl(BASE_PATH, route.mountPath, route.routePath)}. Replace this sample with the controller's required payload.`
  };
}

function createRequest(route) {
  const pathSegments = normalizeUrl(BASE_PATH, route.mountPath, route.routePath)
    .split('/')
    .filter(Boolean);

  const request = {
    method: route.method,
    header: [
      {
        key: 'Content-Type',
        value: 'application/json',
        type: 'text'
      }
    ],
    url: {
      raw: `{{baseUrl}}/${pathSegments.join('/')}`,
      host: ['{{baseUrl}}'],
      path: pathSegments
    }
  };

  if (route.uploadFieldName) {
    request.header = [];
    request.body = {
      mode: 'formdata',
      formdata: [
        {
          key: route.uploadFieldName,
          type: 'file',
          src: []
        }
      ]
    };
    return request;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) {
    const payload = route.samplePayload ?? createPlaceholderPayload(route);

    request.body = {
      mode: 'raw',
      raw: JSON.stringify(payload, null, 2),
      options: {
        raw: {
          language: 'json'
        }
      }
    };
  }

  return request;
}

function createCollection(routes) {
  const folders = new Map();

  for (const route of routes) {
    const folderName = route.folderName;
    if (!folders.has(folderName)) {
      folders.set(folderName, []);
    }

    const fullPath = normalizeUrl(BASE_PATH, route.mountPath, route.routePath);
    const duplicateSuffix = route.duplicateIndex > 1 ? ` #${route.duplicateIndex}` : '';

    folders.get(folderName).push({
      name: `${route.method} ${fullPath}${duplicateSuffix}`,
      request: createRequest(route),
      response: []
    });
  }

  const items = [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, item]) => ({
      name,
      item: item.sort((a, b) => a.name.localeCompare(b.name))
    }));

  return {
    info: {
      name: 'KRPH FGMS API',
      description: [
        'Generated from Express router files in this repository.',
        'Select one of the Local, UAT, or Production environments before sending requests.',
        'Set the `token` environment variable if an endpoint requires bearer authentication.'
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{token}}',
          type: 'string'
        }
      ]
    },
    variable: [
      {
        key: 'baseUrl',
        value: 'http://localhost:9300'
      },
      {
        key: 'token',
        value: ''
      }
    ],
    item: items
  };
}

const schemaModuleCache = new Map();

async function loadSchemaModule(importPath, routeFilePath) {
  if (!importPath) return null;

  const resolvedPath = path.resolve(path.dirname(routeFilePath), importPath);
  const filePath = resolvedPath.endsWith('.js') ? resolvedPath : `${resolvedPath}.js`;

  if (!fs.existsSync(filePath)) return null;
  if (!schemaModuleCache.has(filePath)) {
    schemaModuleCache.set(filePath, import(pathToFileURL(filePath)));
  }

  return schemaModuleCache.get(filePath);
}

async function attachSamplePayloads(routes) {
  let validatorPayloadCount = 0;
  let controllerPayloadCount = 0;

  for (const route of routes) {
    if (!route.validatorName || !route.validatorImportPath) continue;

    try {
      const schemaModule = await loadSchemaModule(route.validatorImportPath, route.filePath);
      const schema = schemaModule?.[route.validatorName];

      if (schema?.describe) {
        route.samplePayload = sampleFromJoiDescription(schema.describe());
        route.sampleSource = route.validatorName;
        validatorPayloadCount += 1;
      }
    } catch (error) {
      route.samplePayload = {
        _note: `Could not load Joi validator ${route.validatorName}: ${error.message}`
      };
    }
  }

  for (const route of routes) {
    if (route.samplePayload || route.uploadFieldName || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) {
      continue;
    }

    const inferredPayload = inferPayloadFromHandler(route.handlerInfo);
    if (inferredPayload && Object.keys(inferredPayload).length > 0) {
      route.samplePayload = inferredPayload;
      route.sampleSource = route.handler;
      controllerPayloadCount += 1;
    }
  }

  return { validatorPayloadCount, controllerPayloadCount };
}

function getBalancedBlock(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return source.slice(openIndex, index + 1);
    }
  }

  return source.slice(openIndex);
}

function extractExportedFunctionBody(source, functionName) {
  const patterns = [
    new RegExp(`export\\s+const\\s+${functionName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`),
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`)
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;

    const openIndex = source.indexOf('{', match.index);
    return getBalancedBlock(source, openIndex);
  }

  return '';
}

function extractClassMethodBody(source, className, methodName) {
  const classMatch = new RegExp(`class\\s+${className}\\b`).exec(source);
  if (!classMatch) return '';

  const classOpenIndex = source.indexOf('{', classMatch.index);
  if (classOpenIndex === -1) return '';

  const classBody = getBalancedBlock(source, classOpenIndex);
  const methodMatch = new RegExp(`(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`).exec(classBody);
  if (!methodMatch) return '';

  const methodOpenIndex = classBody.indexOf('{', methodMatch.index);
  return getBalancedBlock(classBody, methodOpenIndex);
}

function splitTopLevelFields(fieldsSource) {
  const fields = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < fieldsSource.length; index += 1) {
    const char = fieldsSource[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      fields.push(fieldsSource.slice(start, index).trim());
      start = index + 1;
    }
  }

  fields.push(fieldsSource.slice(start).trim());
  return fields.filter(Boolean);
}

function addFieldToPayload(payload, fieldName) {
  if (!fieldName || fieldName.startsWith('...')) return;
  if (payload[fieldName] !== undefined) return;

  if (fieldName === 'objCommon') {
    payload.objCommon = {
      insertedUserID: '1',
      insertedIPAddress: '127.0.0.1'
    };
    return;
  }

  if (fieldName === 'Tickets' || fieldName.toLowerCase().includes('list')) {
    payload[fieldName] = [];
    return;
  }

  if (fieldName.toLowerCase().includes('email') || fieldName.toLowerCase().includes('mail')) {
    payload[fieldName] = 'user@example.com';
    return;
  }

  if (['page', 'limit', 'pageNo', 'pageSize'].includes(fieldName) || fieldName.toLowerCase().includes('count')) {
    payload[fieldName] = 1;
    return;
  }

  payload[fieldName] = sampleString(fieldName, { type: 'string' });
}

function extractBodyFieldsFromSource(source) {
  const fields = new Set();
  const destructureRegex = /(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*req\.body/g;
  let match;

  while ((match = destructureRegex.exec(source)) !== null) {
    for (const field of splitTopLevelFields(match[1])) {
      const fieldName = field
        .replace(/=.*/s, '')
        .replace(/:.*/s, '')
        .trim();

      if (/^[A-Za-z0-9_]+$/.test(fieldName)) {
        fields.add(fieldName);
      }
    }
  }

  const directBodyRegex = /req\.body\.([A-Za-z0-9_]+)/g;
  while ((match = directBodyRegex.exec(source)) !== null) {
    fields.add(match[1]);
  }

  const bodyAliasRegex = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*req\.body\b/g;
  const aliases = [];
  while ((match = bodyAliasRegex.exec(source)) !== null) {
    aliases.push(match[1]);
  }

  for (const alias of aliases) {
    const aliasRegex = new RegExp(`${alias}\\.([A-Za-z0-9_]+)`, 'g');
    while ((match = aliasRegex.exec(source)) !== null) {
      fields.add(match[1]);
    }
  }

  return fields;
}

function extractHelperBody(source, helperName) {
  const patterns = [
    new RegExp(`const\\s+${helperName}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{`),
    new RegExp(`function\\s+${helperName}\\s*\\([^)]*\\)\\s*\\{`)
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;

    const openIndex = source.indexOf('{', match.index);
    return getBalancedBlock(source, openIndex);
  }

  return '';
}

function inferPayloadFromHandler(handlerInfo) {
  if (!handlerInfo || !handlerInfo.filePath || !fs.existsSync(handlerInfo.filePath)) return null;

  const source = stripComments(readText(handlerInfo.filePath));
  const handlerBody = handlerInfo.type === 'classMethod'
    ? extractClassMethodBody(source, handlerInfo.className, handlerInfo.functionName)
    : extractExportedFunctionBody(source, handlerInfo.functionName);

  if (!handlerBody) return null;

  const fields = extractBodyFieldsFromSource(handlerBody);
  const helperCallRegex = /([A-Za-z0-9_]+)\s*\(\s*req\.body\s*\)/g;
  let helperMatch;

  while ((helperMatch = helperCallRegex.exec(handlerBody)) !== null) {
    const helperBody = extractHelperBody(source, helperMatch[1]);
    for (const field of extractBodyFieldsFromSource(helperBody.replaceAll('body.', 'req.body.'))) {
      fields.add(field);
    }
  }

  const payload = {};
  const emailAliases = ['email', 'emailID', 'emailId', 'mailID', 'mailId', 'toEmail', 'to'];
  if (emailAliases.some((field) => fields.has(field))) {
    for (const field of emailAliases) fields.delete(field);
    fields.add('email');
  }

  for (const field of fields) {
    addFieldToPayload(payload, field);
  }

  return payload;
}

function createEnvironment(environment) {
  return {
    name: environment.name,
    values: [
      {
        key: 'baseUrl',
        value: environment.baseUrl,
        type: 'default',
        enabled: true
      },
      {
        key: 'token',
        value: '',
        type: 'secret',
        enabled: true
      }
    ],
    _postman_variable_scope: 'environment',
    _postman_exported_using: 'KRPH generator'
  };
}

fs.mkdirSync(outputDir, { recursive: true });

const mounts = parseMounts(readText(indexPath));
const routes = [];

for (const mount of mounts) {
  const routeFile = `${mount.filePath.endsWith('.js') ? mount.filePath : `${mount.filePath}.js`}`;

  if (!fs.existsSync(routeFile)) continue;

  for (const route of parseRoutes(routeFile)) {
    routes.push({
      ...route,
      mountPath: mount.mountPath,
      filePath: routeFile,
      folderName: folderNameForMount(mount)
    });
  }
}

const { validatorPayloadCount, controllerPayloadCount } = await attachSamplePayloads(routes);

const seenRoutes = new Map();
for (const route of routes) {
  const key = `${route.method} ${normalizeUrl(BASE_PATH, route.mountPath, route.routePath)}`;
  const count = seenRoutes.get(key) || 0;
  route.duplicateIndex = count + 1;
  seenRoutes.set(key, route.duplicateIndex);
}

const collection = createCollection(routes);
const collectionPath = path.join(outputDir, 'KRPH_FGMS_API.postman_collection.json');
fs.writeFileSync(collectionPath, `${JSON.stringify(collection, null, 2)}\n`);

for (const environment of ENVIRONMENTS) {
  fs.writeFileSync(
    path.join(outputDir, environment.fileName),
    `${JSON.stringify(createEnvironment(environment), null, 2)}\n`
  );
}

console.log(`Generated ${routes.length} requests from ${mounts.length} mounted routers.`);
console.log(`Added Joi-derived sample payloads for ${validatorPayloadCount} requests.`);
console.log(`Added controller-inferred sample payloads for ${controllerPayloadCount} requests.`);
console.log(`Collection: ${path.relative(rootDir, collectionPath)}`);
for (const environment of ENVIRONMENTS) {
  console.log(`Environment: ${path.join('postman', environment.fileName)}`);
}
