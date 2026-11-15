import { Injectable, Logger } from '@nestjs/common';
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

@Injectable()
export class SchemaValidatorService {
  private readonly logger = new Logger(SchemaValidatorService.name);
  private readonly ajv: Ajv2020;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
    });
    addFormats(this.ajv);
  }

  /**
   * Validates whether a schema definition itself conforms to JSON Schema specifications
   * (e.g. draft-07 or draft 2020-12) and can be compiled without syntax errors.
   */
  compileAndValidateSchema(schema: object): boolean {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return false;
    }

    try {
      const isValid = this.ajv.validateSchema(schema);
      if (!isValid) {
        return false;
      }

      // Compile in an isolated temporary instance to ensure no global registry leaks
      const isolatedAjv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(isolatedAjv);
      isolatedAjv.compile(schema);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates an event payload against a topic's JSON Schema.
   * Compiles and caches the compiled validator function in memory by topicId.
   */
  validate(
    topicId: string,
    schema: object,
    payload: unknown,
  ): ValidationResult {
    let validator = this.cache.get(topicId);

    if (!validator) {
      if (!this.compileAndValidateSchema(schema)) {
        return {
          valid: false,
          errors: ['Invalid JSON Schema definition for topic payload'],
        };
      }

      // Remove any previously indexed schema for this key before compiling
      this.ajv.removeSchema(topicId);
      validator = this.ajv.compile(schema);
      this.cache.set(topicId, validator);
    }

    const isValid = Boolean(validator(payload));
    if (isValid) {
      return { valid: true };
    }

    const errors = (validator.errors || []).map((err) => {
      const path = err.instancePath ? `${err.instancePath} ` : '';
      return `${path}${err.message || 'validation failed'}`.trim();
    });

    return {
      valid: false,
      errors: errors.length > 0 ? errors : ['Payload failed schema validation'],
    };
  }

  /**
   * Invalidates and evicts the cached validator function for a given topicId.
   */
  invalidate(topicId: string): void {
    this.cache.delete(topicId);
    this.ajv.removeSchema(topicId);
  }

  /**
   * Returns whether a compiled validator function is currently cached for the given topicId.
   */
  hasCachedValidator(topicId: string): boolean {
    return this.cache.has(topicId);
  }
}
