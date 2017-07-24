import * as fs from 'fs';
import * as path from 'path';
import { compile } from 'handlebars'

import { Info, Spec as Swagger } from 'swagger-schema-official';
import { parse as swaggerParse } from 'swagger-parser';

import { inspect } from 'util';

import * as _ from 'lodash';

export interface GeneratorOptions {
  swaggerSpecFile?: string;
  outputPath?: string;
  debug?: boolean;
  templatePath?: string
  templateFiles?: {
    package?: string;
    resource?: string;
    model?: string;
  }
}

export interface ParameterSpec {
  name: string;
  'in': string;
  description: string;
  required: boolean;
  type: string;
}

export interface ResponseType {
  [httpCode: number]: {
    description: string;
    type: string;
    isArray: boolean;
  }
}

export interface MethodSpec {
  methodName: string;
  path: string;
  summary: string;
  operationId: string;
  consumes: string[];
  produces: string[];
  parameters: {
    [parameterType: string]: ParameterSpec[];
  }
  responses: ResponseType[];
}

export interface ResourceType {
  [resourceName: string]: MethodSpec[];
}

export interface PropertyType {
  type: string;
  name: string;
  isEnum: boolean;
  isArray: boolean;
}

export interface ModelType {
  [modelName: string]: {
    properties: PropertyType[];
  }
}

export class Generator {
  private _swaggerParserPromise: Promise<any>;
  private swaggerSpecFile: string;
  private swaggerSpec: Swagger;
  private service: {
    tokenName: string;
    interfaceName: string;
  };

  private host: string;
  private info: Info;

  private outputPath: string;
  private debug: boolean = false;

  private renderer: {
    resource: HandlebarsTemplateDelegate,
    model: HandlebarsTemplateDelegate
  };

  private models: ModelType[];
  private resources: ResourceType[];

  static typeMapping: any = {
    integer: 'number'
  };

  static DEFAULT_OPTIONS: GeneratorOptions = {
    swaggerSpecFile: './swagger.json',
    outputPath: 'client',
    debug: false,
    templatePath: path.join(__dirname, 'templates'),
    templateFiles: {
      resource: path.join(__dirname, 'templates', 'ng2-resource.hbs'),
      model: path.join(__dirname, 'templates', 'ng2-model.hbs')
    }
  };

  constructor(generatorOptions: GeneratorOptions) {
    const options = _.merge(Generator.DEFAULT_OPTIONS, generatorOptions);
    Object.keys(options).forEach((optionKey) => this[optionKey] = options[optionKey]);
    console.log(`Generating from ${this.swaggerSpecFile} to ${this.outputPath}`);

    this._swaggerParserPromise = swaggerParse(options.swaggerSpecFile)
      .then((api: Swagger) => {
        this.swaggerSpec = api;
        this.service = {
          tokenName: _.snakeCase(api.info.title).toUpperCase(),
          interfaceName: _.capitalize(_.camelCase(api.info.title))
        };
        this.models = _.each(this.swaggerSpec.definitions, Generator.retrieveModels) as ModelType[];
        this.resources = Generator.retrieveResources(this.swaggerSpec.paths);
        console.log('Swagger file parsed without errors')
      })
      .catch((error) => console.error(error));
    this.renderer = {
      resource: compile(fs.readFileSync(options.templateFiles.resource, 'utf-8')),
      model: compile(fs.readFileSync(options.templateFiles.model, 'utf-8'))
    };
  }

  getResourceRenderer() {
    return this.renderer.resource;
  }

  getModelRenderer() {
    return this.renderer.model;
  }

  processResource(data: any) {
    if (!data.swagger) {data = _.assign(data, {swagger: this.swaggerSpec}); }
    if (!data.service) {data = _.assign(data, {service: this.service}); }
    return this.renderer.resource(data);
  }

  processModel(data: any) {
    if (!data.swagger) {data = _.assign(data, {swagger: this.swaggerSpec}); }
    if (!data.service) {data = _.assign(data, {service: this.service}); }
    return this.renderer.model(data);
  }

  getSpec(): Promise<Swagger>{
    return this._swaggerParserPromise.then(() => this.swaggerSpec);
  }

  getModels(): Promise<any[]>{
    return this._swaggerParserPromise.then(() => this.models);
  }

  getResources():Promise<any[]>{
    return this._swaggerParserPromise.then(()=> this.resources);
  }

  getOutputPath(): string {
    return this.outputPath;
  }

  static templateCompiler(template:string) {
    return compile(template);
  }

  static primitiveTypeResolver(primitiveType) {
    return Generator.typeMapping[primitiveType] !== undefined ? Generator.typeMapping[primitiveType] : primitiveType;
  }

  static refResolver(ref) {
    return ref.split('/').reverse()[0]
  };

  static retrieveModels(modelDefinition, modelName): any {
    delete modelDefinition['type'];
    modelDefinition.enums = {};
    modelDefinition.refs = [];
    modelDefinition.properties = _
      .chain(modelDefinition.properties)
      .each((propertySpec: any, propertyName: any) => {
        propertySpec = _.assign(propertySpec, {name: propertyName});
        // see if we have a enum
        if (propertySpec.enum) {
          const enumName = `${_.capitalize(propertyName)}Enum`;
          propertySpec = _.assign(propertySpec, {type: enumName, enums: propertySpec.enum, isEnum: true});
          modelDefinition.enums[enumName] = propertySpec.enum;
          delete propertySpec['enum'];
        }
        else {
          propertySpec = _.assign(propertySpec, {isEnum: false});
          // try to resolve references
          if (propertySpec.$ref) {
            const resolvedRef = Generator.refResolver(propertySpec.$ref);
            modelDefinition.refs.push(resolvedRef);
            _.assign(propertySpec, {
              type: resolvedRef,
              isArray: false,
              isCircular: (resolvedRef === modelName)
            });
          }
          else if (propertySpec.type === 'array') {
            const type = (propertySpec.items.$ref)
              ? Generator.refResolver(propertySpec.items.$ref)
              : Generator.primitiveTypeResolver(propertySpec.items.type);
            if (propertySpec.items.$ref) {
              modelDefinition.refs.push(type);
            }

            _.assign(propertySpec, {type: type, isArray: true});
            if (propertySpec.items.ref) {
              _.assign(propertySpec, {isCircular: type === modelName});
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

    modelDefinition.properties = _.map(modelDefinition.properties, (property) => property);

    return modelDefinition;
  };

  static retrieveResources(paths: any): any {


    let resources = _
      .chain(paths)
      // push path and methodName into method spec
      .map((methods, path) => {
        return _.map(methods, (methodSpec: any, methodName: string) => {
          methodSpec.methodName = methodName;
          methodSpec.path = path.replace(/{/g, '${');
          return methodSpec;
        });
      })
      // flatten the array
      .flatten()
      // swap operationId and summary, capitalizing summary to a sentence
      .each((methodSpec: any) => {
        [methodSpec.operationId, methodSpec.summary] =
          [methodSpec.summary, _.capitalize(_.startCase(methodSpec.operationId)).replace(/_/g, ' ')]
      })
      .map((methodSpec: any) => {
        methodSpec.resource = _.capitalize(_.camelCase(methodSpec.tags[0]));
        methodSpec.resourceToken = _.camelCase(methodSpec.tags[0]).toUpperCase();
        delete methodSpec['tags'];
        return methodSpec;
      })
      // resolve reference to definition and group parameters in which object (query, path, body)
      .map((methodSpec) => {
        methodSpec.refs = {parameters:[], responses:[]};
        //
        const parameterCodeName = (parameter) => {
          return ['path', 'header'].indexOf(parameter.in) > -1 ? parameter.name : `${parameter.in[0].toLowerCase()}${_.capitalize(parameter.name)}`;
        };


        methodSpec.parameters = _.chain(methodSpec.parameters)
          .map((parameter) => {
            parameter.codeName = parameterCodeName(parameter);
            if (parameter.schema && parameter.schema.$ref) {
              parameter.type = Generator.refResolver(parameter.schema.$ref);
              methodSpec.refs.parameters.push(parameter.type);
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
          // groupBy 'in' parameter
          .value();

        methodSpec.groupedParameters = _.groupBy(methodSpec.parameters, (parameter: any) => parameter.in);

        methodSpec.has = {
          pathParameters: !!(methodSpec.groupedParameters.path && methodSpec.groupedParameters.path.length > 0),
          queryParameters: !!(methodSpec.groupedParameters.query && methodSpec.groupedParameters.query.length > 0),
          bodyParameters: !!(methodSpec.groupedParameters.body && methodSpec.groupedParameters.body.length > 0),
          headerParameters: !!(methodSpec.groupedParameters.header && methodSpec.groupedParameters.header.length > 0),
          formParameters: !!(methodSpec.groupedParameters.formData && methodSpec.groupedParameters.formData.length > 0) ? true : false
        };

        // look which libraries we need
        methodSpec.httpLibraries = ['Http', 'Response'];
        if (methodSpec.has.queryParameters) { methodSpec.httpLibraries.push('URLSearchParams'); }
        if (methodSpec.has.headerParameters) { methodSpec.httpLibraries.push('Headers'); }

        // simply parameters to a string
        methodSpec.parantheseString = methodSpec.parameters.map((parameter) => `${parameter.codeName}:${parameter.type}, `).join('');

        return methodSpec;
      })
      .each((methodSpec) => {
        const responseTypes = [];
        methodSpec.responses = _.chain(methodSpec.responses)
        // resolve responses
        .each((response, httpCode:string) => {
          const code = parseInt(httpCode,10);

          let resolvedType, isArray;
          if (response.schema) {
            if (response.schema.$ref) {
              resolvedType = Generator.refResolver(response.schema.$ref);
              methodSpec.refs.responses.push(resolvedType);
              isArray = false;
            }
            else if (response.schema.type === 'array') {
              resolvedType = Generator.refResolver(response.schema.items.$ref);
              methodSpec.refs.responses.push(resolvedType);
              isArray = true;
            }
            else {
              resolvedType= response.schema.type;
              isArray = false;
            }
            delete response['schema'];
          }
          else {
            resolvedType = 'string';
            isArray =  false;
          }

          response = _.assign(response, {type: resolvedType, isArray: isArray})

          const responseTypeString = response.type+(response.isArray ? '[]':'');
          switch(code){
            case 200: responseTypes.push(responseTypeString); break;
            case 202: responseTypes.push('string'); break;
            case 204: responseTypes.push('void'); break;
            default:  responseTypes.push(responseTypeString);
          }

        })
        .value();
        methodSpec.responseTypeString = _.uniq(responseTypes).join('|');

      })
      .groupBy((methodSpec) => methodSpec.resource)
      .each((methodSpecGroup, resourceName) => _.each(methodSpecGroup, (methodSpec) => delete methodSpec['resource']))
      .value();

    let returnResources = {};

    resources = _.each(resources, (methodGroup, resourceName) => {
      const refs = _.uniq(_.flatten(_.map(methodGroup, (methodSpec) => [...methodSpec.refs.parameters, ...methodSpec.refs.responses])));
      const libraries = _.uniq(_.flatten(_.map(methodGroup, (methodSpec) => methodSpec.httpLibraries)));
      returnResources[resourceName] = {
        methods: methodGroup,
        refs: refs,
        httpLibraries: libraries
      };
    });

    return returnResources;
  };
}
