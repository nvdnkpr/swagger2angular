#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';

import { map, capitalize, snakeCase, camelCase  } from 'lodash';

/**
 * Command line interface (CLI) for generator.
 *
 * @package angular2-swagger-apiclient-generator
 * @author Navid Nikpour <navid@nikpour.com>
 */

//
const optimist = require('optimist')
  .usage('Usage: swagger2angular [options]')
  .alias('h', 'help').describe('h', 'Displays this help information')
  .alias('s', 'source').describe('s', 'Path to your swagger specification, can be file or a URL path')
  .alias('o', 'outputPath').describe('o', 'Output path for the generated files').default('o', 'client')
  .alias('d', 'debug').describe('d', 'Enable verbose debug message').default('d', false)
  .alias('t', 'templatePath').describe('t', 'Path to own templates to generate model and resource files')
  .alias('r', 'resourceTemplate').describe('o', 'Template filename for generating resource files')
  .alias('m', 'modelTemplate').describe('o', 'Template filename for generatiing model files')
  .alias('p', 'packageTemplate').describe('p', 'Template filename for package.json')
  .alias('g', 'generateTemplates').describe('g', 'Generates files for model and resource templates, showing the template contexts')
  .alias('b', 'buildConfig').describe('b', 'Path to your swagger2angular configuration file.');

const argv = optimist.argv;

function stderr(err) {
  console.log('Error: ' + err);
  process.exit(1);
}

/**
 * Execute
 */
if (argv.help) {
  optimist.showHelp();
  process.exit(0);
}

/**
 * Special Flag for generating
 */

/**
 * Only required option: the swagger file source, either file or URL path
 */

/**
 * Config
 */
const config = argv.buildConfig
  ? JSON.parse(fs.readFileSync(argv.buildConfig, 'utf8'))
  : {
    swaggerSpecFile: argv.source,
    output: argv.outputPath,
    debug: argv.debug,
    templatePath: argv.templatePath,
    modelTemplate: argv.modelTemplate,
    packageTemplate: argv.packageTemplate || '',
    resourceTemplate: argv.resourceTemplate
  };

const Generator = require('..').Generator;

const generator = new Generator(config);
// create output paths if they don't exist
const outputPath = path.join(process.cwd(), generator.getOutputPath());
if (!fs.existsSync(outputPath)) {fs.mkdirSync(outputPath); }


generator.getSpec().then((spec) => {
  const service = {
    tokenName: snakeCase(spec.info.title).toUpperCase(),
    interfaceName: capitalize(camelCase(spec.info.title))
  };
  const entryRenderer = Generator.templateCompiler(`
import { InjectionToken } from '@angular/core';
export * from './models';
export * from './resources';

export let {{service.tokenName}}_CONFIG = new InjectionToken<{{service.interfaceName}}Config>('{{service.interfaceName}}');

export interface {{service.interfaceName}}Config{
  host: string;
}`);

  fs.writeFileSync(path.join(outputPath,'index.ts'), entryRenderer({service}));
});

// create util file
const utilsPath = path.join(outputPath, 'utils');
if (!fs.existsSync(utilsPath)) { fs.mkdirSync(utilsPath); }

fs.writeFileSync(path.join(utilsPath,'index.ts'), `
import { Response, Headers} from '@angular/http';

export interface ClientResponse<T>
{
  data?: T;
  headers: Headers;
  code: number;
}

export function toClientResponse<T>(res:Response):ClientResponse<T> {
    return ({ data: res.json() as T, headers: res.headers, code: res.status});
};`);

// create barrel template function
const barrelRenderer = Generator.templateCompiler(`
/* tslint:disable */
{{#each paths}}
export * from './{{this}}';
{{/each}}
`);


// create models and model barrel
const modelsPath = path.join(outputPath, 'models');
if (!fs.existsSync(modelsPath)) { fs.mkdirSync(modelsPath); }

generator.getModels().then((models) => {
  const modelsPathList =  map(models, (modelDefinition, modelName) => {
    const modelPath = path.join(modelsPath, `${modelName}.ts`);
    fs.writeFileSync(modelPath, generator.processModel({modelName, modelDefinition}));

    return modelPath;
  });

  // create models barrel
  const modelsRelativePaths = map(modelsPathList, (modelPath) => path.relative(modelsPath, modelPath).replace('.ts',''));
  fs.writeFileSync(path.join(modelsPath, 'index.ts'), barrelRenderer({paths: modelsRelativePaths}));
});

// create resources and resource barrel
const resourcesPath = path.join(outputPath, 'resources');
if (!fs.existsSync(resourcesPath)) { fs.mkdirSync(resourcesPath); }

generator.getResources().then((resources) => {
  const resourcesPathList = map(resources, (resourceDefinition, resourceName) => {
    const resourcePath = path.join(resourcesPath, `${resourceName}.ts`);
    fs.writeFileSync(resourcePath, generator.processResource({resourceName, resourceDefinition}));

    return resourcePath;
  });

  // create resources barrel
  const resourcesRelativePaths = map(resourcesPathList, (resourcePath) => path.relative(resourcesPath, resourcePath).replace('.ts',''));
  fs.writeFileSync(path.join(resourcesPath, 'index.ts'), barrelRenderer({paths: resourcesRelativePaths}));
});
