import { describe, expect, it } from 'vitest';
import { prepareNoteContent } from './activity';

describe('prepareNoteContent', () => {
    it('should return a string with <p> tags for each line', () => {
        const content = 'Hello\nWorld';
        const result = prepareNoteContent(content);

        expect(result).toEqual('<p>Hello</p><p>World</p>');
    });

    it('should trim each line', () => {
        const content = 'Hello      \n\nWorld  ';
        const result = prepareNoteContent(content);

        expect(result).toEqual('<p>Hello</p><p>World</p>');
    });
});
