#!/usr/bin/env node
"use strict";
exports.__esModule = true;
var path = require("path");
var fs = require("fs");
var lodash_1 = require("lodash");
/**
 * Command line interface (CLI) for generator.
 *
 * @package angular2-swagger-apiclient-generator
 * @author Navid Nikpour <navid@nikpour.com>
 */
//
var optimist = require('optimist')
    .usage('Usage: swagger2angular [options]')
    .alias('h', 'help').describe('h', 'Displays this help information')
    .alias('s', 'source').describe('s', 'Path to your swagger specification, can be file or a URL path')
    .alias('o', 'outputPath').describe('o', 'Output path for the generated files')["default"]('o', 'client')
    .alias('d', 'debug').describe('d', 'Enable verbose debug message')["default"]('d', false)
    .alias('t', 'templatePath').describe('t', 'Path to own templates to generate model and resource files')
    .alias('r', 'resourceTemplate').describe('o', 'Template filename for generating resource files')
    .alias('m', 'modelTemplate').describe('o', 'Template filename for generatiing model files')
    .alias('g', 'generateTemplates').describe('g', 'Generates files for model and resource templates, showing the template contexts')
    .alias('b', 'buildConfig').describe('b', 'Path to your swagger2angular configuration file.');
var argv = optimist.argv;
console.log(argv);
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
var config = argv.buildConfig
    ? JSON.parse(fs.readFileSync(argv.buildConfig, 'utf8'))
    : {
        swaggerSpecFile: argv.source,
        output: argv.outputPath,
        debug: argv.debug,
        templatePath: argv.templatePath,
        modelTemplate: argv.modelTemplate,
        resourceTemplate: argv.resourceTemplate
    };
var Generator = require('..').Generator;
var generator = new Generator(config);
// create output paths if they don't exist
var outputPath = path.join(process.cwd(), generator.getOutputPath());
if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
}
// create util file
var utilsPath = path.join(outputPath, 'utils');
if (!fs.existsSync(utilsPath)) {
    fs.mkdirSync(utilsPath);
}
fs.writeFileSync(path.join(utilsPath, 'index.ts'), "\nimport { Response, Headers} from '@angular/http';\n\nexport interface ClientResponse<T>\n{\n  data?: T;\n  headers: Headers;\n  code: number;\n}\n\nexport const toClientResponse = (res:Response):ClientResponse<T> => {\n  return ({ data: res.json(), headers: res.headers, code: res.status})\n};");
// create barrel template function
var barrelRenderer = Generator.templateCompiler("\n/* tslint:disable */\n{{#each paths}}\nexport * from './{{this}}';\n{{/each}}\n");
// create models and model barrel
var modelsPath = path.join(outputPath, 'models');
if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath);
}
generator.getModels().then(function (models) {
    var modelsPathList = lodash_1.map(models, function (modelDefinition, modelName) {
        var modelPath = path.join(modelsPath, modelName + ".ts");
        fs.writeFileSync(modelPath, generator.processModel({ modelName: modelName, modelDefinition: modelDefinition }));
        return modelPath;
    });
    // create models barrel
    var modelsRelativePaths = lodash_1.map(modelsPathList, function (modelPath) { return path.relative(modelsPath, modelPath); });
    fs.writeFileSync(path.join(modelsPath, 'index.ts'), barrelRenderer({ paths: modelsRelativePaths }));
});
// create resources and resource barrel
var resourcesPath = path.join(outputPath, 'resources');
if (!fs.existsSync(resourcesPath)) {
    fs.mkdirSync(resourcesPath);
}
generator.getResources().then(function (resources) {
    var resourcesPathList = lodash_1.map(resources, function (resourceDefinition, resourceName) {
        var resourcePath = path.join(resourcesPath, resourceName + ".ts");
        fs.writeFileSync(resourcePath, generator.processResource({ resourceName: resourceName, resourceDefinition: resourceDefinition }));
        return resourcePath;
    });
    // create resources barrel
    var resourcesRelativePaths = lodash_1.map(resourcesPathList, function (resourcePath) { return path.relative(resourcesPath, resourcePath); });
    fs.writeFileSync(path.join(resourcesPath, 'index.ts'), barrelRenderer({ paths: resourcesRelativePaths }));
});
