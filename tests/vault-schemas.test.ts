import { describe, it, expect } from 'vitest';
import { validate } from '../core/schemas.ts';

const decision = {
  class: 'class', name: 'decision', division: 'governance', folder: 'governance/decisions', produced: 'log',
  thing: false, statuses: ['accepted'], archive: ['superseded', 'retired'], required: [], optional: [],
};

describe('the _meta schemas', () => {
  it('accepts a complete class note', () => {
    expect(validate('class', decision)).toEqual([]);
  });
  it.each([
    ['an unknown division', { ...decision, division: 'ops' }],
    ['a folder with capitals', { ...decision, folder: 'governance/Decisions' }],
    ['a missing field', (({ thing: _t, ...rest }) => rest)(decision)],
    ['an extra field', { ...decision, colour: 'red' }],
    ['a repeated status', { ...decision, statuses: ['accepted', 'accepted'] }],
    ['a class that is not "class"', { ...decision, class: 'decision' }],
  ])('refuses %s', (_label, data) => {
    expect(validate('class', data)).not.toEqual([]);
  });
  it('reads the tag vocabulary, components and contract', () => {
    expect(validate('tags', { vocabulary: ['retrieval', 'topic/sub'] })).toEqual([]);
    expect(validate('tags', { tags: ['retrieval'] })).not.toEqual([]);
    expect(validate('components', { components: ['api', 'dashboard'] })).toEqual([]);
    expect(validate('contract', { contract: 1 })).toEqual([]);
    expect(validate('contract', { contract: 0 })).not.toEqual([]);
    expect(validate('contract', { contract: '1' })).not.toEqual([]);
  });
});
