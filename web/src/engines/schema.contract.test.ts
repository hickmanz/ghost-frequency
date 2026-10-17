import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { DevelopEngine } from './developEngine';
import { LocalEngine } from './localEngine';
import { DEFAULT_PARAMS } from '@shared/index';

const schemaPath = fileURLToPath(new URL('../../../shared/schemas/events.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as Record<string, unknown>;
delete schema.$schema;
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

describe('EventBatch schema contract', () => {
  it('LocalEngine output validates', () => {
    const eng = new LocalEngine();
    const params = { ...DEFAULT_PARAMS, seed: 4242 };
    eng.init(params.seed, params);
    for (let bar = 0; bar < 4; bar++) {
      const batch = eng.renderBars(bar, 1, params);
      const ok = validate(batch);
      if (!ok) console.error(validate.errors);
      expect(ok).toBe(true);
    }
  });

  it('DevelopEngine output validates, including bell notes and ducks', () => {
    const eng = new DevelopEngine();
    const params = { ...DEFAULT_PARAMS, seed: 1984, energy: 0.45 };
    eng.init(params.seed, params);
    let bell = false;
    let duck = false;
    for (let bar = 0; bar < 64; bar++) {
      const batch = eng.renderBars(bar, 1, params);
      const ok = validate(batch);
      if (!ok) console.error(validate.errors);
      expect(ok).toBe(true);
      for (const e of batch.events) {
        if (e.kind === 'note' && e.layer === 'bell') bell = true;
        if (e.kind === 'automation' && e.target === 'duck.pad') duck = true;
      }
    }
    expect(bell).toBe(true);
    expect(duck).toBe(true);
  });
});
