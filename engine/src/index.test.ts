import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index';

describe('движок', () => {
  it('сообщает свою версию', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
