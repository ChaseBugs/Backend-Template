import Ajv, { ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, jsonPointers: true });
const validators = new Map<string, ValidateFunction>();

function validatorFor(topic: string): ValidateFunction {
  let validator = validators.get(topic);
  if (validator) return validator;
  validator = ajv.compile({
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['eventId', 'occurredAt', 'version', 'topic', 'payload'],
    properties: {
      eventId: { type: 'string', minLength: 1 },
      occurredAt: { type: 'string', format: 'date-time' },
      version: { type: 'integer', minimum: 1 },
      topic: { const: topic },
      payload: { type: 'object' },
    },
    additionalProperties: true,
  });
  validators.set(topic, validator);
  return validator;
}

export function validateKafkaEvent(value: unknown, topic: string): void {
  const validate = validatorFor(topic);
  if (validate(value)) return;
  const details = ajv.errorsText(validate.errors, { separator: '; ', dataVar: 'event' });
  throw new Error(`Invalid Kafka event for topic ${topic}: ${details}`);
}
