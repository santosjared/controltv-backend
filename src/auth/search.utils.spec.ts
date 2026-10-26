import { describe, expect, it } from 'vitest';
import { buildSearchPatterns } from './search.utils.js';

describe('buildSearchPatterns', () => {
  it('crea patrones literal y aproximado', () => {
    expect(buildSearchPatterns('jan')).toEqual({
      search: '%jan%',
      similarSearch: '%j%a%n%',
    });
  });

  it('escapa comodines ingresados por el usuario', () => {
    expect(buildSearchPatterns('a_b%')).toEqual({
      search: '%a\\_b\\%%',
      similarSearch: '%a%\\_%b%\\%%',
    });
  });
});
