"use strict";
exports.__esModule = true;
var fs = require("fs");
var path = require("path");
var handlebars_1 = require("handlebars");
var swagger_parser_1 = require("swagger-parser");
var util_1 = require("util");
var _ = require("lodash");
var Generator = (function () {
    function Generator(generatorOptions) {
        var _this = this;
        this.debug = false;
        var options = _.assign(Generator.DEFAULT_OPTIONS, generatorOptions);
        Object.keys(options).forEach(function (optionKey) { return _this[optionKey] = options[optionKey]; });
        console.log("Generating from " + this.swaggerSpecFile + " to " + this.outputPath);
        this._swaggerParserPromise = swagger_parser_1.parse(options.swaggerSpecFile)
            .then(function (api) {
            _this.swaggerSpec = api;
            _this.models = _.each(_this.swaggerSpec.definitions, Generator.retrieveModels);
            _this.resources = Generator.retrieveResources(_this.swaggerSpec.paths);
        })["catch"](function (error) { return console.error(error); });
        this.renderer = {
            resource: handlebars_1.compile(fs.readFileSync(options.templateFiles.resource, 'utf-8')),
            model: handlebars_1.compile(fs.readFileSync(options.templateFiles.model, 'utf-8'))
        };
    }
    Generator.prototype.getResourceRenderer = function () {
        return this.renderer.resource;
    };
    Generator.prototype.getModelRenderer = function () {
        return this.renderer.model;
    };
    Generator.prototype.processResource = function (data) {
        return this.renderer.resource(data);
    };
    Generator.prototype.processModel = function (data) {
        return this.renderer.model(data);
    };
    Generator.prototype.getModels = function () {
        var _this = this;
        return this._swaggerParserPromise.then(function () { return _this.models; });
    };
    Generator.prototype.getResources = function () {
        var _this = this;
        return this._swaggerParserPromise.then(function () { return _this.resources; });
    };
    Generator.prototype.getOutputPath = function () {
        return this.outputPath;
    };
    Generator.templateCompiler = function (template) {
        return handlebars_1.compile(template);
    };
    Generator.primitiveTypeResolver = function (primitiveType) {
        return Generator.typeMapping[primitiveType] !== undefined ? Generator.typeMapping[primitiveType] : primitiveType;
    };
    Generator.refResolver = function (ref) {
        return ref.split('/').reverse()[0];
    };
    ;
    Generator.retrieveModels = function (modelDefinition, modelName) {
        delete modelDefinition['type'];
        modelDefinition.enums = {};
        modelDefinition.refs = [];
        modelDefinition.properties = _
            .chain(modelDefinition.properties)
            .each(function (propertySpec, propertyName) {
            propertySpec = _.assign(propertySpec, { name: propertyName });
            // see if we have a enum
            if (propertySpec["enum"]) {
                var enumName = _.capitalize(propertyName) + "Enum";
                propertySpec = _.assign(propertySpec, { type: enumName, enums: propertySpec["enum"], isEnum: true });
                modelDefinition.enums[enumName] = propertySpec["enum"];
                delete propertySpec['enum'];
            }
            else {
                propertySpec = _.assign(propertySpec, { isEnum: false });
                // try to resolve references
                if (propertySpec.$ref) {
                    var resolvedRef = Generator.refResolver(propertySpec.$ref);
                    modelDefinition.refs.push(resolvedRef);
                    _.assign(propertySpec, {
                        type: resolvedRef,
                        isArray: false,
                        isCircular: (resolvedRef === modelName)
                    });
                }
                else if (propertySpec.type === 'array') {
                    var type = (propertySpec.items.$ref)
                        ? Generator.refResolver(propertySpec.items.$ref)
                        : Generator.primitiveTypeResolver(propertySpec.items.type);
                    if (propertySpec.items.$ref) {
                        modelDefinition.refs.push(type);
                    }
                    _.assign(propertySpec, { type: type, isArray: true });
                    if (propertySpec.items.ref) {
                        _.assign(propertySpec, { isCircular: type === modelName });
                    }
                    delete propertySpec['$ref'];
                    delete propertySpec['items'];
                }
                else {
                    _.assign(propertySpec, {
                        type: Generator.primitiveTypeResolver(propertySpec.type),
                        isArray: false
                    });
                }
            }
        })
            .value();
        modelDefinition.properties = _.map(modelDefinition.properties, function (property) { return property; });
        return modelDefinition;
    };
    ;
    Generator.retrieveResources = function (paths) {
        var resources = _
            .chain(paths)
            .map(function (methods, path) {
            return _.map(methods, function (methodSpec, methodName) {
                methodSpec.methodName = methodName;
                methodSpec.path = path.replace(/{/g, '${');
                return methodSpec;
            });
        })
            .flatten()
            .each(function (methodSpec) {
            _a = [methodSpec.summary, _.capitalize(_.startCase(methodSpec.operationId)).replace(/_/g, ' ')], methodSpec.operationId = _a[0], methodSpec.summary = _a[1];
            var _a;
        })
            .map(function (methodSpec) {
            methodSpec.resource = _.capitalize(_.camelCase(methodSpec.tags[0]));
            delete methodSpec['tags'];
            return methodSpec;
        })
            .map(function (methodSpec) {
            methodSpec.refs = [];
            methodSpec.parameters = _
                .chain(methodSpec.parameters)
                .map(function (parameter) {
                parameter.codeName = ['path',
                    'header'].indexOf(parameter["in"]) > -1 ? parameter.name : "" + parameter["in"].toLowerCase() + _.capitalize(parameter.name);
                if (parameter.schema && parameter.schema.$ref) {
                    parameter.type = Generator.refResolver(parameter.schema.$ref);
                    methodSpec.refs.push(parameter.type);
                    delete parameter['schema'];
                }
                else if (parameter.items && parameter.items.type) {
                    parameter.type = parameter.items.type === 'object' ? 'Object' : 'any';
                    delete parameter['items'];
                }
                else {
                    parameter.type = 'any';
                }
                return parameter;
            })
                .value();
            methodSpec.groupedParameters = _.groupBy(methodSpec.parameters, function (parameter) { return parameter["in"]; });
            methodSpec.httpLibraries = ['Http', 'Response'];
            methodSpec.hasQueryParameters = !!(methodSpec.groupedParameters.query && methodSpec.groupedParameters.query.length > 0);
            if (methodSpec.hasQueryParameters) {
                methodSpec.httpLibraries.push('URLSearchParams');
            }
            methodSpec.hasBodyParameters = !!(methodSpec.groupedParameters.body && methodSpec.groupedParameters.body.length > 0);
            methodSpec.hasPathParameters = !!(methodSpec.groupedParameters.path && methodSpec.groupedParameters.path.length > 0);
            methodSpec.hasHeaderParameters = !!(methodSpec.groupedParameters.header && methodSpec.groupedParameters.header.length > 0);
            if (methodSpec.hasHeaderParameters) {
                methodSpec.httpLibraries.push('Headers');
            }
            methodSpec.hasFormParameters = !!(methodSpec.groupedParameters.formData && methodSpec.groupedParameters.formData.length > 0) ? true : false;
            return methodSpec;
        })
            .each(function (methodSpec) {
            methodSpec.responses = _
                .chain(methodSpec.responses)
                .each(function (response) {
                if (response.schema) {
                    if (response.schema.$ref) {
                        methodSpec.refs.push(Generator.refResolver(response.schema.$ref));
                        response = _.assign(response, { type: Generator.refResolver(response.schema.$ref), isArray: false });
                    }
                    else if (response.schema.type === 'array') {
                        methodSpec.refs.push(Generator.refResolver(response.schema.items.$ref));
                        response = _.assign(response, { type: Generator.refResolver(response.schema.items.$ref), isArray: true });
                    }
                    else {
                        response = _.assign(response, { type: response.schema.type, isArray: false });
                    }
                    delete response['schema'];
                }
                else {
                    response = _.assign(response, { type: 'string', isArray: false });
                }
            })
                .value();
        })
            .groupBy(function (methodSpec) { return methodSpec.resource; })
            .each(function (methodSpecGroup, resourceName) { return _.each(methodSpecGroup, function (methodSpec) { return delete methodSpec['resource']; }); })
            .value();
        var returnResources = {};
        resources = _.each(resources, function (methodGroup, resourceName) {
            var refs = _.uniq(_.flatten(_.map(methodGroup, function (methodSpec) { return methodSpec.refs; })));
            var libraries = _.uniq(_.flatten(_.map(methodGroup, function (methodSpec) { return methodSpec.httpLibraries; })));
            returnResources[resourceName] = {
                methods: methodGroup,
                refs: refs,
                httpLibraries: libraries
            };
        });
        console.log(util_1.inspect(resources, { depth: null }));
        return returnResources;
    };
    ;
    Generator.typeMapping = {
        integer: 'number'
    };
    Generator.DEFAULT_OPTIONS = {
        swaggerSpecFile: './swagger.json',
        outputPath: 'client',
        debug: false,
        templatePath: path.join(__dirname, 'templates'),
        templateFiles: {
            resource: path.join(__dirname, 'templates', 'ng2-resource.hbs'),
            model: path.join(__dirname, 'templates', 'ng2-model.hbs')
        }
    };
    return Generator;
}());
exports.Generator = Generator;
